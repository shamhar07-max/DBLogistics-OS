# Acceptance catalog → automated tests

Run: `npm test` (needs PostgreSQL 16 + Redis; see README). "Real DB" = executed against PostgreSQL with RLS, not mocks.

| Blueprint §25 scenario | Test (file › name) | Real DB |
|---|---|:-:|
| Cross-tenant record request → denied without exposure | `risks` › *denies a cross-tenant record request…*, *is enforced by PostgreSQL itself (RLS)…*, *every tenant_id table has FORCE ROW LEVEL SECURITY* | ✅ |
| Repeated invoice-post → one posting | `risks` › *repeated invoice-post command → one posting…* (concurrent, same key; reused key; new key) | ✅ |
| Concurrent warehouse release → cannot release twice | `risks` › *concurrent authorisation can release the stock only once*, *two requests for the same last units* | ✅ |
| Repeated provider webhook → one effect | `risks` › *webhook: bad signature refused; duplicate…*; worker › *inbox events become tracking events once* | ✅ |
| Late tracking event → history preserved | `risks` › *late / duplicate / inferred tracking events…*; `domain` › *current milestone ignores arrival order* | ✅ |
| Closed accounting period → posting rejected | `risks` › *rejects posting into a closed accounting period* | ✅ |
| Unauthorised bank change → blocked | `risks` › *bank detail changes need a different approver with call-back verification* | ✅ |
| Quarantined cargo dispatch → blocked | `risks` › *…quarantine blocks dispatch* | ✅ |
| AI tool with insufficient permissions → denied | `risks` › *AI tools obey the calling user's permissions…* | ✅ |
| Offline task submitted twice → one command | `risks` › *offline command submitted twice…*; `offline-sync` › *duplicate delivery…* | ✅ |
| Booking timeout → reconcile before duplicate submission | `risks` › *booking timeout: re-submission is blocked…* | ✅ |
| Backup restore → financial & custody invariants reconcile | `risks` › *a restored backup satisfies every business invariant* (pg_dump → pg_restore → `database/invariants.sql`) | ✅ |
| Enquiry → … → job closure journey | `journey` › *runs end to end…* | ✅ |
| Duplicate supplier bill / late bill | `risks` › *duplicate supplier bill is rejected…* | ✅ |
| Unbalanced / mutated journals, audit tampering | `risks` › *database refuses unbalanced journals…* | ✅ |
| Payment over-allocation (concurrent) | `risks` › *payment cannot be allocated beyond…* | ✅ |
| Bonded release without authority evidence | `risks` › *bonded cargo cannot leave without…* | ✅ |
| External users: no margins, own records only | `risks` › *external customers see only…* | ✅ |
| Worker: outbox once, workflows once, durable timers, tenant-bound role | `worker` › 5 tests (with real Redis) | ✅ |
| Gateway: HttpOnly sealed session, CSRF, allow-list | `gateway` unit + `staff.spec` › *browser JS never sees the access token…* | — / browser |
| UI states: loading/empty/error/forbidden/stale; estimated vs actual badge | `ui` unit; `staff.spec` | — / browser |
| Architecture boundaries | `tools/check-boundaries.test.ts` | — |
