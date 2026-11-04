// Synthetic authorities and transports ONLY. No real approval import or provider client.
import { DatabaseSync } from 'node:sqlite';
import type { Approval, ApprovalRef, Authority } from './contract.ts';
import { parseApproval } from './contract.ts';
import type { MockPort, Outcome, Receipt, Reconciliation, Request } from './queue.ts';
import { company, digest, requireThat } from './validation.ts';

export class FixtureAuthority implements Authority {
  private readonly grants = new Map<string, Approval>();
  unavailable = false;
  install(input: unknown): void {
    const approval = parseApproval(input);
    const old = this.grants.get(approval.companyId + ':' + approval.id);
    requireThat(!old || approval.revision > old.revision, 'fixture-approval-stale');
    this.grants.set(approval.companyId + ':' + approval.id, approval);
  }
  async verify(c: string, ref: ApprovalRef, targetDigest: string): Promise<Approval> {
    company(c); requireThat(!this.unavailable, 'fixture-authority-unavailable');
    const approval = this.grants.get(c + ':' + ref.id);
    requireThat(approval && approval.revision === ref.revision && approval.targetDigest === targetDigest, 'fixture-approval-missing');
    return structuredClone(approval);
  }
}
export type MockBehavior = 'success' | 'accepted-response-lost' | 'retryable' | 'permanent' | 'ambiguous-no-effect';
export class FixtureTransport implements MockPort {
  readonly mode = 'fixture-mock' as const;
  private readonly db: DatabaseSync;
  behavior: MockBehavior = 'success';
  reconcileUnavailable = false;
  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS mock_calls (request_id TEXT PRIMARY KEY, request TEXT NOT NULL, receipt TEXT, no_effect INTEGER NOT NULL)');
  }
  get calls(): number { return Number(this.db.prepare('SELECT COUNT(*) AS n FROM mock_calls').get()!.n); }
  async send(request: Request): Promise<Outcome> {
    requireThat(/^fixture-(youtube|bluesky)-main$/.test(request.account), 'fixture-account');
    const receipt: Receipt = { key: request.key, account: request.account, targetDigest: request.targetDigest,
      requestId: request.requestId, evidence: digest({ mockAccepted: request }) };
    const accepted = this.behavior === 'success' || this.behavior === 'accepted-response-lost';
    this.db.prepare('INSERT INTO mock_calls (request_id, request, receipt, no_effect) VALUES (?, ?, ?, ?)')
      .run(request.requestId, JSON.stringify(request), accepted ? JSON.stringify(receipt) : null, accepted ? 0 : 1);
    if (this.behavior === 'success') return { kind: 'confirmed_success', receipt };
    if (this.behavior === 'retryable') return { kind: 'definite_no_write', retryable: true };
    if (this.behavior === 'permanent') return { kind: 'definite_no_write', retryable: false };
    return { kind: 'ambiguous' };
  }
  async reconcile(request: Request): Promise<Reconciliation> {
    if (this.reconcileUnavailable) return { kind: 'inconclusive' };
    const row = this.db.prepare('SELECT request, receipt, no_effect FROM mock_calls WHERE request_id = ?').get(request.requestId);
    if (!row || row.request !== JSON.stringify(request)) return { kind: 'inconclusive' };
    if (typeof row.receipt === 'string') return { kind: 'found', receipt: JSON.parse(row.receipt) as Receipt };
    // This synchronous local fixture has completed and persisted authoritative no-effect.
    // Merely not finding a row above never proves a remote sender is quiescent.
    if (row.no_effect === 1) return { kind: 'authoritative_no_effect', quiescent: true, requestDigest: digest(request), evidence: digest({ localNoEffect: request }) };
    return { kind: 'inconclusive' };
  }
  close(): void { this.db.close(); }
}
