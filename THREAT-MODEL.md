# Fixture publisher threat model

Status: draft; independent Security acceptance outstanding. Maintainer: repository maintainers. SDK/API compatibility is exactly `2026.1023.0`. No external platform API is implemented.

## Assets and ceiling

The package holds no service credential and resolves no secret. Its capability ceiling is scheduled job registration and plugin-namespace database access/migration. No core tables, HTTP, secret access, account discovery, model invocation, member records, public routes, agent tools, shell tools or platform write API is registered. No billable upstream resource exists; lifetime/spend/teardown controls for provisioned resources are not applicable. Synthetic delivery windows expire absolutely and mock calls/retention are bounded in code.

| Surface | Allowed | Deliberately forbidden |
| --- | --- | --- |
| Scheduler | One minute tick, trusted fixture composition | Caller company scope, raw publish bypass, host cron/timers for retries |
| Enqueue (library/harness only) | Closed synthetic bundle and exact approval reference | Approval boolean, free-form prose/link/account, unknown fields |
| Controls (harness only) | Persist rights revisions/revocation and default-on kill | Agent approve/unkill tools, live human approval import |
| Storage | Bound company SELECT and aggregate CAS | Core/member tables, arbitrary schema names/SQL, SDK transactions/RETURNING/triggers |
| Mock send/reconcile | Exact request/account/target and closed matching receipt | All live organic/ad/engagement/DM writes, time-only resend |
| Assets | Hash/size/type checked local fixture bytes | Remote media/fonts, SVG, path escape, renderer/ffmpeg shell execution |

## Principals and boundaries

The host supplies job correlation, not company or approval authority. A trusted application composition supplies an allowlist of synthetic companies, the authority, pinned orchestration reference, local fixture root, store and mock port. Input JSON cannot choose them. `FixtureAuthority` lives in the explicitly named testing entrypoint and accepts only synthetic approvers/scopes. It is neither evidence of a real human approval nor an install-time authority option.

The queue reserves approvals and serializes controls/claims/audit in the same company row. Authority is queried freshly before enqueue, claim, dispatch permit and retry. The digest binds exact target and content revision; reservation binds the grant to one delivery. Tenant predicates, account membership and exact target/receipt checks prevent copied references or cross-tenant grants from authorizing a send. Changing rights revision or current approval proof invalidates existing targets. Fixture account aliases are not live account identifiers.

The host SQL port remains unavailable without a trusted proof of real atomic CAS and affected-row behavior. Unit mocks and SDK declarations do not provide that proof. The migration namespace is derived from the manifest ID/slug, not supplied by an envelope. No in-memory production fallback exists.

## Deputy, injection and credential escape

Every envelope/nested object is closed. Copy is selected from a finite synthetic vocabulary. Banned claims and identifiers fail by exclusion, not probabilistic classification or a claim that regex detects all PII. Unicode normalization and non-ASCII substitutions are rejected. Task prose, comments, kit files, media metadata and transport exception bodies never alter policy, caps, account selection, authority or destination.

No credential or member data enters the application. Audits contain correlation and digests, not copy, asset paths or exception bodies. Known-company enqueue/dispatch refusals append fixed events; malformed inputs without a validated configured company cannot select an audit partition. Audit/state unavailability stops dispatch. The scheduled entrypoint projects failures to a fixed error string rather than exposing adapter diagnostics. Trusted fixture control/store APIs remain internal testing surfaces, not tool responses. Filesystem denial codes do not expose raw paths through enqueue's boundary.

## Concurrency, replay and uncertainty

A unique company/delivery/target key deduplicates enqueue but is not sending authority. Versioned aggregate CAS, unpredictable owner tokens and increasing fences protect claim/outcome writes. Account rate reservation and intent precede the mock effect. Retried CAS operations repeat pure authority reads, never transport calls. Independent OS processes contend on actual SQLite state.

An elapsed deadline is not proof of quiescence. Abandoned pre-intent claims stay held unless the harness independently observes their owner exit. Dispatching/reconciling items become uncertain on recovery; they do not automatically become queued. Exact accepted receipts reconcile to one mock delivery. Missing/inconclusive or unavailable evidence stays held. Authoritative no-effect evidence must bind to the exact request and prove the mock sender finished before current approval/rights/kill/rate checks and another permit.

Kill, rights withdrawal and revocation prevent future permits at their aggregate CAS serialization point. An already issued permit/request cannot be recalled. In-flight results are held and reconciled even if the effect happened after kill. Outcome-audit failure leaves the preexisting durable dispatch intent, never an unqualified success. Repeated failure cannot silently truncate history.

## Lifecycle limits and recovery

All state/audit caps, account/day counts, attempt counts and next-attempt times persist. No retry sleep, unbounded scan or automatic history compaction exists. Application kills survive process restart and scheduler manifest reactivation. Global composition defaults disabled. Reaching a byte/journal/retention cap requires deliberate operator retention handling; the foundation provides no automatic audit deletion endpoint.

Tick return timeout is 60 seconds, with a 55-second latest-send check and five-second mock deadline. These are not cancellation guarantees: pending store reads, mock operations or outcome journaling can complete late. No new send is started after the budget. Unknown in-flight state stays held. Synthetic test SQLite files are destroyed by each test's cleanup; no cloud resources or internal credentials need teardown.

## Residual and outstanding risks

- Process/host administrator compromise can replace composition, code or stored JSON. Logical hash chaining detects accidental edits, not an administrator able to rewrite the full chain. This is not an OS sandbox.
- Fixture roots are trusted immutable directories. Path containment/O_NOFOLLOW/hash checks defend envelope mistakes; a hostile host racing parent directories is not contained by the fixture adapter. No live adapter may reuse this assumption without review.
- Media signature checking is not a full decoder or visual/rights verifier. Actual kit rendering, local font/art validation, overflow/labels, four preview outputs and UX evidence remain outstanding.
- Host PostgreSQL execution semantics have not been exercised; there is no production SQL proof or live approval integration.
- No external exactly-once claim, live activation, production readiness or Security acceptance is made.

## REA angle and provenance

The implementation uses documented SDK types and read-only inspection of the shipped job/SQL validators, plus local scheduled-job plugin examples. MIT `TogetherWeOwn/agent-toolkit` approval/schema/boundary patterns at `68ab51922d0ebb6048bec328d26d755a1d88f56a` informed the design; no unpublished dependency or production adapter is imported. The source settled scheduler/CAS interfaces, so no speculative binary reverse engineering was needed. The future renderer must consume the actual approved kit rather than derive a replacement visual design from reference projects.
