-- Cross-source inventory conflicts and payment/refund integrity are enforced in D1.
CREATE UNIQUE INDEX uq_inventory_point ON business_facts(business_id, data_nature, json_extract(payload, '$.warehouse_id'), json_extract(payload, '$.sku_id'), occurred_at) WHERE kind = 'inventory';
--> statement-breakpoint
CREATE UNIQUE INDEX uq_paid_line ON business_facts(business_id, source_id, data_nature, json_extract(payload, '$.order_id'), json_extract(payload, '$.order_line_id')) WHERE kind = 'orders' AND json_extract(payload, '$.entry_type') = 'paid';
--> statement-breakpoint
CREATE TRIGGER validate_refund BEFORE INSERT ON business_facts
WHEN NEW.kind = 'orders' AND json_extract(NEW.payload, '$.entry_type') = 'refund'
BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM business_facts p WHERE p.business_id = NEW.business_id AND p.source_id = NEW.source_id AND p.data_nature = NEW.data_nature AND p.kind = 'orders'
   AND json_extract(p.payload, '$.entry_type') = 'paid'
   AND json_extract(p.payload, '$.order_id') = json_extract(NEW.payload, '$.order_id') AND json_extract(p.payload, '$.order_line_id') = json_extract(NEW.payload, '$.order_line_id')
   AND json_extract(p.payload, '$.product_id') = json_extract(NEW.payload, '$.product_id') AND json_extract(p.payload, '$.sku_id') = json_extract(NEW.payload, '$.sku_id') AND json_extract(p.payload, '$.channel') = json_extract(NEW.payload, '$.channel')
   AND p.occurred_at <= NEW.occurred_at
   AND json_extract(NEW.payload, '$.amount_cents') + COALESCE((SELECT SUM(json_extract(r.payload, '$.amount_cents')) FROM business_facts r WHERE r.business_id = NEW.business_id AND r.source_id = NEW.source_id AND r.data_nature = NEW.data_nature AND r.kind = 'orders' AND json_extract(r.payload, '$.entry_type') = 'refund' AND json_extract(r.payload, '$.order_id') = json_extract(NEW.payload, '$.order_id') AND json_extract(r.payload, '$.order_line_id') = json_extract(NEW.payload, '$.order_line_id')), 0) <= json_extract(p.payload, '$.amount_cents')
   AND json_extract(NEW.payload, '$.quantity') + COALESCE((SELECT SUM(json_extract(r.payload, '$.quantity')) FROM business_facts r WHERE r.business_id = NEW.business_id AND r.source_id = NEW.source_id AND r.data_nature = NEW.data_nature AND r.kind = 'orders' AND json_extract(r.payload, '$.entry_type') = 'refund' AND json_extract(r.payload, '$.order_id') = json_extract(NEW.payload, '$.order_id') AND json_extract(r.payload, '$.order_line_id') = json_extract(NEW.payload, '$.order_line_id')), 0) <= json_extract(p.payload, '$.quantity')
   AND (json_extract(NEW.payload, '$.variable_cost_cents') IS NULL OR json_extract(p.payload, '$.variable_cost_cents') IS NULL OR json_extract(NEW.payload, '$.variable_cost_cents') + COALESCE((SELECT SUM(json_extract(r.payload, '$.variable_cost_cents')) FROM business_facts r WHERE r.business_id = NEW.business_id AND r.source_id = NEW.source_id AND r.data_nature = NEW.data_nature AND r.kind = 'orders' AND json_extract(r.payload, '$.entry_type') = 'refund' AND json_extract(r.payload, '$.order_id') = json_extract(NEW.payload, '$.order_id') AND json_extract(r.payload, '$.order_line_id') = json_extract(NEW.payload, '$.order_line_id')), 0) <= json_extract(p.payload, '$.variable_cost_cents'))
 ) THEN RAISE(ABORT, 'REFUND_CONFLICT') END;
END;
