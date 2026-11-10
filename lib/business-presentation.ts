export const channelName=(id:string,masters:Array<{id:string;name:string}>=[])=>masters.find(c=>c.id===id)?.name||({douyin:'抖音',抖音:'抖音',tmall:'天猫',天猫:'天猫',xiaohongshu:'小红书',小红书:'小红书'} as Record<string,string>)[id]||(id?'渠道名称待确认':'渠道待确认');
export const productName=(id:string,masters:Array<{id:string;name:string}>=[])=>{const original=masters.find(p=>p.id===id)?.name;const name=original?.endsWith(` ${id}`)?original.slice(0,-id.length).trim():original;return name&&name!==id&&!name.includes(`（${id}）`)?`${name}（${id}）`:name&&name!==id?name:`商品名称待确认（${id}）`;};
export const natureName=(nature:string)=>nature==='demo'?'演示数据，尚未验证实际经营效果':'经营资料，来源完整性仍需核实';
export function scopeName(s:{productId?:string|null;channel?:string|null;periodStart:string;periodEnd:string},products:Array<{id:string;name:string}>=[],channels:Array<{id:string;name:string}>=[]){return `${s.productId?productName(s.productId,products):'全部已导入商品'} / ${s.channel?channelName(s.channel,channels):'全部已导入渠道'} / ${s.periodStart} 至 ${s.periodEnd}`;}
export function investigationError(raw:string){
 if(!raw)return '';
 if(/snapshotId|baselineId|scenarioId|buildId|businessId|dataNature|requestId/.test(raw))return '经营资料或方案条件不完整，请核对查看范围与输入条件。已经保存的记录仍保留。';
 if(/HTTP 402/.test(raw))return /供应商原因：.*Insufficient Balance/i.test(raw)
  ?'模型供应商提示当前配置凭证对应账户余额不可用。请核对实际使用的模型账户；已保存结果仍保留，服务恢复后可继续调查。'
  :'模型服务拒绝了本次请求，具体原因需核对当前模型配置与供应商响应。已保存结果仍保留，服务恢复后可继续调查。';
 if(/证据|核查|organization|JSON|Schema|schema|业务结构|经营表达/.test(raw))return '本次分析还没有通过资料与引用核对，暂不能给出完整判断。已完成的专业结果仍保留，可恢复调查继续核查。';
 if(/超时|连接|HTTP|网络|fetch|failed|Traceback|Error/i.test(raw))return '分析服务暂时未能完成请求。已经保存的结果仍可查看，请稍后恢复调查。';
 return raw;
}
// Only flag technical language. A valid amount in 万元 is not evidence of an error.
export const legacyFinding=(text:string)=>businessText(text)!==text;
export const technicalQuestion=(text:string)=>/proposedAssumptions|user_assumption|confirmed\s*[=:]|"(?:adjustments|priceMultiplier|budgetMultiplier)"/.test(text);
const decimal=(n:number)=>Number(n.toPrecision(12)).toLocaleString('zh-CN',{maximumFractionDigits:12});
export function multiplierText(kind:'price'|'budget'|'demand',n:number){
 const base={price:'价格',budget:'投放',demand:'订单需求假设'}[kind];
 if(n===1)return `${base}不变`;
 if(!Number.isFinite(n)||n<0)return `${base}条件需核对`;
 const amount=`${decimal(Math.abs(n-1)*100)}%`;
 return kind==='price'?`${n<1?'降价':'提价'}${amount}`:`${base}${n<1?'减少':'增加'}${amount}`;
}
export function responseText(kind:'price'|'budget',n:number|null|undefined){
 const label=kind==='price'?'价格变化对需求的响应':'投放变化对需求的响应';
 if(n==null||!Number.isFinite(n))return `${label}尚未提供，不能据此判断销量变化`;
 const change=kind==='price'?'价格提高':'投放增加';
 return `销量响应假设：${change}1%时，订单需求约${n<0?'减少':'增加'}${decimal(Math.abs(n))}%；尚未验证`;
}
// Display-only glossary for saved model text. Values, source text and citations stay immutable.
// Multipliers are interpreted only when explicitly labelled; ordinary amounts are not transformed.
export function businessText(text:string,products:Array<{id:string;name:string}>=[],channels:Array<{id:string;name:string}>=[]):string{
 let v=text.replace(/(?:价格倍数|价格\s*[×x])\s*([0-9]+(?:\.[0-9]+)?)/g,(_,n)=>multiplierText('price',Number(n)))
  .replace(/(?:预算倍数|预算\s*[×x])\s*([0-9]+(?:\.[0-9]+)?)/g,(_,n)=>multiplierText('budget',Number(n)))
  .replace(/需求改善\s*[×x]\s*([0-9]+(?:\.[0-9]+)?)/g,(_,n)=>multiplierText('demand',Number(n)))
  .replace(/(?:价格弹性|(?<!价格)弹性)\s*([+-]?[0-9]+(?:\.[0-9]+)?)/g,(_,n)=>responseText('price',Number(n)))
  .replace(/(?:dataNature\s*[=:]\s*|数据性质\s*)(demo|business)\b/g,(_,n)=>n==='demo'?'资料为合成演示数据':'资料为业务导入数据')
  .replace(/provenance\s*[=:]\s*SYNTHETIC_DEMO/g,'来源为合成演示资料')
  .replace(/\bsnapshotId\s*[=:]\s*snap-[a-zA-Z0-9-]+/g,'资料版本见原始记录')
  .replace(/\bsnap-[a-zA-Z0-9-]+(?::[a-zA-Z0-9:%_-]+)*/g,'经营证据编号（见原始引用）')
  .replace(/\broleId\s*[=:]\s*core\b/g,'经营角色为主力品')
  .replace(/\broleId\s*[=:]\s*entry\b/g,'经营角色为入门品')
  .replace(/\broleId\s*[=:]\s*flagship\b/g,'经营角色为旗舰品')
  .replace(/\bchannel\s*[=:为]\s*null\b/g,'渠道未关联（库存由各渠道共享）')
  .replace(/\bconfirmed\s*[=:]\s*true\b/g,'输入条件已确认，不代表效果已验证')
  .replace(/\bconfirmed\s*[=:]\s*false\b/g,'输入条件尚未确认')
  .replace(/\bhistoricalEligible\s*[=:]\s*false\b/g,'不能用于解释该历史时点')
  .replace(/\bminimumWeeks\s*[=:]\s*(\d+)/g,'最低需 $1 周历史')
  .replace(/\bbacktest.status\s*[=:]\s*insufficient_history\b/g,'回测历史不足')
  .replace(/\bintervalMeaning\s*[=:]\s*assumption_sensitivity_not_confidence_interval\b/g,'范围反映假设变化，不是统计置信区间')
  .replace(/(?:投放费用)?\s*\bspendYuan\s*=\s*([0-9][0-9.,]*)(?:元)?/g,'投放费用 $1 元');
 for(const c of channels){const escaped=c.id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');v=v.replace(new RegExp(`(?<![A-Za-z0-9-])${escaped}(?![A-Za-z0-9-])`,'g'),c.name||channelName(c.id,channels));}
 const words:Record<string,string>={SYNTHETIC_DEMO:'合成演示资料',REFERENCE_ONLY:'仅供参考的资料',ObjectSet:'固定范围对象集合',Ontology:'业务对象模型',SKU:'商品规格',demo:'合成演示数据',douyin:'抖音',tmall:'天猫',content:'名称待确认的渠道',paidOrders:'支付订单数',netRevenueCents:'净成交额（分）',spendCents:'投放费用（分）',spendYuan:'投放费用（元）',behaviorCounts:'行为次数',unmetUnits:'未承接需求（件）',unmet:'未承接需求',units:'销量（件）',limitations:'已记录限制',user_assumption:'老板提供的假设',historical_estimate:'历史估计',external_reference:'外部参考',synthetic:'合成参数',read_specialists:'读取专业判断的工具',null:'未提供'};
 v=v.replace(/\b(?:SYNTHETIC_DEMO|REFERENCE_ONLY|ObjectSet|Ontology|SKU|demo|douyin|tmall|content|paidOrders|netRevenueCents|spendCents|spendYuan|behaviorCounts|unmetUnits|unmet|units|limitations|user_assumption|historical_estimate|external_reference|synthetic|read_specialists|null)\b/g,word=>words[word]);
 v=v.replaceAll('名称待确认的渠道渠道','名称待确认的渠道').replaceAll('合成演示数据数据','合成演示数据').replaceAll('合成演示数据合成数据','合成演示数据').replaceAll('仓库和商品/商品规格','仓库和商品规格').replaceAll('仓库/商品规格','仓库与商品规格').replaceAll('安全线','已设定备货目标').replaceAll('安全水位','已设定备货目标').replaceAll('方向背离','走势不同').replaceAll('背离','走势不同').replaceAll('口径','统计规则');
 for(const p of products){const escaped=p.id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');v=v.replace(new RegExp(`(?<![A-Za-z0-9-（(])${escaped}(?![A-Za-z0-9-]|[（(])`,'g'),productName(p.id,products));}
 return v;
}
export const findingPreview=businessText;
export function inventoryStatus(rows:Array<{sellable_units?:number|null;safety_units?:number|null}>){
 const empty=rows.filter(r=>r.sellable_units===0).length;
 const low=rows.filter(r=>r.sellable_units!=null&&r.sellable_units>0&&r.safety_units!=null&&r.sellable_units<r.safety_units).length;
 const missing=rows.some(r=>r.safety_units==null);
 const pieces=[empty?`有${empty}处商品规格无可售库存`:null,low?`有${low}处商品规格库存偏低，需核对备货目标`:null].filter(Boolean);
 return pieces.length?pieces.join('；'):missing?'已保存库存，备货目标待补':'当前可售不低于已设定目标，目标仍需核对';
}
export function evidenceLimitations(id:string,notes:string[]){
 if(!id.includes(':view:'))return notes.map(n=>businessText(n));
 const view=id.split(':view:')[1].split(':')[0];
 return notes.filter(n=>view==='inventory'?/库存|在途|到货|备货|覆盖日期|来源/.test(n):view==='channel-role'?!/库存/.test(n):!(/库存/.test(n))).map(n=>businessText(n));
}
// Display only: never change numbers, units, assumptions or persisted source text.
export function emphasisParts(text:string){return text.split(/(\*\*[^*\n]+\*\*)/g).map(part=>({text:part.startsWith('**')&&part.endsWith('**')?part.slice(2,-2):part,strong:part.startsWith('**')&&part.endsWith('**')}));}
