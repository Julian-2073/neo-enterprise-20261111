export const GROWTH_REVIEW_VERSION='growth-review-v1';
export const GROWTH_REVIEW_MODES=['conversion','supply','market'] as const;
export type GrowthReviewMode=typeof GROWTH_REVIEW_MODES[number];
export const GROWTH_REVIEW_MISSIONS:Record<GrowthReviewMode,string>={
 conversion:'审查当前生意的4A客户旅程：只看A1了解、A2互动、A3意向、A4购买，省略A5。比较最近四个完整周与前四周各阶段的变化，指出主要变化发生在哪个阶段、哪些商品或渠道需要核查。客户转化只用已关联身份和成熟观察窗口计算；行为次数与订单笔数分别解释，不混算。给老板一句关键判断和下一步。',
 supply:'供需纠察智能体审查当前供应链与库存：核对各商品规格和仓库的最新可售、在途、到货日期、实际收货、备货目标及销售节奏。指出最值得核查的供给承接问题，区分已确认企业目标与参考阈值；库存是共享的，不把增加库存当成增加需求。',
 market:'市场观察智能体审查与当前生意有关的行业信息：先理解商品、品类与经营范围，再检索并读取相关政策、行业需求、竞品与渠道变化的原文。筛选与本企业商品和渠道有关的信息，说明关联、可能影响与先核查什么，排除无关信息。当前信息与历史经营分开，不把渠道投入的同期变化当成行业判断或因果证明。',
};
