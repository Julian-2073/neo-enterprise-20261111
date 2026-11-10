import type {DialogueScope} from '../server/agent-conversation.ts';
export type DiscussionDictionary={products:Array<{id:string;name?:string}>;skus:Array<{id:string;name?:string;product_id?:string;productId?:string}>;channels:Array<{id:string;name?:string}>;scenarios?:Array<{id:string;title?:string}>;period:{start:string;end:string};canonical?:boolean};
export function localConversation(question:string):string|null{
 const q=question.trim().replace(/[，。！？!?\s]/g,'');
 if(/^(你好|您好|嗨|hello|hi|早上好|晚上好|谢谢|好的|明白了)$/i.test(q))return '你好，可以按当前经营资料核对成交、库存、渠道，也可以解释证据或比较已保存方案。请告诉我想先看什么。';
 if(/^(帮助|你能做什么|怎么使用|怎么问|我该问什么)$/.test(q))return '可以问“这个商品最近四周成交多少”“那库存呢”，或指定当前渠道。提到多个同名对象时，我会先请你确认；补充信息仍需核实。';
 return null;
}
/** Only exact authorized dictionary mentions become filters. Ambiguity never guesses. */
export function groundDiscussion(question:string,d:DiscussionDictionary):{scope:DialogueScope;clarification:string|null}{
 const scope:DialogueScope={};const q=question.toLowerCase();
 const match=<T extends {id:string;name?:string;title?:string}>(rows:T[])=>rows.filter(r=>[r.id,r.name,r.title].filter(Boolean).some(v=>{const text=v!.toLowerCase();return /^[a-z0-9_-]+$/i.test(text)?new RegExp('(^|[^a-z0-9_-])'+text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?=$|[^a-z0-9_-])','i').test(q):q.includes(text);}));
 const mentionedSkus=question.match(/SKU[-_][A-Za-z0-9_-]+/gi)??[];if(mentionedSkus.some(id=>!d.skus.some(s=>s.id.toLowerCase()===id.toLowerCase())))return {scope:{},clarification:'当前资料目录没有这个规格，请从已登记商品或规格中选择；暂不猜测对象。'};
 const skus=match(d.skus),products=match(d.products),channels=match(d.channels),scenarios=match(d.scenarios??[]);
 if(skus.length>1||products.length>1||channels.length>1||scenarios.length>1)return {scope:{},clarification:'这次提到多个商品、规格、渠道或方案，请先指定一个对象；当前讨论范围暂不改变。'};
 if(skus[0]){const product=skus[0].productId??skus[0].product_id;if(d.canonical)scope.entityId=skus[0].id;else{if(product)scope.entityId=product;scope.skuId=skus[0].id;}}
 else if(products[0])scope.entityId=products[0].id;
 if(channels[0])scope.channelId=channels[0].id;
 if(scenarios[0])scope.scenarioIds=[scenarios[0].id];
 const dates=question.match(/\d{4}-\d{2}-\d{2}/g)??[];
 if(dates.length){if(dates.length!==2||dates[0]<d.period.start||dates[1]>d.period.end||dates[0]>dates[1])return {scope:{},clarification:`请指定 ${d.period.start} 至 ${d.period.end} 内的起止日期；当前资料不能支持更大期间。`};scope.period={start:dates[0],end:dates[1]};}
 else if(/最近四周|近四周/.test(question)){const start=new Date(Date.parse(d.period.end+'T00:00:00Z')-27*86400000).toISOString().slice(0,10);if(start<d.period.start)return {scope:{},clarification:'当前资料不足四周，请选择已保存期间。'};scope.period={start,end:d.period.end};}
 if(/全部商品|所有商品/.test(question))return {scope:{},clarification:'当前会话保持已确认范围。请新开讨论或明确选择具体商品，避免把局部数据混入全企业判断。'};
 return {scope,clarification:null};
}
