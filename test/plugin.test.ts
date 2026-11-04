import test from 'node:test';
import assert from 'node:assert/strict';
import type { PluginContext } from '@paperclipai/plugin-sdk';
import manifest, { TICK } from '../src/manifest.ts';
import { registerTick } from '../src/plugin.ts';
import type { HostDatabase } from '../src/storage.ts';
import { C, harness } from './helpers.ts';

// Compiled against the real pinned SDK, not a handwritten fake jobs API.
const dbTypeCheck = (ctx: PluginContext): HostDatabase => ctx.db;
void dbTypeCheck;
type Handler = Parameters<PluginContext['jobs']['register']>[1];
function context(): { ctx: Pick<PluginContext, 'jobs'>; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  return { handlers, ctx: { jobs: { register(key, handler) { assert.ok(!handlers.has(key)); handlers.set(key, handler); } } } };
}
const job = { jobKey: TICK, runId: 'fixture-scheduler-run', trigger: 'schedule' as const, scheduledAt: '2026-01-01T12:00:00.000Z' };
test('manifest has one minute job, no publish tools/network/secret/authority capabilities', () => {
  assert.deepEqual(manifest.jobs, [{ jobKey: TICK, displayName: 'Fixture publisher tick', schedule: '* * * * *' }]);
  assert.deepEqual(manifest.capabilities, ['jobs.schedule','database.namespace.read','database.namespace.write','database.namespace.migrate']);
  assert.equal(manifest.tools, undefined); assert.equal(manifest.apiRoutes, undefined);
  assert.deepEqual(manifest.database?.coreReadTables, []);
});
test('default registration invokes twice without company context: no configuration means no work', async () => {
  const { ctx, handlers } = context(); registerTick(ctx); const handler = handlers.get(TICK)!;
  await handler(job); await handler({ ...job, trigger: 'retry' });
  assert.equal(handlers.size, 1);
});
test('trusted configured allowlist handles repeated/manual/retry invocations on same durable queue', async t => {
  const h = await harness(t); await h.enqueue(); const { ctx, handlers } = context(); registerTick(ctx, h.publisher);
  const handler = handlers.get(TICK)!; await handler(job); await handler({ ...job, trigger: 'manual' }); await handler({ ...job, trigger: 'retry' });
  assert.equal(h.transport.calls, 1); assert.equal((await h.publisher.inspect(C)).deliveries[0]!.status, 'delivered');
});
test('test harness denies network and model/vendor calls', async () => {
  assert.throws(() => fetch('https://example.invalid'), /network-disabled/);
});
