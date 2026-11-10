import type { Kind } from "./contracts.ts";
import {materialTemplates} from './materials/templates.ts';
export const templates: Record<Kind, {
    name: string;
    required: string[];
    optional: string[];
    notes: string;
}> = {
    events: { name: "经营事件", required: ["source_record_id", "occurred_at", "event_type", "channel", "quantity"], optional: ["product_id", "contact_id", "identity_namespace", "external_contact_id", "linked_order_id", "linked_order_line_id"], notes: "行为次数；支持 A1–A3 与 A5。版本2严格关联主数据和客户；订单关联使用同来源订单ID。" },
    orders: { name: "订单与退款", required: ["source_record_id", "order_id", "order_line_id", "entry_type", "occurred_at", "channel", "product_id", "sku_id", "quantity", "amount_cents"], optional: ["variable_cost_cents", "contact_id", "identity_namespace", "external_contact_id"], notes: "paid/refund；整数分、成本回转。版本2严格检查SKU/商品/渠道及提供的客户身份；版本1保持历史兼容。" },
    inventory: { name: "库存快照", required: ["occurred_at", "warehouse_id", "product_id", "sku_id", "sellable_units"], optional: ["source_record_id", "inventory_cost_cents", "in_transit_units", "safety_units"], notes: "occurred_at 为快照时间；来源记录 ID 可省略，由仓库/SKU/时点生成；数量允许为零；不代表企业完整库存。" },
    expenses: { name: "渠道投放费用", required: ["source_record_id", "occurred_at", "channel", "amount_cents"], optional: ["product_id", "sku_id"], notes: "仅广告投放费用；occurred_at 为费用发生日期。" },
    ...materialTemplates,
};
export const eventStages: Record<string, string> = {
    impression: "A1", content_view: "A1", artwork_view: "A1", engaged: "A2", click: "A2", save: "A2", follow: "A2", like: "A2", share: "A2",
    add_to_cart: "A3", inquiry: "A3", lead: "A3", form_submit: "A3", relationship: "A5", repeat_purchase: "A5", referral: "A5", review: "A5",
};
