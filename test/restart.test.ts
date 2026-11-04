import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { C, NOW, harness } from './helpers.ts';

for (const crash of ['before-intent','after-intent','after-acceptance']) test('process exit ' + crash + ' recovers without time-only takeover', async t => {
  const h = await harness(t); await h.enqueue();
  const worker = fork(new URL('./queue-worker.ts', import.meta.url), [h.root, crash], {
    execArgv: ['--disable-warning=ExperimentalWarning','--import',new URL('./no-network.ts', import.meta.url).pathname], silent: true,
  });
  t.after(async () => { if (worker.exitCode === null) worker.kill(); });
  const exited = new Promise<void>((resolve,reject) => { worker.once('error', reject); worker.once('exit', code => code === 0 ? resolve() : reject(Error('crash worker failed'))); });
  await new Promise<void>((resolve,reject) => { worker.once('error',reject); worker.once('message', () => resolve()); });
  worker.send('go'); await exited;
  const state = await h.publisher.inspect(C), d = state.deliveries[0]!;
  assert.equal(d.status, crash === 'before-intent' ? 'claimed' : 'dispatching');
  h.setNow(NOW + 600_000); await h.publisher.recover(C); await h.publisher.tick('late-tick');
  assert.equal(h.transport.calls, crash === 'after-acceptance' ? 1 : 0);
  if (crash === 'before-intent') {
    // The test observed process exit, not a lease clock. Intent CAS never committed.
    await h.publisher.recover(C, new Set([d.owner!])); await h.publisher.tick('quiescent');
    assert.equal(h.transport.calls, 1); assert.equal((await h.publisher.inspect(C)).deliveries[0]!.status, 'delivered');
  } else {
    await h.publisher.reconcile(C, d.target.envelope.deliveryId, 'restarted-reconcile');
    assert.equal((await h.publisher.inspect(C)).deliveries[0]!.status, crash === 'after-acceptance' ? 'delivered' : 'uncertain');
  }
});
