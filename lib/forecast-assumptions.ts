export type Expression={ref:string}|{value:number;unit:Unit}|{op:'add'|'multiply'|'min'|'max';args:Expression[]};
export type Unit='ratio'|'units'|'cents'|'probability';
export type AssumptionNode={id:string;label:string;kind:'fact'|'number'|'probability'|'uniform'|'formula';unit:Unit;value?:number;lower?:number;upper?:number;formula?:Expression;source:{kind:'input'|'judgment'|'reference';ids:string[];url?:string;observedAt:string;reason:string;correlationGroup?:string};effectiveFrom:string;validUntil:string;settleAt?:string;resolutionRule?:string;};
export type AssumptionSet={version:'assumption-set-v1';id:string;businessId:string;dataNature:string;generationId:string;parentId:string|null;nodes:AssumptionNode[];demandMultiplierNode:string|null;createdAt:string;createdBy:string;reason:string};
const day=(d:string)=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const scalar=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1e12;
const dimensionless=(u:Unit)=>u==='ratio'||u==='probability';

export function validateAssumptionNodes(value:unknown,root:unknown,now:string):{nodes:AssumptionNode[];demandMultiplierNode:string|null}{
 if(!Array.isArray(value)||value.length<1||value.length>32)throw Error('假设台账需要1至32项');
 const nodes=value as AssumptionNode[],byId=new Map<string,AssumptionNode>();
 for(const n of nodes){
  if(!n||typeof n.id!=='string'||!/^[A-Za-z0-9_-]{1,60}$/.test(n.id)||byId.has(n.id)||typeof n.label!=='string'||!n.label.trim()||n.label.length>200||!['fact','number','probability','uniform','formula'].includes(n.kind)||!['ratio','units','cents','probability'].includes(n.unit))throw Error('假设标识、类型或单位无效');
  if(!day(n.effectiveFrom)||!day(n.validUntil)||n.effectiveFrom>n.validUntil)throw Error('假设有效期无效');
  const s=n.source;if(!s||!['input','judgment','reference'].includes(s.kind)||!Array.isArray(s.ids)||s.ids.length>20||s.ids.some(x=>typeof x!=='string'||!x||x.length>200)||!s.reason?.trim()||s.reason.length>2000||!/[TZ]/.test(s.observedAt)||!/(Z|[+-]\d{2}:\d{2})$/.test(s.observedAt)||!Number.isFinite(Date.parse(s.observedAt))||Date.parse(s.observedAt)>Date.parse(now))throw Error('假设需要有效来源、得知时间和修订理由');
  if(s.correlationGroup!==undefined&&(typeof s.correlationGroup!=='string'||!s.correlationGroup.trim()||s.correlationGroup.length>100))throw Error('相关性分组无效');
  if(s.url){const url=new URL(s.url);if(!['https:','http:'].includes(url.protocol)||s.url.length>2000)throw Error('来源链接无效');}
  if(n.kind==='fact'&&s.kind!=='input'||n.kind!=='fact'&&s.kind==='input')throw Error('已确认事实必须关联导入资料；专家判断不能冒充事实');
  if(n.kind==='probability'&&(!scalar(n.value)||n.value!<0||n.value!>1||n.unit!=='probability'||!n.settleAt||!/(Z|[+-]\d{2}:\d{2})$/.test(n.settleAt)||!n.resolutionRule?.trim()||n.resolutionRule.length>2000||!Number.isFinite(Date.parse(n.settleAt))||Date.parse(n.settleAt)<=Date.parse(now)))throw Error('事件概率须在0至1之间，并定义未来结算时间与可核对的结算规则');
  if(n.kind==='uniform'&&(!scalar(n.lower)||!scalar(n.upper)||n.lower!>n.upper!||n.unit==='probability'))throw Error('情景分布边界无效');
  if(['fact','number'].includes(n.kind)&&!scalar(n.value))throw Error('假设数值无效');
  if(n.kind==='formula'&&!n.formula)throw Error('公式缺少真实计算依赖');
  byId.set(n.id,n);
 }
 const visiting=new Set<string>(),units=new Map<string,Unit>();
 const expression=(e:Expression,depth=0):Unit=>{
  if(depth>8||!e||typeof e!=='object')throw Error('公式过深或无效');
  if('ref' in e){if(typeof e.ref!=='string'||!byId.has(e.ref))throw Error('公式引用不存在');return nodeUnit(e.ref);}
  if('value' in e){if(!scalar(e.value)||!['ratio','units','cents','probability'].includes(e.unit))throw Error('公式常量无效');return e.unit;}
  if(!['add','multiply','min','max'].includes(e.op)||!Array.isArray(e.args)||e.args.length<2||e.args.length>8)throw Error('公式运算无效');
  const us=e.args.map(x=>expression(x,depth+1));if(e.op==='multiply'){const dimensional=us.filter(u=>!dimensionless(u));if(dimensional.length>1)throw Error('只支持一个有量纲因子与比例相乘');return dimensional[0]??'ratio';}
  if(new Set(us).size!==1)throw Error('公式相加或比较的单位不一致');return us[0];
 };
 const nodeUnit=(id:string):Unit=>{if(units.has(id))return units.get(id)!;if(visiting.has(id))throw Error('假设公式存在循环依赖');visiting.add(id);const n=byId.get(id)!,u=n.kind==='formula'?expression(n.formula!):n.unit;if(u!==n.unit)throw Error('公式结果单位与声明不一致');visiting.delete(id);units.set(id,u);return u;};
 for(const n of nodes)nodeUnit(n.id);
 if(root!=null&&(typeof root!=='string'||!byId.has(root)||nodeUnit(root)!=='ratio'))throw Error('进入销量计算的节点须为比例');
 const clean=nodes.map(n=>({id:n.id,label:n.label,kind:n.kind,unit:n.unit,...(n.value!==undefined?{value:n.value}:{}),...(n.lower!==undefined?{lower:n.lower,upper:n.upper}:{}),...(n.formula?{formula:n.formula}:{}),source:{...n.source,ids:[...n.source.ids]},effectiveFrom:n.effectiveFrom,validUntil:n.validUntil,...(n.settleAt?{settleAt:n.settleAt,resolutionRule:n.resolutionRule}: {})}));
 const result={nodes:clean,demandMultiplierNode:(root??null) as string|null};const multiplier=assumptionMultiplier(result);if(multiplier<0||multiplier>2)throw Error('销量改变比例须在0至2之间');return result;
}

/** Default uncertainty shares a draw; independence must be explicitly declared by different groups. */
export function assumptionMultiplier(set:Pick<AssumptionSet,'nodes'|'demandMultiplierNode'>,sample?:number){
 const nodes=new Map(set.nodes.map(n=>[n.id,n])),values=new Map<string,number>();
 const random=(group:string)=>{let seed=2166136261;for(const c of group+':'+sample)seed=Math.imul(seed^c.charCodeAt(0),16777619);seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
 const expr=(e:Expression):number=>'ref' in e?node(e.ref):'value' in e?e.value:e.op==='add'?e.args.reduce((v,a)=>v+expr(a),0):e.op==='multiply'?e.args.reduce((v,a)=>v*expr(a),1):e.op==='min'?Math.min(...e.args.map(expr)):Math.max(...e.args.map(expr));
 const node=(id:string):number=>{if(values.has(id))return values.get(id)!;const n=nodes.get(id)!;let v=n.value??0;if(n.kind==='formula')v=expr(n.formula!);else if(n.kind==='uniform')v=sample===undefined?(n.lower!+n.upper!)/2:n.lower!+random(n.source.correlationGroup??'shared_uncertainty')*(n.upper!-n.lower!);else if(n.kind==='probability'&&sample!==undefined)v=random(n.source.correlationGroup??'shared_uncertainty')<n.value!?1:0;if(!scalar(v))throw Error('假设计算超出数值预算');values.set(id,v);return v;};
 const value=set.demandMultiplierNode?node(set.demandMultiplierNode):1;if(value<0||value>2)throw Error('抽样条件超出允许的销量改变范围');return value;
}

export function assumptionDependencies(set:Pick<AssumptionSet,'nodes'|'demandMultiplierNode'>){const active=new Set<string>(),walk=(e:Expression)=>{if('ref' in e)visit(e.ref);else if('op' in e)e.args.forEach(walk);},visit=(id:string)=>{if(active.has(id))return;active.add(id);const n=set.nodes.find(n=>n.id===id);if(n?.formula)walk(n.formula);};if(set.demandMultiplierNode)visit(set.demandMultiplierNode);return active;}
