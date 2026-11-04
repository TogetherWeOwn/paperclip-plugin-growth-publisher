# Fixture growth publisher

`@togetherweown/paperclip-plugin-growth-publisher` — an **offline, synthetic-fixture-only** publisher foundation for SDK `2026.1023.0`, Node `24.21.0` or later. Plugin ID: `togetherweown.growth-publisher`.

**Draft foundation, not an installable or accepted publishing service.** No live authority, organic/ad adapter, network transport, credentials, member data, metrics, host installation or production activation is provided. Ads are hard **PAUSED**; ad platforms/MCP writes, engagement, DMs, Discord writes, Reddit and Steam Curator writes are unsupported. YouTube fixtures must explicitly be private.

## Local verification

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

Dependencies are pinned in the lockfile. Tests deny fetch, HTTP(S), TCP/TLS and UDP, including independent Node fixture workers. Tests use synthetic local bytes, fixture authorities, SQLite files, fake clocks and an injected mock transport. No service account or token is needed. SDK types are compiled; no host plugin is installed or configured.

## Foundation

- Closed 16 KiB envelopes contain approved text **tokens**, never arbitrary model prose. ASCII-only identifiers/tokens reject normalization, control/bidi/zero-width/confusable substitutions. This is an intentionally small allowed vocabulary, **not** a general-purpose PII or natural-language claim detector.
- Exact targets hash immutable normalized copy, code-provided non-resolving fixture URL, final payload/options, ordered actual local byte hashes, rights revisions, schedule/window, disclosure/AI-label choices, policy and the orchestration pin. Fixture authorities cannot be created by envelope flags.
- A single per-company CAS aggregate serializes queue, approval reservations/revocation, rights, kill/rate controls and hash-chained logical audit. The journal is not tamper-proof against a database administrator.
- Intent is committed before mock send; outcome is committed afterwards. Uncertain responses, crashes and outcome-write failures are non-sendable until reconciliation. Not-found is not resend permission. Only authoritative no-effect **and quiescence**, bound to the exact request, allow revalidation and backoff before a fresh fenced permit.
- No lease-clock takeover of a potentially active request. A pre-intent claim needs independently observed owner quiescence before release. A started request is held and reconciled, never declared cancelled remotely.
- Default global and company kills deny dispatch. The scheduler declares exactly one minute `publisher-tick` and uses `ctx.jobs.register`; `jobs.schedule` is a manifest capability, not a callable SDK API. The deployed entrypoint registers an inert handler: no configured companies or authority means no work. Job run IDs are audit correlation only.

## Bounds

10 trusted synthetic companies, 100 retained deliveries/company, 8 assets/envelope (4 MiB/asset), 2 MiB aggregate, 32 journal entries/delivery and 100 control/refusal entries. No automatic compaction. Reaching a cap stops new work for deliberate retention/export handling. At most 10 due items/tick, one active send/account, five permits/account/UTC day and five attempts/delivery. Backoff is persisted exponential 60 seconds upward, deterministic bounded jitter, and validated Retry-After (maximum 24 hours), constrained by the original approval/window. No sleeping for retries.

A tick has a 60-second return deadline and begins no new send after 55 seconds; mock requests have a five-second deadline. A timed-out operation is not aborted. A late result may still be journaled, but does not authorize another send. No external resources are created and spend is zero, so resource TTL/teardown and credential rotation are not applicable to this foundation. Queue expiry is absolute and never extends the approval window.

## Persistence

`FileStore` is a real file-backed `node:sqlite` **fixture adapter**, including independent-process CAS tests; it is never a production fallback. `HostStore` uses namespace-scoped SELECT, INSERT ON CONFLICT DO NOTHING and versioned UPDATE, with affected `rowCount` as its only CAS result. It requires an explicit trusted SQL-contract proof and is not selected by the default entrypoint. No SDK transaction, RETURNING, trigger or core-table capability is assumed. The namespace migration is literal because the verified migration runner does not substitute placeholders.

## Rendering checkpoint — outstanding

The only supported pin is explicitly named `fixture-orchestration-stub`. Header-only test bytes are hash/type orchestration data, **not artwork**, valid renderer goldens or UX evidence. No layout, brand tokens, kit data schema, font or ffmpeg preset has been invented. The actual merged design kit must be pinned by immutable commit and schema digest, integrated with approved assets/toolchain, and its four template/crop previews and UX review verified before full acceptance. Stub success never proves a real rendered publication or human post approval.

See [THREAT-MODEL.md](THREAT-MODEL.md) and [ACCEPTANCE.md](ACCEPTANCE.md). This repository follows the organisation [contribution contract](https://github.com/TogetherWeOwn/.github/blob/main/CONTRIBUTING.md) and [pipeline standard](https://github.com/TogetherWeOwn/.github/blob/main/PIPELINE-STANDARD.md). Independent Security acceptance and final review are required. Any future activation additionally requires current exact post approval, rights, platform access/review, operator install/configuration and production-release authorization. Merging offline code authorizes none of those actions.
