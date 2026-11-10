import type {AgentRun,BusinessAssessment} from '../server/agent-contracts.ts';
export function assessmentConfigurationId(version:unknown):string|null|undefined{
 if(typeof version!=='string'||!version.includes(':'))return undefined;
 const id=version.slice(version.lastIndexOf(':')+1);return id==='legacy-unversioned'?null:id||undefined;
}
export function assessmentConfigurationIsCurrent(version:unknown,currentId:string|null){return assessmentConfigurationId(version)===currentId;}
export function currentAssessmentRun(runs:AgentRun[],scope:{businessId:string;dataNature:string;id:string},configurationId:string|null=null):AgentRun|null{
 return runs.filter(r=>{const a=r.result?.businessAssessment;return r.status==='completed'&&(!r.knowledgeFreshness||r.knowledgeFreshness.status==='current')&&a?.context.semanticValidation&&(a.context.semanticValidation as {status?:string}).status==='verified'&&a.scope.businessId===scope.businessId&&a.scope.dataNature===scope.dataNature&&a.scope.inputId===scope.id&&a.context.completeReview===true&&assessmentConfigurationIsCurrent(a.scope.configurationVersion,configurationId)&&(!r.configurationFreshness||r.configurationFreshness.status==='current');}).sort((a,b)=>(b.createdAt??'').localeCompare(a.createdAt??''))[0]??null;
}
export function assessmentClaims(a:BusinessAssessment,evidenceId?:string){return (a.claims??[]).filter(c=>!evidenceId||(c.supportingReferences as Array<{id:string}>??[]).some(r=>r.id===evidenceId)||(c.dependencyIds as string[]??[]).includes(evidenceId));}
export function assessmentMetricRows(a:BusinessAssessment){
 const rows:Array<{key:string;value:number|null;unit:string;status:string}>=[];
 function visit(value:Record<string,unknown>,prefix=''){for(const [key,v] of Object.entries(value)){if(v&&typeof v==='object'&&!Array.isArray(v)){const m=v as Record<string,unknown>;if('value' in m&&(typeof m.value==='number'||m.value===null)&&typeof m.unit==='string')rows.push({key:prefix+key,value:m.value as number|null,unit:m.unit,status:String(m.status??'未标注')});else visit(m,prefix+key+'.');}}}
 visit(a.metrics);return rows;
}

export function assessmentMetricName(key:string){const names:Record<string,string>={netRevenueCents:'净成交',contributionMarginCents:'贡献毛利',variableCostCents:'变动成本',spendCents:'渠道与投放费用',paidOrders:'支付订单',paidUnits:'支付数量',fulfilledUnits:'已履约数量',sellableUnits:'可售库存',A1:'触达行为',A2:'吸引行为',A3:'意向行为',A4:'支付订单',refundCents:'退款金额',refundUnits:'退款数量'};const k=key.split('.').at(-1)!;return names[k]??key;}
