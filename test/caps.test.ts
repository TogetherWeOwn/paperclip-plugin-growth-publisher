import test from 'node:test';
import assert from 'node:assert/strict';
import { FixturePublisher } from '../src/queue.ts';
import { C, NOW, PIN, approval, envelope, harness } from './helpers.ts';

async function enqueueMany(h: Awaited<ReturnType<typeof harness>>, n: number) {
  for (let i = 0; i < n; i++) {
    const e = envelope(C, 'fixture-delivery-' + i), a = approval(e, 'fixture-approval-' + i);
    h.authority.install(a); await h.publisher.enqueue(e, { id: a.id, revision: 1 });
  }
}
test('100 retained deliveries is a hard cap, with no compaction; tick examines at most ten due entries', async t => {
  const h = await harness(t); await enqueueMany(h, 100);
  const e = envelope(C, 'fixture-overflow'), a = approval(e, 'fixture-overflow-grant'); h.authority.install(a);
  await assert.rejects(h.publisher.enqueue(e, { id: a.id, revision: 1 }), /queue-cap/);
  const result = await h.publisher.tick('bounded-tick');
  assert.equal(result.considered, 10); assert.equal(result.mockCalls, 1);
  const state = await h.publisher.inspect(C); assert.equal(state.deliveries.length, 100);
  assert.ok(state.journal.some(e => e.transition === 'enqueue-refused'));
});
test('one active send per account and persisted per-day cap; no sixth delivery permit', async t => {
  const h = await harness(t); await enqueueMany(h, 6);
  for (let i = 0; i < 5; i++) { h.setNow(NOW + i * 60_000); await h.publisher.tick('minute-' + i); }
  h.setNow(NOW + 300_000); await h.publisher.tick('daily-cap');
  const s = await h.publisher.inspect(C);
  assert.equal(h.transport.calls, 5); assert.equal(s.rates['fixture-youtube-main']!.used, 5);
  assert.equal(s.deliveries.filter(d => d.status === 'needs_review').length, 1);
  assert.ok(s.journal.some(e => e.transition === 'daily-rate-cap'));
});
test('100 control events cap refuses further changes instead of discarding audit', async t => {
  const h = await harness(t);
  for (let i = 2; i < 100; i++) await h.publisher.setKill(C, false);
  await assert.rejects(h.publisher.setKill(C, true), /audit-cap/);
  assert.equal((await h.publisher.inspect(C)).journal.length, 100); assert.equal(h.transport.calls, 0);
});
test('32 per-delivery journal events cap holds uncertainty without replay', async t => {
  const h = await harness(t); await h.enqueue(); h.transport.behavior = 'accepted-response-lost';
  await h.publisher.tick('lost'); h.transport.reconcileUnavailable = true;
  for (let i = 0; i < 14; i++) await h.publisher.reconcile(C, 'fixture-delivery-one', 'held-' + i);
  await assert.rejects(h.publisher.reconcile(C, 'fixture-delivery-one', 'cap'), /audit-cap/);
  const s = await h.publisher.inspect(C); assert.equal(s.journal.filter(e => e.deliveryId !== null).length, 32);
  assert.equal(s.deliveries[0]!.status, 'uncertain'); assert.equal(h.transport.calls, 1);
});
test('handler budget never begins new send after slow claim/authority consumes budget', async t => {
  const h = await harness(t); await h.enqueue(); let calls = 0;
  const p = new FixturePublisher({ store: h.store, authority: h.authority, transport: h.transport, assetRoot: h.root,
    pin: PIN, now: () => NOW, companies: [C], globalDisabled: false, monotonic: () => ++calls < 4 ? 0 : 55_000 });
  const result = await p.tick('budget'); assert.equal(result.mockCalls, 0); assert.equal(h.transport.calls, 0);
});
test('stale authority at each retry refuses and records safe refusal, even after backoff', async t => {
  const h = await harness(t); await h.enqueue(); h.transport.behavior = 'retryable'; await h.publisher.tick('first');
  const d = (await h.publisher.inspect(C)).deliveries[0]!; h.setNow(d.nextAttemptAt); h.authority.unavailable = true;
  await assert.rejects(h.publisher.tick('retry'), /fixture-authority-unavailable/); assert.equal(h.transport.calls, 1);
  const s = await h.publisher.inspect(C); assert.ok(s.journal.some(e => e.transition === 'dispatch-refused'));
});
