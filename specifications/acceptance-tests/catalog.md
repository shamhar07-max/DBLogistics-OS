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
| Driver without valid driving qualification → dispatch refused | `breadth` › *qualification dispatch rule*; `screens.spec` › *transport…* | ✅ / browser |
| Quality incident → hold → release by a different, authorised person | `breadth` › *incident → hold → separately authorised release*; `screens.spec` › *quality…* | ✅ / browser |
| Conversation log is append-only; tasks complete once | `breadth` › *tasks and append-only messages* | ✅ |
| Signed download only for scanned-clean documents, audited | `breadth` › *documents and downloads* | ✅ |
| Members/roles/audit visible only to authorised roles | `breadth` › *audit visibility*, *admin members and roles*; `screens.spec` › *admin…* | ✅ / browser |
| Receivables ageing buckets and job profitability (estimated vs posted) | `breadth` › *ageing and profitability*; `screens.spec` › *intelligence…* | ✅ / browser |
| Party 360 and bank-change maker-checker; integrations never expose secrets | `breadth` › *party 360…*; `screens.spec` › *customers…* | ✅ / browser |
| New people/quality tables are tenant-isolated; facilities list is tenant-scoped | `breadth` › *new tenant-scoped tables…*, *facilities list…* | ✅ |
| Every navigation item opens a real screen (no placeholders) | `screens.spec` › *every navigation item…* | browser |
| Receive cargo through the form; job tasks and messages persist | `screens.spec` › *warehouse: receive…*, *job workspace…* | browser |
| Customer sees only own shipments/documents/invoices; drafts and internal documents hidden | `portal` › *customer portal scoping*; `portal.spec` › *isolation* | ✅ / browser |
| Portal uploads attach only to own records; issuer is forced (never authority/internal) | `portal` › *portal uploads…* | ✅ |
| Agent limited to shipments they operate; reports recorded as supplier-sourced | `portal` › *agent portal scoping*; `portal.spec` › *agent* | ✅ / browser |
| Transporter limited to own dispatched trips; POD only on open trips; trip completes with last stop | `portal` › *transporter portal scoping*; `portal.spec` › *transporter* | ✅ / browser |
| Customers never see draft quotes or internal columns; acceptance evidence is server-set; portal enquiry for self | `portal` › *quotes and enquiries* | ✅ |
| Workflow definitions validated; versions immutable; one active version | `workflow` › *definitions*; `screens.spec` › *automation designer* | ✅ / browser |
| Workflow conditions, templates, failure rollback, retry, poller isolation, crash recovery | `worker` › *workflow engine* | ✅ |
| Failed runs retried/cancelled through API and UI | `workflow` › *runs…*; `screens.spec` › *failed runs…* | ✅ / browser |
| Facilities and locations managed in admin and usable when receiving | `workflow` › *facilities and locations*; `screens.spec` › *admin: create a facility…* | ✅ / browser |
| Dev disk storage: signed, expiring, method-bound URLs | `devfiles` | ✅ |
| Document preview only after scan (staff and portal) | `screens.spec` › *documents…*; `portal.spec` › *documents…* | browser |
| Phone layout: drawer navigation, no horizontal scrolling (staff and portal) | `screens.spec` / `portal.spec` › *phone layout* | browser |
