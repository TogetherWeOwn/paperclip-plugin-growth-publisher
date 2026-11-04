import { join } from 'node:path';
import { FileStore } from '../src/storage.ts';
import { FixturePublisher } from '../src/queue.ts';
import type { CompanyState } from '../src/queue.ts';
import { FixtureAuthority, FixtureTransport } from '../src/testing.ts';
import { approval, C, NOW, PIN } from './helpers.ts';
const root = process.argv[2]!;
const store = new FileStore<CompanyState>(join(root, 'queue.sqlite'));
const transport = new FixtureTransport(join(root, 'transport.sqlite'));
const authority = new FixtureAuthority(); authority.install(approval());
const crash = process.argv[3];
const publisher = new FixturePublisher({
  store: crash === 'before-intent' ? { load: c => store.load(c), async compareAndSwap(c,v,s) {
    if (s.journal.at(-1)?.transition === 'intent-and-permit') process.exit(0);
    return store.compareAndSwap(c,v,s);
  } } : store,
  transport: crash === 'after-intent' || crash === 'after-acceptance' ? { mode: 'fixture-mock', async send(r) {
    if (crash === 'after-acceptance') await transport.send(r);
    process.exit(0);
  }, reconcile: r => transport.reconcile(r) } : transport,
  authority, assetRoot: root, pin: PIN, now: () => NOW, companies: [C], globalDisabled: false,
});
process.once('message', async () => {
  try { await publisher.tick('independent-process'); }
  catch { process.exitCode = 1; }
  finally { store.close(); transport.close(); process.disconnect(); }
});
process.send!('ready');
