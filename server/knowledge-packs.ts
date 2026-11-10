// Configurable reference guidance; never enterprise facts or confirmed rules.
const common={version:'industry-pack-v1',kind:'REFERENCE_GUIDANCE',state:'candidate',framework:'4A:了解、互动、意向、购买；人货场分别核对客户、供给、渠道',limits:['阶段人数不等于有序转化率','相关不等于因果','使用前核对本企业定义、单位与数据覆盖']};
export const INDUSTRY_PACKS={
 ecommerce:{...common,id:'pack:ecommerce',terms:['支付订单笔数','支付商品件数','退款','净成交','可售库存'],methods:['按同口径人群核对4A旅程','订单、件数、客户分别计算','核对渠道毛利、退款与履约'],risks:['跨期退款','库存与到货计划混淆','流量未关联身份'],sources:['市场监管总局','商务部','平台已授权规则'],actions:['先核对经营约束再比较可逆动作']},
 hotel:{...common,id:'pack:hotel',terms:['房晚','可售房晚','入住率','ADR','RevPAR'],methods:['入住日期与预订日期分开','人：住客旅程；货：可售房晚；场：预订渠道','按同房型同期间核对4A'],risks:['取消与退款滞后','房晚不可累积库存','旺淡季混为因果'],sources:['文化和旅游部','属地已确认政策','授权渠道账单'],actions:['先核对服务能力、取消条件与可售房晚']},
 manufacturing:{...common,id:'pack:manufacturing',terms:['库存','成品','物料','在制品','交期','可承诺数量'],methods:['仅库存型离散制造，不推断连续流程产能','人：采购客户4A；货：成品/物料；场：订单渠道','区分订单承诺、计划到货和已验收入库'],risks:['物料齐套缺口','安全/合规期限','计划产出当实际库存'],sources:['工业和信息化部','国家标准公开系统','已授权合同/质检记录'],actions:['先核对物料和履约期限，采购/排产须用户确认']},
} as const;
