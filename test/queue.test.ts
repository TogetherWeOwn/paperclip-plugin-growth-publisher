import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fork } from 'node:child_process';
import { FixturePublisher, verifyJournal } from '../src/queue.ts';
import type { CompanyState, MockPort, Request } from '../src/queue.ts';
import { FileStore } from '../src/storage.ts';
import type { Store } from '../src/storage.ts';
import { FixtureAuthority, FixtureTransport } from '../src/testing.ts';
import { C, C2, NOW, PIN, approval, envelope, harness, rights } from './helpers.ts';

async function item(h: Awaited<ReturnType<typeof harness>>) { return (await h.publisher.inspect(C)).deliveries[0]!; }
async function proveNoCall(h: Awaited<ReturnType<typeof harness>>, fn: () => Promise<unknown>) {
  await assert.rejects(fn); assert.equal(h.transport.calls, 0); verifyJournal(await h.publisher.inspect(C));
}
test('exact enqueue is idempotent; scheduler repeats deliver once; audit stores hashes, not copy', async t => {
  const h = await harness(t), one = await h.enqueue(), two = await h.enqueue(); assert.deepEqual(one, two);
  assert.equal((await h.publisher.tick('run-one')).mockCalls, 1);
  assert.equal((await h.publisher.tick('run-one')).mockCalls, 0);
  assert.equal(h.transport.calls, 1); assert.equal((await item(h)).status, 'delivered');
  const state = await h.publisher.inspect(C); verifyJournal(state);
  const exported = JSON.stringify(state.journal);
  assert.ok(!exported.includes('Synthetic event') && !exported.includes('fixture.png'));
  assert.equal(state.journal.filter(e => e.transition === 'intent-and-permit').length, 1);
});
test('delivery id cannot be reused for a different target or grant; reservations are single-use', async t => {
  const h = await harness(t); await h.enqueue();
  const edited = envelope(); edited.copyToken = 'fixture-recap'; h.authority.install({ ...approval(edited), revision: 2 });
  await assert.rejects(h.enqueue(edited, { id: 'fixture-approval', revision: 2 }), /delivery-conflict/);
  const second = envelope(C, 'fixture-delivery-two');
  // A grant is exact-target bound, including the delivery ID. Neither enqueue identity nor a boolean grants dispatch.
  await assert.rejects(h.enqueue(second), /fixture-approval-missing/);
  assert.equal(h.transport.calls, 0);
});
for (const [name, edit] of [
  ['expired', (a: ReturnType<typeof approval>) => { a.expiresAt = new Date(NOW).toISOString(); }],
  ['future', (a: ReturnType<typeof approval>) => { a.notBefore = new Date(NOW + 1).toISOString(); }],
  ['issued-in-future', (a: ReturnType<typeof approval>) => { a.issuedAt = new Date(NOW + 1).toISOString(); }],
  ['wrong-scope', (a: ReturnType<typeof approval>) => { a.companyId = C2; }],
  ['wrong-target', (a: ReturnType<typeof approval>) => { a.targetDigest = '0'.repeat(64); }],
] as const) test('approval no-call rejection: ' + name, async t => {
  const h = await harness(t), a = approval(); a.revision = 2; edit(a); h.authority.install(a);
  await proveNoCall(h, () => h.enqueue(envelope(), { id: a.id, revision: 2 }));
});
test('missing, stale, unavailable and caller-created approval refuse', async t => {
  const h = await harness(t);
  for (const ref of [{ id: 'fixture-absent', revision: 1 }, { id: 'fixture-approval', revision: 2 }, true,
    { id: 'fixture-approval', revision: 1, approved: true }]) await proveNoCall(h, () => h.publisher.enqueue(envelope(), ref));
  h.authority.unavailable = true; await proveNoCall(h, () => h.enqueue());
});
test('queued proof must still be current at dispatch; exact expiry and rights revocation persist', async t => {
  const h = await harness(t); await h.enqueue();
  h.authority.install({ ...approval(), revision: 2 });
  await proveNoCall(h, () => h.publisher.tick('stale'));
  await h.publisher.revoke(C, 'fixture-approval');
  assert.equal((await item(h)).status, 'cancelled');
  assert.ok((await h.publisher.inspect(C)).revokedIds.includes('fixture-approval'));
  await proveNoCall(h, () => h.enqueue());
});
test('revocation before enqueue and cross-company authority/isolation deny', async t => {
  const h = await harness(t); await h.publisher.revoke(C, 'fixture-approval');
  await proveNoCall(h, () => h.enqueue());
  await h.publisher.setRights(C2, rights(C2)); await h.publisher.setKill(C2, false);
  await assert.rejects(h.enqueue(envelope(C2)), /fixture-approval-missing/);
  const beta = await h.publisher.inspect(C2); assert.equal(beta.grants['fixture-approval'], undefined);
  assert.ok(beta.journal.every(e => e.companyId === C2)); assert.equal(beta.revokedIds.length, 0);
  await assert.rejects(h.publisher.inspect('fixture-company-other'), /company-disabled/);
});
test('default company/global kill deny; restart/config reactivation does not lift kill', async t => {
  const h = await harness(t); await h.enqueue();
  await proveNoCall(h, () => h.compose(h.transport, true).tick('global-kill'));
  await h.publisher.setKill(C, true); const epoch = (await h.publisher.inspect(C)).killEpoch;
  const reopen = h.compose(); await reopen.tick('restart');
  const state = await reopen.inspect(C); assert.equal(state.kill, true); assert.equal(state.killEpoch, epoch);
  assert.equal(state.deliveries[0]!.status, 'cancelled'); assert.equal(h.transport.calls, 0);
  await h.publisher.setRights(C2, rights(C2)); h.authority.install(approval(envelope(C2), 'fixture-beta-approval'));
  await h.publisher.enqueue(envelope(C2), { id: 'fixture-beta-approval', revision: 1 });
  await proveNoCall(h, () => h.publisher.tick('default-company-kill'));
});
test('rights withdrawal after queue holds the item with persisted audit', async t => {
  const h = await harness(t); await h.enqueue();
  await h.publisher.setRights(C, { ...rights(), revision: 2, withdrawn: true });
  assert.equal((await item(h)).status, 'cancelled'); await h.publisher.tick('withdrawn'); assert.equal(h.transport.calls, 0);
  assert.ok((await h.publisher.inspect(C)).journal.some(e => e.transition === 'rights-withdrawn'));
});
test('window expiry is terminal; never silently reschedule', async t => {
  const h = await harness(t); await h.enqueue(); h.setNow(NOW + 3_600_000);
  await h.publisher.tick('expired'); assert.equal((await item(h)).status, 'expired'); assert.equal(h.transport.calls, 0);
});
test('accepted response lost reconciles exactly once across reopened storage/transport', async t => {
  const h = await harness(t); await h.enqueue(); h.transport.behavior = 'accepted-response-lost';
  await h.publisher.tick('lost'); assert.equal((await item(h)).status, 'uncertain'); assert.equal(h.transport.calls, 1);
  h.setNow(NOW + 600_000); await h.publisher.tick('later'); assert.equal(h.transport.calls, 1);
  const store = new FileStore<CompanyState>(join(h.root, 'queue.sqlite'));
  const transport = new FixtureTransport(join(h.root, 'transport.sqlite'));
  const restarted = new FixturePublisher({ store, authority: h.authority, transport, assetRoot: h.root, pin: PIN,
    now: () => NOW + 600_000, companies: [C], globalDisabled: false });
  try {
    await restarted.recover(C); await restarted.reconcile(C, 'fixture-delivery-one', 'reconcile');
    assert.equal((await restarted.inspect(C)).deliveries[0]!.status, 'delivered'); assert.equal(transport.calls, 1);
  } finally { store.close(); transport.close(); }
});
test('not-found/unavailable reconciliation never permits resend, even after a day', async t => {
  const h = await harness(t); await h.enqueue();
  const port: MockPort = { mode: 'fixture-mock', async send() { return { kind: 'ambiguous' }; }, async reconcile() { return { kind: 'inconclusive' }; } };
  const p = h.compose(port); await p.tick('unknown'); h.setNow(NOW + 86_400_000);
  await p.recover(C); await p.reconcile(C, 'fixture-delivery-one', 'not-found'); await p.tick('later');
  assert.equal((await item(h)).status, 'uncertain'); assert.equal((await item(h)).attempts, 1);
});
test('conflicting receipt account/hash/request key is never accepted', async t => {
  const h = await harness(t); await h.enqueue(); h.transport.behavior = 'accepted-response-lost';
  const port: MockPort = { mode: 'fixture-mock', send: r => h.transport.send(r), async reconcile(request) {
    return { kind: 'found', receipt: { ...request, account: 'fixture-bluesky-main', evidence: 'a'.repeat(64) } };
  } };
  const p = h.compose(port); await p.tick('lost'); await p.reconcile(C, 'fixture-delivery-one', 'conflict');
  assert.equal((await item(h)).status, 'needs_review'); assert.equal(h.transport.calls, 1);
});
test('authoritative local no-effect plus quiescence revalidates then backs off before fresh permit', async t => {
  const h = await harness(t); await h.enqueue(); h.transport.behavior = 'ambiguous-no-effect'; await h.publisher.tick('unknown');
  await h.publisher.reconcile(C, 'fixture-delivery-one', 'prove-no-effect'); const d = await item(h);
  assert.equal(d.status, 'retry_wait'); assert.ok(d.nextAttemptAt >= NOW + 60_000);
  h.setNow(d.nextAttemptAt); h.transport.behavior = 'success'; await h.publisher.tick('fresh-permit');
  assert.equal((await item(h)).status, 'delivered'); assert.equal((await item(h)).fence, 2); assert.equal(h.transport.calls, 2);
});
test('no-effect reconciliation cannot resend after revocation', async t => {
  const h = await harness(t); await h.enqueue(); h.transport.behavior = 'ambiguous-no-effect'; await h.publisher.tick('unknown');
  await h.publisher.revoke(C, 'fixture-approval'); await h.publisher.reconcile(C, 'fixture-delivery-one', 'revoked');
  assert.equal((await item(h)).status, 'needs_review'); assert.equal(h.transport.calls, 1);
});
test('definite no-write uses deterministic persisted backoff and five-attempt budget', async t => {
  const h = await harness(t); await h.enqueue(); h.transport.behavior = 'retryable';
  for (let attempt = 1; attempt <= 5; attempt++) {
    await h.publisher.tick('attempt-' + attempt); const d = await item(h); assert.equal(d.attempts, attempt);
    if (attempt < 5) {
      const base = 60_000 * 2 ** (attempt - 1), previous = attempt === 1 ? NOW : d.nextAttemptAt - base;
      assert.equal(d.status, 'retry_wait'); assert.ok(d.nextAttemptAt >= previous);
      await h.publisher.tick('same-time'); assert.equal(h.transport.calls, attempt); h.setNow(d.nextAttemptAt);
    }
  }
  assert.equal((await item(h)).status, 'needs_review'); assert.equal(h.transport.calls, 5);
});
for (const delay of [-1, NaN, Infinity, 86_400_001, 1.5]) test('malformed/extreme Retry-After held: ' + delay, async t => {
  const h = await harness(t); await h.enqueue();
  const p = h.compose({ mode: 'fixture-mock', async send() { return { kind: 'definite_no_write', retryable: true, retryAfterMs: delay }; },
    async reconcile() { return { kind: 'inconclusive' }; } });
  await p.tick('invalid-delay'); assert.equal((await item(h)).status, 'needs_review');
});
test('validated Retry-After and per-account rate state survive reopening', async t => {
  const h = await harness(t); await h.enqueue();
  const p = h.compose({ mode: 'fixture-mock', async send() { return { kind: 'definite_no_write', retryable: true, retryAfterMs: 300_000 }; },
    async reconcile() { return { kind: 'inconclusive' }; } });
  await p.tick('retry-after'); assert.equal((await item(h)).nextAttemptAt, NOW + 300_000);
  const store = new FileStore<CompanyState>(join(h.root, 'queue.sqlite'));
  try { const s = (await store.load(C))!.state; assert.equal(s.deliveries[0]!.attempts, 1); assert.equal(s.rates['fixture-youtube-main']!.used, 1); verifyJournal(s); }
  finally { store.close(); }
});
for (const failAt of ['intent-and-permit','mock-delivered']) test('audit/state failure at ' + failAt + ' closes effect boundary', async t => {
  const h = await harness(t); await h.enqueue();
  const store: Store<CompanyState> = { load: c => h.store.load(c), async compareAndSwap(c,v,s) {
    if (s.journal.at(-1)?.transition === failAt) throw Error('fixture-storage-unavailable');
    return h.store.compareAndSwap(c,v,s);
  } };
  const p = new FixturePublisher({ store, authority: h.authority, transport: h.transport, assetRoot: h.root,
    pin: PIN, now: () => NOW, companies: [C], globalDisabled: false });
  await assert.rejects(p.tick('storage-failure'), /publisher-unavailable/);
  assert.equal(h.transport.calls, failAt === 'intent-and-permit' ? 0 : 1);
  if (failAt === 'mock-delivered') {
    assert.equal((await item(h)).status, 'dispatching'); await h.publisher.recover(C);
    assert.equal((await item(h)).status, 'uncertain'); await h.publisher.tick('no-replay'); assert.equal(h.transport.calls, 1);
    await h.publisher.reconcile(C, 'fixture-delivery-one', 'recover-outcome'); assert.equal((await item(h)).status, 'delivered');
  } else {
    const claimed = await item(h); assert.equal(claimed.status, 'claimed');
    await h.publisher.recover(C); assert.equal((await item(h)).status, 'claimed');
    await h.publisher.recover(C, new Set([claimed.owner!])); assert.equal((await item(h)).status, 'retry_wait');
  }
});
test('kill/revoke while request is in-flight never claims cancellation undoes effect', async t => {
  const h = await harness(t); await h.enqueue();
  const p = h.compose({ mode: 'fixture-mock', async send(request) {
    const result = await h.transport.send(request); await h.publisher.setKill(C, true); await h.publisher.revoke(C, 'fixture-approval'); return result;
  }, reconcile: r => h.transport.reconcile(r) });
  await p.tick('in-flight'); assert.equal((await item(h)).status, 'uncertain'); assert.equal(h.transport.calls, 1);
  await p.reconcile(C, 'fixture-delivery-one', 'honest-effect'); assert.equal((await item(h)).status, 'delivered');
});
test('asset bytes must still match immediately before intent', async t => {
  const h = await harness(t); await h.enqueue(); await writeFile(join(h.root, 'fixture.png'), Buffer.from('different'));
  await proveNoCall(h, () => h.publisher.tick('changed-assets'));
});
test('CAS starvation is bounded and storage/authority failure never sends', async t => {
  const h = await harness(t); let writes = 0;
  const store: Store<CompanyState> = { load: c => h.store.load(c), async compareAndSwap() { writes++; return false; } };
  const p = new FixturePublisher({ store, authority: h.authority, transport: h.transport, assetRoot: h.root,
    pin: PIN, now: () => NOW, companies: [C], globalDisabled: false });
  await assert.rejects(p.setKill(C, true), /cas-contention/); assert.equal(writes, 8); assert.equal(h.transport.calls, 0);
});
test('logical audit tampering stops reads/dispatch instead of resetting history', async t => {
  const h = await harness(t); await h.enqueue(); const snapshot = (await h.store.load(C))!;
  snapshot.state.journal[0]!.transition = 'tampered'; await h.store.compareAndSwap(C, snapshot.version, snapshot.state);
  await assert.rejects(h.publisher.tick('tampered'), /audit-chain/); assert.equal(h.transport.calls, 0);
});
test('two independent processes contend for durable queue, only one reaches mock send', async t => {
  const h = await harness(t); await h.enqueue();
  const workers = [0,1].map(() => fork(new URL('./queue-worker.ts', import.meta.url), [h.root], {
    execArgv: ['--disable-warning=ExperimentalWarning', '--import', new URL('./no-network.ts', import.meta.url).pathname], silent: true,
  }));
  t.after(async () => { for (const worker of workers) if (!worker.killed && worker.exitCode === null) worker.kill(); });
  const ready = workers.map(w => new Promise<void>((resolve,reject) => { w.once('error', reject); w.once('message', () => resolve()); }));
  const done = workers.map(w => new Promise<void>((resolve,reject) => { let stderr = ''; w.stderr?.on('data', d => { stderr += d; });
    w.once('exit', code => code === 0 ? resolve() : reject(Error('worker ' + code + ' ' + stderr))); }));
  await Promise.all(ready); workers.forEach(w => w.send('go')); await Promise.all(done);
  assert.equal(h.transport.calls, 1); assert.equal((await item(h)).attempts, 1); assert.equal((await item(h)).status, 'delivered');
});
