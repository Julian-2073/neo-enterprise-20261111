import {encodeInput} from '../input-storage.ts';

// The gateway retains the full envelope for scope checks and annotations. Only
// the service/queue boundary receives this lossless, bounded representation.
export async function transportEnvelope(env:Record<string,unknown>):Promise<Record<string,unknown>>{
 const planning=env.operatingPlanning as {id:string}|undefined;const metadata=planning?{operatingPlanRef:planning.id}:{};
 const encoded=JSON.parse(await encodeInput(env));
 if(encoded.storageFormat!=='neo-inputs-gzip-v1')return {...env,...metadata};
 return {...metadata,...(env.scenarioRecommendationBasis?{scenarioRecommendationRef:{baselineId:(env.scenarioRecommendationBasis as {baselineId:string}).baselineId}}:{}),ontologyRef:env.ontologyRef,envelopePacked:{codec:'gzip-base64',rawBytes:encoded.rawBytes,payload:encoded.payload}};
}
