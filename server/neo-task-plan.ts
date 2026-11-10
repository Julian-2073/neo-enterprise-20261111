import type {RunBudget} from './agent-contracts.ts';
export const taskTypes=['QUERY','EXPLAIN','DIAGNOSE','FORECAST','SIMULATE','DECIDE','REVIEW'] as const;
export type TaskType=typeof taskTypes[number];
export function savedRecordQuery(question:string){return /已保存|保存的|保存选择|选择记录|方案记录|决策记录/.test(question)&&/查询|读取|列出|解释|含义|口径|为何|为什么|是什么|查一下/.test(question);}
export function recognizeTask(question:string,purpose='analysis',interaction=false):TaskType{
 if(['patrol','home','review','briefing','weekly'].includes(purpose)||purpose==='operating'&&!interaction)return 'REVIEW';
 if(/^(你好|您好|嗨|hello|hi|谢谢|帮助|你能做什么)[!！?？。\s]*$/i.test(question.trim()))return 'QUERY';
 if(savedRecordQuery(question))return /解释|含义|口径|为何|为什么/.test(question)?'EXPLAIN':'QUERY';
 const q=question.replace(/(?:不|无需|不要|先不)[^，。；\n]*?(?:预测|推演|模拟|方案|研判|审查|诊断|分析|建议|解释)/g,'');
 for(const [task,pattern] of [['REVIEW',/全面|整体|综合|复核|审查|研判|周报|简报/],['SIMULATE',/如果|假设|推演|模拟|方案比较|比较(?:[^，。；\n]{0,16})方案/],['FORECAST',/预测|未来.*(?:多少|销量|库存|房晚)/],['DECIDE',/优先|先做|该怎么|怎么办|决策|选择|建议/],['EXPLAIN',/解释|含义|口径|怎么计算|为何|为什么/],['QUERY',/多少|查询|读取|列出|只核对|只比较|查一下|查看|看看|是什么/]] as Array<[TaskType,RegExp]>)if(pattern.test(q))return task;
 // Match the Python planner's explicit factual-check rule after higher-priority intents.
 if(/^(?:请)?(?:帮我)?核对(?:一下)?/.test(q.trim())&&!/分析|诊断|排查|异常|原因|涨跌|上升|下降|增长|变化|增加|减少|问题/.test(q)&&/(?:笔数|件数|数量|金额|余额|总数|库存量|销量|收入|营收|毛利|成本|费用)[。？?！!\s]*$/.test(q))return 'QUERY';
 // Elliptical factual follow-ups may ask by metric name without repeating 多少.
 // Explicit causal/decision/simulation intents above retain their own task.
 if(!/分析|诊断|排查|异常|原因|涨跌|上升|下降|增长|变化|增加|减少|问题/.test(q)&&/(?:笔数|件数|数量|金额|余额|总数|库存量|销量|收入|营收|毛利|成本|费用)(?:呢[？?]?|[？?])\s*$/.test(q))return 'QUERY';
 return 'DIAGNOSE';
}
export function taskBudget(_task:TaskType,requested?:RunBudget,_complexity?:{scenarioCount:number}):RunBudget{
 // Preserve the planner call signature while removing task-class spending caps.
 void _complexity;
 return {...requested,maxTokens:null,maxModelCalls:null,maxToolCalls:null,completionTokens:null,maxMarketSearches:requested?.maxMarketSearches===0?0:null};
}
