import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Store } from './storage.ts';
import { approvalRef, checkApproval, checkRights, makeTarget, parseApproval, parseRights, verifyAssets } from './contract.ts';
import type { Approval, ApprovalRef, Authority, Envelope, Pin, Rights, Target } from './contract.ts';
import { Refusal, canonical, company, digest, hex, id, integer, object, requireThat, text } from './validation.ts';

export type Status = 'queued' | 'claimed' | 'dispatching' | 'delivered' | 'retry_wait' | 'uncertain' | 'reconciling' | 'needs_review' | 'cancelled' | 'expired';
export interface Receipt { key: string; account: string; targetDigest: string; requestId: string; evidence: string }
export type Outcome = { kind: 'confirmed_success'; receipt: Receipt }
  | { kind: 'definite_no_write'; retryable: boolean; retryAfterMs?: number }
  | { kind: 'ambiguous' };
export type Reconciliation = { kind: 'found'; receipt: Receipt }
  | { kind: 'authoritative_no_effect'; quiescent: true; requestDigest: string; evidence: string }
  | { kind: 'inconclusive' };
export interface MockPort {
  readonly mode: 'fixture-mock';
  send(request: Request): Promise<Outcome>;
  reconcile(request: Request): Promise<Reconciliation>;
}
export interface Request { key: string; account: string; targetDigest: string; fence: number; requestId: string }
export interface Delivery {
  target: Target; targetDigest: string; approval: ApprovalRef; approvalDigest: string; rightsDigest: string;
  key: string; status: Status; nextAttemptAt: number; attempts: number; fence: number;
  owner: string | null; requestId: string | null; receipt: Receipt | null;
}
interface GrantState { proofDigest: string; epoch: number; revoked: boolean; reservedDeliveryId: string }
interface Rate { day: string; used: number; nextAt: number }
export interface Event {
  sequence: number; time: number; companyId: string; deliveryId: string | null; targetDigest: string | null;
  approvalDigest: string | null; rightsDigest: string | null; runId: string; actor: 'fixture-harness' | 'scheduler';
  transition: string; attempt: number; fence: number; requestId: string | null; evidenceDigest: string | null;
  previous: string; hash: string;
}
export interface CompanyState {
  format: 1; companyId: string; kill: boolean; killEpoch: number; accountKills: string[];
  grants: Record<string, GrantState>; revokedIds: string[]; rights: Rights[]; deliveries: Delivery[];
  rates: Record<string, Rate>; journal: Event[];
}
export function emptyState(companyId: string): CompanyState {
  return { format: 1, companyId: company(companyId), kill: true, killEpoch: 0, accountKills: [],
    grants: {}, revokedIds: [], rights: [], deliveries: [], rates: {}, journal: [] };
}
const ZERO = '0'.repeat(64);
const ACTIVE = new Set<Status>(['claimed','dispatching','uncertain','reconciling']);
const SENDABLE = new Set<Status>(['queued','retry_wait']);
const MAX_TICK = 10, CAS_BUDGET = 8, MAX_ATTEMPTS = 5, DAILY_CAP = 5;

export function verifyJournal(state: CompanyState): void {
  requireThat(state.format === 1 && state.companyId === company(state.companyId), 'state-format');
  requireThat(state.deliveries.length <= 100 && state.rights.length <= 100 && Object.keys(state.grants).length <= 100 && state.revokedIds.length <= 100, 'state-cap');
  let previous = ZERO;
  for (const [index, event] of state.journal.entries()) {
    const { hash, ...body } = event;
    requireThat(event.sequence === index + 1 && event.previous === previous && event.companyId === state.companyId && digest(body) === hash, 'audit-chain');
    previous = hash;
  }
  requireThat(state.journal.filter(e => e.deliveryId === null).length <= 100, 'control-cap');
  for (const item of state.deliveries) {
    requireThat(item.target.envelope.companyId === state.companyId && digest(item.target) === item.targetDigest, 'state-target');
    requireThat(state.journal.filter(e => e.deliveryId === item.target.envelope.deliveryId).length <= 32, 'audit-cap');
  }
  requireThat(Buffer.byteLength(canonical(state)) <= 2 * 1024 * 1024, 'state-byte-cap');
}
interface Dependencies {
  store: Store<CompanyState>; authority: Authority; transport: MockPort; assetRoot: string; pin: Pin;
  now: () => number; companies: readonly string[]; globalDisabled?: boolean;
  monotonic?: () => number;
}
export class FixturePublisher {
  private readonly deps: Dependencies;
  private readonly allowed: ReadonlySet<string>;
  constructor(deps: Dependencies) {
    requireThat(deps.transport.mode === 'fixture-mock', 'transport-disabled');
    requireThat(deps.companies.length <= 10, 'company-cap');
    this.deps = { ...deps, companies: [...deps.companies], pin: structuredClone(deps.pin), globalDisabled: deps.globalDisabled ?? true };
    this.allowed = new Set(deps.companies.map(company));
  }
  private scope(c: string): void { company(c); requireThat(this.allowed.has(c), 'company-disabled'); }
  private now(): number { return integer(this.deps.now(), 0, 8_640_000_000_000_000); }
  async inspect(c: string): Promise<CompanyState> {
    this.scope(c);
    const snapshot = await this.deps.store.load(c);
    const state = snapshot?.state ?? emptyState(c);
    requireThat(state.companyId === c, 'state-scope'); verifyJournal(state);
    return structuredClone(state);
  }
  private async change<T>(c: string, operation: (s: CompanyState) => Promise<T> | T): Promise<T> {
    this.scope(c);
    for (let attempt = 0; attempt < CAS_BUDGET; attempt++) {
      const snapshot = await this.deps.store.load(c);
      const state = snapshot ? structuredClone(snapshot.state) : emptyState(c);
      requireThat(state.companyId === c, 'state-scope'); verifyJournal(state);
      const result = await operation(state);
      verifyJournal(state);
      if (await this.deps.store.compareAndSwap(c, snapshot?.version ?? null, state)) return result;
    }
    throw new Error('cas-contention');
  }
  private audit(s: CompanyState, d: Delivery | null, transition: string, runId = 'fixture-control', evidence: unknown = null): void {
    text(runId, /^[a-zA-Z0-9_-]{1,100}$/);
    requireThat(s.journal.filter(e => e.deliveryId === (d?.target.envelope.deliveryId ?? null)).length < (d ? 32 : 100), 'audit-cap');
    const body: Omit<Event, 'hash'> = {
      sequence: s.journal.length + 1, time: this.now(), companyId: s.companyId,
      deliveryId: d?.target.envelope.deliveryId ?? null, targetDigest: d?.targetDigest ?? null,
      approvalDigest: d?.approvalDigest ?? null, rightsDigest: d?.rightsDigest ?? null,
      runId, actor: d ? 'scheduler' : 'fixture-harness', transition,
      attempt: d?.attempts ?? 0, fence: d?.fence ?? 0, requestId: d?.requestId ?? null,
      evidenceDigest: evidence === null ? null : digest(evidence), previous: s.journal.at(-1)?.hash ?? ZERO,
    };
    s.journal.push({ ...body, hash: digest(body) });
  }
  // Harness-only composition methods. No agent tool/API route exposes these controls.
  async setKill(c: string, disabled: boolean, account: string | null = null): Promise<void> {
    requireThat(typeof disabled === 'boolean', 'kill');
    if (account !== null) requireThat(['fixture-youtube-main','fixture-bluesky-main'].includes(account), 'account');
    await this.change(c, s => {
      s.killEpoch++;
      if (account === null) s.kill = disabled;
      else s.accountKills = disabled ? [...new Set([...s.accountKills, account])] : s.accountKills.filter(a => a !== account);
      this.audit(s, null, disabled ? 'kill-enabled' : 'fixture-kill-lifted');
      if (disabled) for (const d of s.deliveries) if (account === null || d.target.envelope.account === account) {
        if (SENDABLE.has(d.status) || d.status === 'claimed') { d.status = 'cancelled'; this.audit(s, d, 'kill-cancelled'); }
        else if (d.status === 'dispatching') { d.status = 'uncertain'; this.audit(s, d, 'kill-in-flight'); }
      }
    });
  }
  async setRights(c: string, input: unknown): Promise<void> {
    const rights = parseRights(input); requireThat(rights.companyId === c, 'rights-scope');
    await this.change(c, s => {
      const index = s.rights.findIndex(r => r.id === rights.id), old = s.rights[index];
      requireThat(!old || rights.revision > old.revision, 'rights-stale');
      if (index < 0) { requireThat(s.rights.length < 100, 'rights-cap'); s.rights.push(rights); } else s.rights[index] = rights;
      this.audit(s, null, rights.withdrawn ? 'rights-withdrawn' : 'rights-installed', 'fixture-control', rights);
      if (rights.withdrawn) this.invalidate(s, d => d.target.envelope.assets.some(a => a.rightsId === rights.id), 'rights-withdrawn');
    });
  }
  async revoke(c: string, approvalId: string): Promise<void> {
    id(approvalId);
    await this.change(c, s => {
      requireThat(s.revokedIds.length < 100 || s.revokedIds.includes(approvalId), 'revocation-cap');
      if (!s.revokedIds.includes(approvalId)) s.revokedIds.push(approvalId);
      const grant = s.grants[approvalId]; if (grant) { grant.revoked = true; grant.epoch++; }
      this.audit(s, null, 'approval-revoked', 'fixture-control', { approvalId });
      this.invalidate(s, d => d.approval.id === approvalId, 'revocation');
    });
  }
  private invalidate(s: CompanyState, applies: (d: Delivery) => boolean, reason: string): void {
    for (const d of s.deliveries) if (applies(d)) {
      if (SENDABLE.has(d.status) || d.status === 'claimed') { d.status = 'cancelled'; this.audit(s, d, reason); }
      else if (d.status === 'dispatching') { d.status = 'uncertain'; this.audit(s, d, reason + '-in-flight'); }
    }
  }
  private async proof(s: CompanyState, target: Target, ref: ApprovalRef, now: number): Promise<{ approval: Approval; rightsDigest: string }> {
    const e = target.envelope, targetDigest = digest(target);
    requireThat(!s.revokedIds.includes(ref.id), 'approval-revoked');
    const approval = parseApproval(await this.deps.authority.verify(s.companyId, ref, targetDigest));
    checkApproval(approval, ref, e, targetDigest, now);
    return { approval, rightsDigest: checkRights(e, s.rights, now) };
  }
  private async boundary<T>(c: string | null, transition: string, operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      // Fixed event names only: never persist raw payloads, filesystem paths or adapter errors.
      if (c && this.allowed.has(c)) {
        try { await this.change(c, s => { this.audit(s, null, transition); }); }
        catch { throw new Refusal('audit-or-state-unavailable'); }
      }
      throw error instanceof Refusal ? error : new Refusal('publisher-unavailable');
    }
  }
  async enqueue(input: unknown, grantRef: unknown): Promise<Delivery> {
    const descriptor = input !== null && typeof input === 'object' ? Object.getOwnPropertyDescriptor(input, 'companyId') : undefined;
    const c = descriptor && 'value' in descriptor && typeof descriptor.value === 'string' && this.allowed.has(descriptor.value) ? descriptor.value : null;
    return this.boundary(c, 'enqueue-refused', () => this.enqueueChecked(input, grantRef));
  }
  private async enqueueChecked(input: unknown, grantRef: unknown): Promise<Delivery> {
    const target = makeTarget(input, this.deps.pin), e = target.envelope;
    this.scope(e.companyId); const ref = approvalRef(grantRef);
    await verifyAssets(e, this.deps.assetRoot);
    return this.change(e.companyId, async s => {
      const now = this.now(); requireThat(now < Date.parse(e.windowEnd), 'window-expired');
      const proof = await this.proof(s, target, ref, now), targetDigest = digest(target);
      const existing = s.deliveries.find(d => d.target.envelope.deliveryId === e.deliveryId);
      if (existing) {
        requireThat(existing.targetDigest === targetDigest && canonical(existing.approval) === canonical(ref), 'delivery-conflict');
        return structuredClone(existing);
      }
      requireThat(s.deliveries.length < 100, 'queue-cap');
      const known = s.grants[ref.id], proofDigest = digest(proof.approval);
      requireThat(!known || (!known.revoked && known.proofDigest === proofDigest && known.reservedDeliveryId === e.deliveryId), 'approval-reserved');
      s.grants[ref.id] = { proofDigest, epoch: proof.approval.epoch, revoked: false, reservedDeliveryId: e.deliveryId };
      const d: Delivery = { target, targetDigest, approval: ref, approvalDigest: proofDigest, rightsDigest: proof.rightsDigest,
        key: digest({ companyId: e.companyId, targetDigest, deliveryId: e.deliveryId }), status: 'queued', nextAttemptAt: Date.parse(e.scheduledAt),
        attempts: 0, fence: 0, owner: null, requestId: null, receipt: null };
      s.deliveries.push(d); this.audit(s, d, 'enqueued'); return structuredClone(d);
    });
  }
  private async eligible(s: CompanyState, d: Delivery): Promise<void> {
    const e = d.target.envelope, now = this.now();
    requireThat(!this.deps.globalDisabled && !s.kill && !s.accountKills.includes(e.account), 'kill');
    requireThat(now >= Date.parse(e.scheduledAt) && now >= Date.parse(e.windowStart) && now < Date.parse(e.windowEnd), 'delivery-window');
    requireThat(d.attempts < MAX_ATTEMPTS, 'attempt-cap');
    requireThat(digest(makeTarget(e, this.deps.pin)) === d.targetDigest, 'target-changed');
    const proof = await this.proof(s, d.target, d.approval, now), grant = s.grants[d.approval.id];
    requireThat(grant && !grant.revoked && grant.reservedDeliveryId === e.deliveryId && grant.proofDigest === digest(proof.approval)
      && grant.epoch === proof.approval.epoch && d.approvalDigest === grant.proofDigest && d.rightsDigest === proof.rightsDigest, 'approval-stale');
  }
  private request(d: Delivery): Request {
    requireThat(d.requestId !== null, 'request-missing');
    return { key: d.key, account: d.target.envelope.account, targetDigest: d.targetDigest, fence: d.fence, requestId: d.requestId };
  }
  private matches(d: Delivery, receipt: Receipt): boolean {
    try {
      const r = object(receipt, ['key','account','targetDigest','requestId','evidence']);
      hex(r.key); hex(r.targetDigest); hex(r.evidence); text(r.requestId, /^fixture-request-[a-f0-9]{32}$/);
      return r.key === d.key && r.account === d.target.envelope.account && r.targetDigest === d.targetDigest && r.requestId === d.requestId;
    } catch { return false; }
  }
  private async claim(c: string, deliveryId: string, runId: string): Promise<Delivery | null> {
    const token = randomBytes(24).toString('hex');
    return this.change(c, async s => {
      const d = s.deliveries.find(d => d.target.envelope.deliveryId === deliveryId);
      if (!d || !SENDABLE.has(d.status) || d.nextAttemptAt > this.now()) return null;
      if (Date.parse(d.target.envelope.windowEnd) <= this.now()) { d.status = 'expired'; this.audit(s, d, 'window-expired', runId); return null; }
      if (s.deliveries.some(other => other !== d && other.target.envelope.account === d.target.envelope.account && ACTIVE.has(other.status))) return null;
      const rate = s.rates[d.target.envelope.account], day = new Date(this.now()).toISOString().slice(0,10);
      if (rate && rate.day === day && rate.used >= DAILY_CAP) {
        d.status = 'needs_review'; this.audit(s, d, 'daily-rate-cap', runId); return null;
      }
      if (rate && rate.nextAt > this.now()) return null;
      await this.eligible(s, d);
      // Reserve audit capacity for intent, outcome, reconcile start/result, and a terminal hold.
      requireThat(s.journal.filter(e => e.deliveryId === deliveryId).length <= 25, 'audit-cap');
      d.owner = token; d.fence++; d.status = 'claimed'; this.audit(s, d, 'claimed', runId); return structuredClone(d);
    });
  }
  private async permit(c: string, claimed: Delivery, runId: string): Promise<Delivery | null> {
    await verifyAssets(claimed.target.envelope, this.deps.assetRoot);
    return this.change(c, async s => {
      const d = s.deliveries.find(d => d.key === claimed.key);
      if (!d || d.status !== 'claimed' || d.owner !== claimed.owner || d.fence !== claimed.fence) return null;
      await this.eligible(s, d);
      const account = d.target.envelope.account, day = new Date(this.now()).toISOString().slice(0,10);
      const rate = s.rates[account] ?? { day, used: 0, nextAt: 0 };
      if (rate.day !== day) { rate.day = day; rate.used = 0; }
      requireThat(rate.used < DAILY_CAP && rate.nextAt <= this.now(), 'rate');
      rate.used++; rate.nextAt = this.now() + 60_000; s.rates[account] = rate;
      d.attempts++; d.requestId = 'fixture-request-' + randomBytes(16).toString('hex'); d.status = 'dispatching';
      this.audit(s, d, 'intent-and-permit', runId); return structuredClone(d);
    });
  }
  private retry(s: CompanyState, d: Delivery, retryAfterMs: number | undefined, runId: string): void {
    const now = this.now(), base = Math.min(3_600_000, 60_000 * 2 ** (d.attempts - 1));
    const jitter = Number.parseInt(digest({ key: d.key, attempt: d.attempts }).slice(0,8), 16) % Math.floor(base / 5 + 1);
    if (retryAfterMs !== undefined && (!Number.isSafeInteger(retryAfterMs) || retryAfterMs < 0 || retryAfterMs > 86_400_000)) {
      d.status = 'needs_review'; this.audit(s, d, 'invalid-retry-after', runId); return;
    }
    const next = now + Math.max(base + jitter, retryAfterMs ?? 0);
    if (d.attempts >= MAX_ATTEMPTS || next >= Date.parse(d.target.envelope.windowEnd)) {
      d.status = 'needs_review'; this.audit(s, d, 'retry-budget-exhausted', runId); return;
    }
    d.nextAttemptAt = next; d.status = 'retry_wait'; d.owner = null; this.audit(s, d, 'backoff', runId);
  }
  private async outcome(c: string, sent: Delivery, result: Outcome, runId: string): Promise<void> {
    await this.change(c, s => {
      const d = s.deliveries.find(d => d.key === sent.key);
      requireThat(d && d.owner === sent.owner && d.fence === sent.fence, 'stale-owner');
      if (d.status !== 'dispatching') return; // Revocation/kill already held the effect for reconciliation.
      if (result.kind === 'confirmed_success') {
        if (this.matches(d, result.receipt)) { d.receipt = structuredClone(result.receipt); d.status = 'delivered'; this.audit(s, d, 'mock-delivered', runId, result.receipt); }
        else { d.status = 'needs_review'; this.audit(s, d, 'receipt-conflict', runId); }
      } else if (result.kind === 'definite_no_write') {
        if (result.retryable) this.retry(s, d, result.retryAfterMs, runId);
        else { d.status = 'needs_review'; this.audit(s, d, 'permanent-no-write', runId); }
      } else { d.status = 'uncertain'; this.audit(s, d, 'ambiguous-effect', runId); }
    });
  }
  async tick(runId: string): Promise<{ considered: number; mockCalls: number }> {
    return deadline(this.tickWithinBudget(runId), 60_000);
  }
  private async tickWithinBudget(runId: string): Promise<{ considered: number; mockCalls: number }> {
    text(runId, /^[a-zA-Z0-9_-]{1,100}$/);
    const monotonic = this.deps.monotonic ?? (() => performance.now()), started = monotonic();
    let considered = 0, mockCalls = 0;
    for (const c of this.allowed) {
      if (considered >= MAX_TICK || monotonic() - started >= 55_000) break;
      const state = await this.inspect(c);
      for (const item of state.deliveries) {
        if (considered >= MAX_TICK || monotonic() - started >= 55_000) break;
        if (!SENDABLE.has(item.status) || item.nextAttemptAt > this.now()) continue;
        considered++;
        // An unavailable authority, storage, or invalid proof halts this dispatch; never default allow.
        await this.boundary(c, 'dispatch-refused', async () => {
          const claimed = await this.claim(c, item.target.envelope.deliveryId, runId);
          if (!claimed || monotonic() - started >= 55_000) return;
          const sent = await this.permit(c, claimed, runId);
          if (!sent) return;
          // A slow store/authority may consume the budget after intent. Hold that permit,
          // rather than start a request outside the handler's send budget.
          if (monotonic() - started >= 55_000) {
            await this.outcome(c, sent, { kind: 'ambiguous' }, runId); return;
          }
          mockCalls++;
          let result: Outcome;
          try { result = await deadline(this.deps.transport.send(this.request(sent))); }
          catch { result = { kind: 'ambiguous' }; }
          // If this write fails, persisted dispatching remains non-sendable. Never report success.
          await this.outcome(c, sent, result, runId);
        });
      }
    }
    return { considered, mockCalls };
  }
  // Restart only holds in-flight requests. No elapsed-time claim stealing. A claimed item
  // is released only by a trusted harness proving its owner process has exited before intent.
  async recover(c: string, quiescentClaimOwners: ReadonlySet<string> = new Set()): Promise<void> {
    await this.change(c, s => {
      for (const d of s.deliveries) {
        if (d.status === 'dispatching' || d.status === 'reconciling') { d.status = 'uncertain'; this.audit(s, d, 'restart-uncertain'); }
        else if (d.status === 'claimed' && d.owner && quiescentClaimOwners.has(d.owner)) {
          d.status = 'retry_wait'; d.owner = null; this.audit(s, d, 'quiescent-before-intent');
        }
      }
    });
  }
  async reconcile(c: string, deliveryId: string, runId: string): Promise<void> {
    id(deliveryId);
    const claimed = await this.change(c, s => {
      const d = s.deliveries.find(d => d.target.envelope.deliveryId === deliveryId);
      if (!d || d.status !== 'uncertain') return null;
      d.status = 'reconciling'; this.audit(s, d, 'reconcile-intent', runId); return structuredClone(d);
    });
    if (!claimed) return;
    let result: Reconciliation;
    try { result = await deadline(this.deps.transport.reconcile(this.request(claimed))); }
    catch { result = { kind: 'inconclusive' }; }
    await this.change(c, async s => {
      const d = s.deliveries.find(d => d.key === claimed.key);
      requireThat(d && d.fence === claimed.fence && d.owner === claimed.owner && d.status === 'reconciling', 'stale-owner');
      if (result.kind === 'found') {
        if (this.matches(d, result.receipt)) { d.receipt = structuredClone(result.receipt); d.status = 'delivered'; this.audit(s, d, 'reconciled-mock-effect', runId, result.receipt); }
        else { d.status = 'needs_review'; this.audit(s, d, 'reconcile-conflict', runId); }
      } else if (result.kind === 'authoritative_no_effect' && result.quiescent === true && result.requestDigest === digest(this.request(d)) && /^[a-f0-9]{64}$/.test(result.evidence)) {
        try { await this.eligible(s, d); this.retry(s, d, undefined, runId); }
        catch { d.status = 'needs_review'; this.audit(s, d, 'reconcile-no-resend-permit', runId); }
      } else { d.status = 'uncertain'; this.audit(s, d, 'reconcile-held', runId); }
    });
  }
}
async function deadline<T>(promise: Promise<T>, milliseconds = 5_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('publisher-deadline')), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
