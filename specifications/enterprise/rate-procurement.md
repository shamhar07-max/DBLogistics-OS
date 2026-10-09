# Carrier rate procurement

Open **Enquiries & quotes → Rate procurement**. Staff with `rates.view` can compare requests within their legal-entity scope; `rates.manage` is required to prepare, issue, record and award. External workspaces cannot use the workflow even if assigned an internal role. Branch-only grants are refused because this version of RFQs does not carry a branch.

1. Prepare a request with legal entity, lane, mode, cargo/service requirements, one comparison currency, future response deadline and one or more active suppliers/carriers/agents.
2. Issue the draft. Requirements and supplier invitations are frozen. Distribution is manual: issuing does not send an email or claim provider delivery.
3. Record each invited supplier response, including freight, local charges, transit/free days, validity and inclusions/exclusions. All amounts use the request currency. A revised response becomes a new immutable revision.
4. Compare only the latest revision for each supplier. Valid responses appear first, ordered by exact total amount and transit days. Earlier revisions remain visible in history. No automatic FX conversions or taxes/duties are invented.
5. A different authorized user selects a valid latest response and records the award reason. Neither the RFQ author nor the selected response recorder may award their own work. The award creates one approved rate whose conditions retain its RFQ, response, amounts, transit/free days and terms.

| Method | Route | Operation |
|---|---|---|
| GET | `/api/v1/rfqs` | Scoped request list |
| GET | `/api/v1/rfqs/:id` | Detail, latest comparison and immutable response history |
| POST | `/api/v1/rfqs` | Prepare request |
| POST | `/api/v1/rfqs/:id/issue` | Issue for manual distribution |
| POST | `/api/v1/rfqs/:id/offers` | Record immutable supplier revision |
| POST | `/api/v1/rfqs/:id/award` | Independently award and publish rate |

Commands require `Idempotency-Key`. Issue/award support `If-Match` record versions. The RFQ row is locked to serialize competing responses and awards. Business effect, audit, outbox event and replay response commit in one transaction. `RfqIssued` and `RfqAwarded` are event records; no carrier connector is implied.

Migrations 017–018 add composite tenant relationships, forced RLS, immutable offers/invitations, transition and independent-approval checks. SQL guards also reject responses to closed/expired requests. API tests cover decimal accuracy, invitation/date validation, permissions, legal-entity filtering, portal and tenant isolation, concurrent revisions, stale versions, independent award, replay and immutable history.

Remaining work: external supplier distribution/portal, cancellation and amendments, separate procurement approval permission/authority tiers, sourced FX, tax/charge classifications, rate-to-quotation suggestions and award-to-booking execution. An approved rate alone does not complete these workflows.
