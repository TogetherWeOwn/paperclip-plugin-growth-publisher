import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, extname } from 'node:path';
import { canonical, company, digest, hex, id, integer, list, literal, object, requireThat, sha256, text, utc } from './validation.ts';

export const POLICY = 'fixture-policy-v1';
export const COPY = Object.freeze({
  'fixture-event': 'Synthetic event announcement. Fixture only.',
  'fixture-recap': 'Synthetic weekly recap. Fixture only.',
});
export interface Pin { commit: string; schemaDigest: string; template: 'fixture-orchestration-stub'; toolchain: 'fixture-stub-v1' }
export interface Asset { path: string; sha256: string; bytes: number; type: 'image/png' | 'image/jpeg' | 'video/mp4'; rightsId: string; rightsRevision: number }
export interface Envelope {
  fixtureOnly: true; schemaVersion: 1; policyVersion: typeof POLICY;
  companyId: string; deliveryId: string; contentRevision: number;
  platform: 'youtube' | 'bluesky'; account: string; copyToken: keyof typeof COPY;
  options: { privacyStatus: 'private' } | { visibility: 'fixture' };
  disclosure: 'fixture-synthetic'; aiProvenance: 'ai' | 'non-ai'; aiLabel: boolean;
  assets: Asset[]; kit: Pin; scheduledAt: string; timezone: 'UTC'; windowStart: string; windowEnd: string;
  aggregate: null | { count: number; evidence: 'fixture-aggregate-v1' };
}
export interface Target {
  serializationVersion: 1; envelope: Envelope; copyHash: string; linkHash: string; payloadHash: string;
}
export interface Rights {
  id: string; revision: number; companyId: string; withdrawn: boolean;
  purpose: 'fixture-publication'; channel: 'youtube' | 'bluesky'; territory: 'fixture-world';
  notBefore: string; expiresAt: string;
}
export interface ApprovalRef { id: string; revision: number }
export interface Approval {
  id: string; revision: number; companyId: string; approver: 'fixture-approver';
  targetDigest: string; issuedAt: string; notBefore: string; expiresAt: string; epoch: number;
}
export interface Authority {
  // Trusted composition only: no JSON flag constructs or selects an authority.
  verify(companyId: string, ref: ApprovalRef, targetDigest: string): Promise<Approval>;
}
export function approvalRef(v: unknown): ApprovalRef {
  const x = object(v, ['id', 'revision']); return { id: id(x.id), revision: integer(x.revision, 1, 1_000_000) };
}
export function parseApproval(v: unknown): Approval {
  const x = object(v, ['id','revision','companyId','approver','targetDigest','issuedAt','notBefore','expiresAt','epoch']);
  return { id: id(x.id), revision: integer(x.revision, 1, 1_000_000), companyId: company(x.companyId),
    approver: literal(x.approver, ['fixture-approver']), targetDigest: hex(x.targetDigest),
    issuedAt: utc(x.issuedAt), notBefore: utc(x.notBefore), expiresAt: utc(x.expiresAt), epoch: integer(x.epoch, 0, 1_000_000) };
}
export function parseRights(v: unknown): Rights {
  const x = object(v, ['id','revision','companyId','withdrawn','purpose','channel','territory','notBefore','expiresAt']);
  return { id: id(x.id), revision: integer(x.revision, 1, 1_000_000), companyId: company(x.companyId),
    withdrawn: literal(x.withdrawn, [true, false]), purpose: literal(x.purpose, ['fixture-publication']),
    channel: literal(x.channel, ['youtube','bluesky']), territory: literal(x.territory, ['fixture-world']),
    notBefore: utc(x.notBefore), expiresAt: utc(x.expiresAt) };
}
function parsePin(v: unknown): Pin {
  const x = object(v, ['commit','schemaDigest','template','toolchain']);
  return { commit: text(x.commit, /^[a-f0-9]{40}$/), schemaDigest: hex(x.schemaDigest),
    template: literal(x.template, ['fixture-orchestration-stub']), toolchain: literal(x.toolchain, ['fixture-stub-v1']) };
}
function parseAsset(v: unknown): Asset {
  const x = object(v, ['path','sha256','bytes','type','rightsId','rightsRevision']);
  const path = text(x.path, /^[a-zA-Z0-9/_-]+\.(png|jpg|mp4)$/, 200);
  requireThat(!path.startsWith('/') && !path.includes('//'), 'asset-path');
  return { path, sha256: hex(x.sha256), bytes: integer(x.bytes, 1, 4 * 1024 * 1024),
    type: literal(x.type, ['image/png','image/jpeg','video/mp4']), rightsId: id(x.rightsId), rightsRevision: integer(x.rightsRevision, 1, 1_000_000) };
}
export function parseEnvelope(value: unknown): Envelope {
  // canonical() also refuses getters, cycles, non-JSON numbers and forbidden keys before size calculation.
  requireThat(Buffer.byteLength(canonical(value, 16 * 1024)) <= 16 * 1024, 'envelope-cap');
  const x = object(value, ['fixtureOnly','schemaVersion','policyVersion','companyId','deliveryId','contentRevision','platform','account',
    'copyToken','options','disclosure','aiProvenance','aiLabel','assets','kit','scheduledAt','timezone','windowStart','windowEnd','aggregate']);
  const platform = literal(x.platform, ['youtube', 'bluesky']);
  const account = literal(x.account, [`fixture-${platform}-main`]);
  const options = platform === 'youtube'
    ? { privacyStatus: literal(object(x.options, ['privacyStatus']).privacyStatus, ['private']) }
    : { visibility: literal(object(x.options, ['visibility']).visibility, ['fixture']) };
  const aggregate = x.aggregate === null ? null : object(x.aggregate, ['count','evidence']);
  const result: Envelope = {
    fixtureOnly: literal(x.fixtureOnly, [true]), schemaVersion: literal(x.schemaVersion, [1]), policyVersion: literal(x.policyVersion, [POLICY]),
    companyId: company(x.companyId), deliveryId: id(x.deliveryId), contentRevision: integer(x.contentRevision, 1, 1_000_000),
    platform, account, copyToken: literal(x.copyToken, ['fixture-event','fixture-recap']), options,
    disclosure: literal(x.disclosure, ['fixture-synthetic']), aiProvenance: literal(x.aiProvenance, ['ai','non-ai']),
    aiLabel: literal(x.aiLabel, [true,false]), assets: list(x.assets, 1, 8, parseAsset), kit: parsePin(x.kit),
    scheduledAt: utc(x.scheduledAt), timezone: literal(x.timezone, ['UTC']), windowStart: utc(x.windowStart), windowEnd: utc(x.windowEnd),
    aggregate: aggregate === null ? null : { count: integer(aggregate.count, 50, 1_000_000), evidence: literal(aggregate.evidence, ['fixture-aggregate-v1']) },
  };
  requireThat(result.aiProvenance !== 'ai' || result.aiLabel, 'ai-label');
  const start = Date.parse(result.windowStart), end = Date.parse(result.windowEnd), scheduled = Date.parse(result.scheduledAt);
  requireThat(start <= scheduled && scheduled < end && end - start <= 24 * 60 * 60 * 1000, 'window');
  requireThat(new Set(result.assets.map(a => a.path)).size === result.assets.length, 'duplicate-assets');
  return result;
}
export function makeTarget(input: unknown, expectedPin: Pin): Target {
  const envelope = parseEnvelope(input);
  requireThat(canonical(envelope.kit) === canonical(parsePin(expectedPin)), 'kit-pin');
  const copy = COPY[envelope.copyToken];
  // Deliberately non-resolving fixture URL. No model-supplied URL, attribution tag or click identifier.
  const url = 'https://example.invalid/fixture/' + envelope.copyToken;
  return { serializationVersion: 1, envelope, copyHash: sha256(Buffer.from(copy)), linkHash: sha256(Buffer.from(url)),
    payloadHash: digest({ copy, url, options: envelope.options, disclosure: envelope.disclosure, aiLabel: envelope.aiLabel,
      assets: envelope.assets.map(a => a.sha256) }) };
}
export async function verifyAssets(envelope: Envelope, root: string): Promise<void> {
  const base = await realpath(root);
  for (const asset of envelope.assets) {
    const path = await realpath(resolve(base, asset.path));
    const rel = relative(base, path);
    requireThat(rel !== '' && !rel.startsWith('..') && !isAbsolute(rel), 'asset-containment');
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      requireThat(stat.isFile() && stat.size === asset.bytes, 'asset-size');
      const bytes = await handle.readFile();
      requireThat(bytes.length === asset.bytes && sha256(bytes) === asset.sha256, 'asset-hash');
      const valid = asset.type === 'image/png' ? extname(asset.path) === '.png' && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        : asset.type === 'image/jpeg' ? extname(asset.path) === '.jpg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : extname(asset.path) === '.mp4' && bytes.subarray(4,8).toString() === 'ftyp';
      requireThat(valid, 'asset-type');
    } finally { await handle.close(); }
  }
}
export function checkRights(envelope: Envelope, records: readonly Rights[], now: number): string {
  const used = envelope.assets.map(asset => {
    const r = records.find(r => r.id === asset.rightsId);
    requireThat(r && !r.withdrawn && r.companyId === envelope.companyId && r.revision === asset.rightsRevision, 'rights-current');
    requireThat(r.purpose === 'fixture-publication' && r.channel === envelope.platform && r.territory === 'fixture-world', 'rights-scope');
    requireThat(Date.parse(r.notBefore) <= now && now < Date.parse(r.expiresAt) && Date.parse(envelope.windowEnd) <= Date.parse(r.expiresAt), 'rights-time');
    return r;
  });
  return digest(used);
}
export function checkApproval(a: Approval, ref: ApprovalRef, envelope: Envelope, targetDigest: string, now: number): void {
  requireThat(a.id === ref.id && a.revision === ref.revision && a.companyId === envelope.companyId && a.targetDigest === targetDigest, 'approval-target');
  requireThat(Date.parse(a.issuedAt) <= now && Date.parse(a.notBefore) <= now && now < Date.parse(a.expiresAt), 'approval-time');
  requireThat(Date.parse(envelope.windowStart) >= Date.parse(a.notBefore) && Date.parse(envelope.windowEnd) <= Date.parse(a.expiresAt), 'approval-window');
}
