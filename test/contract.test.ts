import test from 'node:test';
import assert from 'node:assert/strict';
import { symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkRights, makeTarget, parseApproval, parseEnvelope, parseRights, verifyAssets } from '../src/contract.ts';
import { canonical, digest } from '../src/validation.ts';
import { C, NOW, PIN, approval, envelope, harness, rights } from './helpers.ts';

test('canonical version is stable, ordered arrays bind, and hostile JSON refuses', () => {
  assert.equal(canonical({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.notEqual(digest([1,2]), digest([2,1]));
  for (const v of [NaN, Infinity, undefined, 1.5, new Date(), JSON.parse('{"__proto__":{}}'), { constructor: 'x' }, { get x() { throw Error('getter-ran'); } }]) {
    assert.throws(() => canonical(v));
  }
  const cycle: unknown[] = []; cycle.push(cycle); assert.throws(() => canonical(cycle), /depth/);
});
const malformed: [string, (x: Record<string, any>) => void][] = [
  ['unknown-field', e => { e.memberId = 'fixture-member'; }],
  ['schema-version', e => { e.schemaVersion = 2; }], ['false-fixture', e => { e.fixtureOnly = false; }],
  ['caller-approval', e => { e.approved = true; }], ['account', e => { e.account = 'live-account'; }],
  ['no-company', e => { delete e.companyId; }], ['ad-write', e => { e.platform = 'meta-ads'; }],
  ['reddit', e => { e.platform = 'reddit'; }], ['steam-curator', e => { e.platform = 'steam-curator'; }],
  ['omitted-youtube-visibility', e => { e.options = {}; }], ['public-youtube', e => { e.options.privacyStatus = 'public'; }],
  ['unlisted-youtube', e => { e.options.privacyStatus = 'unlisted'; }], ['missing-disclosure', e => { delete e.disclosure; }],
  ['unknown-ai', e => { delete e.aiProvenance; }], ['ai-label', e => { e.aiProvenance = 'ai'; e.aiLabel = false; }],
  ['small-aggregate', e => { e.aggregate = { count: 49, evidence: 'fixture-aggregate-v1' }; }],
  ['unproven-aggregate', e => { e.aggregate = { count: 50 }; }],
  ['asset-overflow', e => { e.assets = Array(9).fill(e.assets[0]); }],
  ['wrong-type', e => { e.contentRevision = '1'; }], ['invalid-time', e => { e.scheduledAt = '2026-02-30T00:00:00.000Z'; }],
  ['window-boundary', e => { e.windowEnd = e.scheduledAt; }], ['bad-timezone', e => { e.timezone = 'America/New_York'; }],
  ['remote-asset', e => { e.assets[0].path = 'https://example.invalid/media.png'; }],
  ['traversal', e => { e.assets[0].path = '../fixture.png'; }], ['svg', e => { e.assets[0].type = 'image/svg+xml'; }],
  ['banned-partnership', e => { e.copyToken = 'Official partnership endorsement'; }],
  ['fake-testimonial', e => { e.copyToken = 'A member says this reward is amazing'; }],
  ['invite-rewards', e => { e.copyToken = 'Invite friends for rewards'; }],
  ['member-facts', e => { e.copyToken = 'member 123456789012345678 clicked'; }],
  ['email', e => { e.copyToken = 'fixture@example.invalid'; }], ['click-join', e => { e.clickId = 'abc'; }],
  ['control', e => { e.copyToken = 'fixture-event\n'; }], ['bidi', e => { e.copyToken = 'fixture-‮event'; }],
  ['zero-width', e => { e.copyToken = 'fixture-​event'; }], ['confusable', e => { e.copyToken = 'fixture-evеnt'; }],
  ['unicode-normalization', e => { e.copyToken = 'ｆixture-event'; }],
  ['oversized', e => { e.copyToken = 'x'.repeat(17000); }],
];
for (const [name, mutate] of malformed) test('closed linter refuses ' + name, async t => {
  const h = await harness(t), e = structuredClone(envelope()); mutate(e);
  await assert.rejects(h.publisher.enqueue(e, { id: 'fixture-approval', revision: 1 }));
  assert.equal(h.transport.calls, 0); assert.equal((await h.publisher.inspect(C)).deliveries.length, 0);
});
test('private YouTube, explicit non-AI and evidenced k=50 fixture pass', () => {
  const e = envelope(); e.aggregate = { count: 50, evidence: 'fixture-aggregate-v1' };
  assert.equal(parseEnvelope(e).platform, 'youtube');
  assert.throws(() => parseApproval({ ...approval(), approver: 'caller' }));
});
test('copy/options/account/assets/revision/schedule/disclosure/kit all bind exact target', () => {
  const e = envelope(), original = digest(makeTarget(e, PIN));
  const edits: ((v: ReturnType<typeof makeTarget>) => void)[] = [
    t => { t.envelope.copyToken = 'fixture-recap'; }, t => { t.copyHash = 'c'.repeat(64); }, t => { t.linkHash = 'c'.repeat(64); },
    t => { t.envelope.account = 'fixture-bluesky-main'; }, t => { t.envelope.platform = 'bluesky'; },
    t => { t.envelope.assets[0]!.sha256 = 'c'.repeat(64); }, t => { t.envelope.assets[0]!.rightsRevision++; },
    t => { t.envelope.contentRevision++; }, t => { t.envelope.scheduledAt = '2026-01-01T12:01:00.000Z'; },
    t => { t.envelope.aiLabel = true; }, t => { t.envelope.kit.commit = 'd'.repeat(40); },
    t => { t.envelope.options = { visibility: 'fixture' }; },
  ];
  for (const edit of edits) { const target = makeTarget(e, PIN); edit(target); assert.notEqual(digest(target), original); }
  assert.throws(() => makeTarget({ ...e, kit: { ...PIN, commit: 'c'.repeat(40) } }, PIN), /kit-pin/);
  assert.throws(() => makeTarget({ ...e, kit: null }, PIN));
});
for (const [name, edit] of [
  ['withdrawn', (r: ReturnType<typeof rights>) => { r.withdrawn = true; }],
  ['revision', (r: ReturnType<typeof rights>) => { r.revision++; }],
  ['channel', (r: ReturnType<typeof rights>) => { r.channel = 'bluesky'; }],
  ['expired', (r: ReturnType<typeof rights>) => { r.expiresAt = new Date(NOW).toISOString(); }],
  ['future', (r: ReturnType<typeof rights>) => { r.notBefore = new Date(NOW + 1).toISOString(); }],
  ['duration', (r: ReturnType<typeof rights>) => { r.expiresAt = new Date(NOW + 1000).toISOString(); }],
] as const) test('rights denies ' + name, () => {
  const r = rights(); edit(r); assert.throws(() => checkRights(envelope(), [r], NOW));
});
test('rights purpose/territory/missing rights are closed', () => {
  assert.throws(() => parseRights({ ...rights(), purpose: 'advertising' }));
  assert.throws(() => parseRights({ ...rights(), territory: 'unverified' }));
  assert.throws(() => checkRights(envelope(), [], NOW));
});
test('asset containment, missing files, wrong byte hash and type fail closed', async t => {
  const h = await harness(t); await verifyAssets(envelope(), h.root);
  await writeFile(join(h.root, 'fixture.png'), Buffer.from('changed'));
  await assert.rejects(verifyAssets(envelope(), h.root), /asset-size|asset-hash/);
  const e = envelope(); e.assets[0]!.path = 'missing.png'; await assert.rejects(verifyAssets(e, h.root));
  await symlink('/etc/passwd', join(h.root, 'escape.png')); e.assets[0]!.path = 'escape.png';
  await assert.rejects(verifyAssets(e, h.root), /asset-containment/);
});
