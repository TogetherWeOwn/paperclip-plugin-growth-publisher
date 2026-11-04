import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from '../src/storage.ts';
import { FixturePublisher } from '../src/queue.ts';
import type { CompanyState, MockPort } from '../src/queue.ts';
import { FixtureAuthority, FixtureTransport } from '../src/testing.ts';
import { makeTarget } from '../src/contract.ts';
import type { Approval, Envelope, Pin, Rights } from '../src/contract.ts';
import { digest, sha256 } from '../src/validation.ts';
export const C = 'fixture-company-alpha';
export const C2 = 'fixture-company-beta';
export const NOW = Date.parse('2026-01-01T12:00:00.000Z');
export const PIN: Pin = { commit: 'a'.repeat(40), schemaDigest: 'b'.repeat(64), template: 'fixture-orchestration-stub', toolchain: 'fixture-stub-v1' };
// Header-only bytes test hash/type orchestration. NOT valid artwork, renderer goldens or UX evidence.
export const BYTES = Buffer.from([137,80,78,71,13,10,26,10,0,0]);
export function envelope(c = C, delivery = 'fixture-delivery-one'): Envelope {
  return { fixtureOnly: true, schemaVersion: 1, policyVersion: 'fixture-policy-v1', companyId: c,
    deliveryId: delivery, contentRevision: 1, platform: 'youtube', account: 'fixture-youtube-main', copyToken: 'fixture-event',
    options: { privacyStatus: 'private' }, disclosure: 'fixture-synthetic', aiProvenance: 'non-ai', aiLabel: false,
    assets: [{ path: 'fixture.png', sha256: sha256(BYTES), bytes: BYTES.length, type: 'image/png', rightsId: 'fixture-rights', rightsRevision: 1 }],
    kit: structuredClone(PIN), scheduledAt: new Date(NOW).toISOString(), timezone: 'UTC',
    windowStart: new Date(NOW).toISOString(), windowEnd: new Date(NOW + 3_600_000).toISOString(), aggregate: null };
}
export function rights(c = C): Rights {
  return { id: 'fixture-rights', revision: 1, companyId: c, withdrawn: false, purpose: 'fixture-publication',
    channel: 'youtube', territory: 'fixture-world', notBefore: new Date(NOW - 1000).toISOString(), expiresAt: new Date(NOW + 86_400_000).toISOString() };
}
export function approval(e = envelope(), approvalId = 'fixture-approval'): Approval {
  return { id: approvalId, revision: 1, companyId: e.companyId, approver: 'fixture-approver', targetDigest: digest(makeTarget(e, PIN)),
    issuedAt: new Date(NOW - 1000).toISOString(), notBefore: new Date(NOW - 1000).toISOString(), expiresAt: new Date(NOW + 86_400_000).toISOString(), epoch: 0 };
}
export async function harness(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'publisher-fixture-'));
  const store = new FileStore<CompanyState>(join(root, 'queue.sqlite'));
  const authority = new FixtureAuthority();
  const transport = new FixtureTransport(join(root, 'transport.sqlite'));
  await writeFile(join(root, 'fixture.png'), BYTES);
  let now = NOW;
  const compose = (port: MockPort = transport, disabled = false) => new FixturePublisher({ store, authority, transport: port,
    assetRoot: root, pin: PIN, now: () => now, companies: [C, C2], globalDisabled: disabled });
  const publisher = compose();
  await publisher.setRights(C, rights()); await publisher.setKill(C, false);
  authority.install(approval());
  t.after(async () => { store.close(); transport.close(); await rm(root, { recursive: true, force: true }); });
  return { root, store, authority, transport, publisher, compose, setNow: (v: number) => { now = v; },
    enqueue: (e = envelope(), ref = { id: 'fixture-approval', revision: 1 }) => publisher.enqueue(e, ref) };
}
