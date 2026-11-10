import type {ScenarioResult} from './agent-contracts.ts';
import type {Context} from './auth.ts';
import {first} from './store.ts';
import {sameResultScope,type ResultScope} from '../lib/decision-history.ts';
export type ArtifactScope=ResultScope;
export const sameArtifactScope=sameResultScope;
/** Read adapter only: legacy saved decisions and their immutable originals stay intact. */
export async function readDecision<T extends ArtifactScope&{scenarioId?:unknown;parentId?:unknown}>(ctx:Context,value:T,scope:ArtifactScope):Promise<T&{selectedScenario:ScenarioResult|null;resultStatus:string;resultNotice:string|null}>{
 const unavailable=(resultNotice:string)=>({...value,selectedScenario:null,resultStatus:'unavailable',resultNotice});
 if(!sameArtifactScope(value,scope))return unavailable('这份选择与当前查看范围不同，暂不展示方案数字。原始选择与理由已保留。');
 const row=await first<{payload:string;business_id:string;data_nature:string;snapshot_id:string;kind:string}>(ctx.db,'SELECT * FROM neo_artifacts WHERE id=? AND business_id=?',value.scenarioId??value.parentId,ctx.businessId);
 if(!row||row.kind!=='scenario')return unavailable('关联方案暂时无法读取，选择理由仍可查看。请恢复原方案后再核对计算结果。');
 const parent=JSON.parse(row.payload);
 if(row.business_id!==scope.businessId||row.data_nature!==scope.dataNature||row.snapshot_id!==scope.snapshotId||!sameArtifactScope(parent,scope))return unavailable('关联方案的企业、数据范围或资料版本不同，暂不合并展示。选择理由已保留。');
 if(!parent.totals||typeof parent.totals!=='object'||Array.isArray(parent.totals)||typeof parent.totals.units!=='number'||!Number.isFinite(parent.totals.units)||Object.values(parent.totals).some(v=>v!==null&&(typeof v!=='number'||!Number.isFinite(v))))return unavailable('关联方案没有完整计算结果，选择理由已保留，请重新核对方案。');
 return {...value,selectedScenario:parent,resultStatus:'ready',resultNotice:null};
}
