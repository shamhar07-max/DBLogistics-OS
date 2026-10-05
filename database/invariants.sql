-- Business-invariant checks. Every row returned MUST have violations = 0.
-- Run after migrations, in CI, and after every backup restore (specifications/recovery).
SELECT 'journal_unbalanced' AS invariant, count(*)::int AS violations FROM (SELECT journal_id FROM finance.journal_lines GROUP BY journal_id HAVING sum(debit) <> sum(credit)) x
UNION ALL SELECT 'journal_without_lines', count(*)::int FROM finance.journals j WHERE NOT EXISTS (SELECT 1 FROM finance.journal_lines l WHERE l.journal_id = j.id)
UNION ALL SELECT 'stock_negative_or_overreserved', count(*)::int FROM warehouse.stock_lots WHERE qty_on_hand < 0 OR qty_reserved < 0 OR qty_reserved > qty_on_hand
UNION ALL SELECT 'custody_ledger_mismatch_on_hand', count(*)::int FROM warehouse.stock_lots l WHERE l.qty_on_hand <>
  COALESCE((SELECT sum(CASE kind WHEN 'receipt' THEN qty WHEN 'adjustment' THEN qty WHEN 'release' THEN -qty ELSE 0 END) FROM warehouse.custody_movements m WHERE m.lot_id = l.id), 0)
UNION ALL SELECT 'custody_ledger_mismatch_reserved', count(*)::int FROM warehouse.stock_lots l WHERE l.qty_reserved <>
  COALESCE((SELECT sum(CASE kind WHEN 'reserve' THEN qty WHEN 'unreserve' THEN -qty WHEN 'release' THEN -qty ELSE 0 END) FROM warehouse.custody_movements m WHERE m.lot_id = l.id), 0)
UNION ALL SELECT 'payment_allocation_mismatch', count(*)::int FROM finance.payments p WHERE p.amount_allocated <> COALESCE((SELECT sum(amount) FROM finance.payment_allocations a WHERE a.payment_id = p.id), 0)
UNION ALL SELECT 'invoice_allocation_mismatch', count(*)::int FROM finance.invoices i WHERE i.amount_allocated <> COALESCE((SELECT sum(amount) FROM finance.payment_allocations a WHERE a.invoice_id = i.id), 0)
UNION ALL SELECT 'posted_invoice_without_journal', count(*)::int FROM finance.invoices WHERE status IN ('posted','credited') AND (posted_journal_id IS NULL OR ref IS NULL)
UNION ALL SELECT 'invoice_total_mismatch_lines', count(*)::int FROM finance.invoices i WHERE i.status <> 'draft' AND i.total <> COALESCE((SELECT sum(net_amount + tax_amount) FROM finance.invoice_lines l WHERE l.invoice_id = i.id), 0)
UNION ALL SELECT 'accepted_quote_without_single_job', count(*)::int FROM commercial.quotes q WHERE q.status = 'accepted' AND (SELECT count(*) FROM logistics.jobs j WHERE j.quote_id = q.id) <> 1
UNION ALL SELECT 'released_stock_without_authoriser', count(*)::int FROM warehouse.release_orders WHERE status = 'released' AND (authorized_by IS NULL OR authorized_by = requested_by)
UNION ALL SELECT 'bonded_release_without_evidence', count(*)::int FROM warehouse.release_orders o JOIN warehouse.stock_lots l ON l.id = o.lot_id
  WHERE o.status = 'released' AND l.customs_status = 'bonded' AND NOT EXISTS (SELECT 1 FROM trade.release_evidence e WHERE e.case_id = o.customs_case_id)
UNION ALL SELECT 'customs_released_without_evidence', count(*)::int FROM trade.customs_cases c WHERE c.internal_status = 'release_recorded' AND NOT EXISTS (SELECT 1 FROM trade.release_evidence e WHERE e.case_id = c.id)
UNION ALL SELECT 'inferred_event_marked_actual', count(*)::int FROM logistics.tracking_events WHERE source = 'inferred' AND is_actual
UNION ALL SELECT 'closed_job_with_open_shipments', count(*)::int FROM logistics.jobs j WHERE j.status = 'closed' AND EXISTS (SELECT 1 FROM logistics.shipments s WHERE s.job_id = j.id AND s.status NOT IN ('delivered','cancelled'));
