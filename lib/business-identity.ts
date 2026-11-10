import type {BusinessProfile,FrozenInput} from './business-state.ts';
export function enterpriseIdentity(profile:BusinessProfile,row:FrozenInput){
 return !!row.identityEvidenceIds?.length||profile.expectedSources.find(s=>s.sourceId===row.sourceId)?.customerIdentity?.scope==='enterprise';
}
export function businessCustomerKey(profile:BusinessProfile,row:FrozenInput){
 if(!row.customerId)return null;
 return JSON.stringify(enterpriseIdentity(profile,row)?['enterprise',row.customerId]:['source',row.sourceId,row.customerId]);
}
export function unresolvedCrossSourceIdentity(profile:BusinessProfile,rows:FrozenInput[]){
 return new Set(rows.map(r=>r.sourceId)).size>1&&rows.some(r=>!enterpriseIdentity(profile,r));
}
