# Acceptance evidence — draft foundation

**Not accepted for installation or live publishing.** Independent Security review, final code review, required CI/reviewer checks, repository setup and real design-kit integration remain gates. No operator install/configuration was performed. No live post, platform access application, credential, account or paid service was created.

## Executed locally, 2026-11-04

Node `v24.21.0`; pinned SDK `2026.1023.0`.

| Command | Observed result |
| --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund` | Pinned development dependencies provisioned; no lifecycle scripts |
| `npm run check` | Type checking passed; **104 tests passed, 0 failed, 0 skipped**; declaration/JS build passed |
| `actionlint -shellcheck= -pyflakes=` v1.7.7 | Passed after checksum verification |
| `zizmor --offline .github/workflows` v1.32.0 | No findings at default persona; tool reports 8 default suppressions, no repository ignore rules |
| `bash -n .github/scripts/scan-secrets.sh` | Passed |
| `git diff --check` | Passed |
| `gitleaks git --pre-commit --staged --redact --exit-code 1` v8.30.1 | Staged source scanned; no leaks found |

Workflow lint tools ran from checksum-verified temporary directories, without host installation. The initial local zizmor invocation rejected an empty inherited GitHub-token variable; the successful offline invocation explicitly unset those variables. An initial low self-repository suggestion conflicted with the organisation-pinned actionlint syntax; scanner wiring was simplified to a shared shell script instead of suppressing the finding or weakening checks. No remote CI result is asserted by these local results.

## Policy-to-test matrix

All tests run with outbound network disabled; synthetic authorities and transports only.

| Contract class | Evidence in changed tests |
| --- | --- |
| Closed schema, unknown fields, booleans, types, versions, prototype/hostile JSON, bounds and Unicode | `test/contract.test.ts` — canonical/closed linter refusal cases |
| No real/member claims, email, click joins, partnerships, fake testimonials or invite rewards | `test/contract.test.ts` — finite copy vocabulary rejects those inputs; not general prose classification |
| Private-only YouTube, unknown AI provenance, required disclosure and AI labels, k>=50 evidence | `test/contract.test.ts` — named positive and negative cases |
| Exact target binding: copy/link/options/account/platform/media hashes/rights/kit/schedule | `test/contract.test.ts` — target edits change digest; missing/changed pin refuses |
| Missing/future/expired/stale/wrong-scope/caller approval and authority outage | `test/queue.test.ts` — no-call refusal cases and fresh dispatch proof |
| Single-use reservation, duplicate enqueue, conflicting reuse, scheduler repeats | `test/queue.test.ts`; `test/plugin.test.ts` — one mock effect |
| Current rights/channel/purpose/territory/duration/withdrawal; local file containment/hash/type | `test/contract.test.ts`; `test/queue.test.ts` |
| Independent-process CAS insert/update races and actual queue claim/send race | `test/storage.test.ts`; `test/queue.test.ts` — two OS processes, real file-backed SQLite |
| Process exit before intent, after intent, after mock acceptance; no clock-only takeover | `test/restart.test.ts` — actual child exit and reopen/recovery |
| Persisted backoff/Retry-After/rate/attempt state, expiry, malformed delays | `test/queue.test.ts`; `test/caps.test.ts` |
| Uncertain success/reconcile hit/conflict/inconclusive/no-effect plus quiescence | `test/queue.test.ts`; `test/restart.test.ts` |
| Intent/outcome audit-write failure, journal corruption, control/delivery/journal/byte/CAS/handler caps | `test/queue.test.ts`; `test/caps.test.ts`; `test/storage.test.ts` |
| Default kill, in-flight kill/revoke, revocation/withdrawal restart, company isolation | `test/queue.test.ts`; `test/storage.test.ts` |
| Actual SDK manifest/handler, missing company context, trusted allowlist, SQL rowCount/result errors | `test/plugin.test.ts`; `test/storage.test.ts` |
| Disabled network/platform/ads/DM/engagement surfaces | Manifest capability inventory, schema refusal tests, network-denying test preloader |

## Not run / not satisfied

- **Actual merged kit rendering:** no merged immutable kit/schema/assets/UX evidence was available at the integration checkpoint. Four genuine template/crop outputs, local font/art rights, overflow/missing-label cases, pinned Satori/resvg dependencies and approved ffmpeg preset integration are outstanding. No renderer exists yet. Header-only fixture bytes are not real previews. No substitute visual design or host ffmpeg installation was attempted.
- **Host SQL integration:** SDK structural compatibility, local namespace/migration/SQL contract tests and read-only shipped-validator inspection do not prove PostgreSQL atomicity/affected-row mapping. The host adapter has no production proof and remains unavailable by default. No installed runtime or host DB was modified.
- **Live approval/governance/provider integration:** absent, intentionally. No exposed agent tools means native-tool governance is not claimed as exercised. No real human post approval is imported or synthesized.
- **Remote gates:** local results are not CI, Devin review, independent Security acceptance or final reviewer approval. Draft status remains until full implementation/integration and gates complete.
- **Production deploy paths/provider HEAD deployments:** final merge reviewer must verify both automatic/scheduled paths and provider state. Offline local testing does not establish a no-production-deploy claim.

## Installation/revocation runbook boundary

There is no installation authorization or credential configuration in this change. The published package is private and the default worker is inert. Do not install it to test this foundation. Later activation requires Security acceptance tied to exact source/artifact/config/capabilities, verified platform access, current rights and exact saved post approval, operator-controlled install/configuration, and production-release approval. Credential creation/rotation and spend have separate owner gates.

For local fixture recovery, preserve the queue and mock ledger files. Reopen with the same trusted synthetic composition, inspect/verify the journal, recover dispatching items to uncertainty, and reconcile exact request evidence. Lift no kill on restart. Release a claimed-before-intent owner only with independently observed quiescence. At retention/audit caps, stop and retain evidence; this version has no deletion/compaction API.
