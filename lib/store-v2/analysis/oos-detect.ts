// DEV05: Out-of-stock signal detection — pure function over v2 stock facts.
// A core-role SKU with available_quantity === 0 produces an out_of_stock signal.
// Null/unknown stock never produces a signal (absence is not evidence of zero).

import type {StoreInput, StockRow, StoreSku} from '../import/contract.ts';

export interface OosSignal {
  kind: 'out_of_stock';
  sku_id: string;
  style_id: string;
  style_color_id: string;
  observed_at: string;
  available_quantity: number;
}

export function detectOutOfStock(input: StoreInput): OosSignal[] {
  const skuById = new Map(input.skus.map((s) => [s.source_sku_id, s]));
  const signals: OosSignal[] = [];
  for (const stock of input.stock) {
    const sku = skuById.get(stock.source_sku_id);
    if (!sku) continue;
    if (sku.role !== 'core') continue;
    if (stock.available_quantity !== 0) continue;
    signals.push({
      kind: 'out_of_stock',
      sku_id: sku.source_sku_id,
      style_id: sku.style_id,
      style_color_id: sku.style_color_id,
      observed_at: stock.observed_at,
      available_quantity: 0,
    });
  }
  return signals;
}
