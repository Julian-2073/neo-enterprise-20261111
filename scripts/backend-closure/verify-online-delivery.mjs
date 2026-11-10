import {writeFile,readFile} from 'node:fs/promises';
const fixtures=JSON.parse(await readFile('outputs/backend-closure/local-delivery/simulation.json'));
const root=process.env.NEO_VERIFICATION_URL??'http://127.0.0.1:3112',results=[];
// Synthetic delivery tenants only; each job is bounded to eight model calls.

async function call(path,business,body){const url=root+'/api/v1/'+path+(path.includes('?')?'&':'?')+'businessId='+business+'&dataNature=demo',r=await fetch(url,{method:body?'POST':'GET',headers:{origin:root,'content-type':'application/json'},body:body?JSON.stringify({dataNature:"demo",...body}):undefined}),v=await r.json();if(!r.ok)throw Error(JSON.stringify(v));return v;}
for(const industry of ['ecommerce','hotel','manufacturing']){
 const business='neo-sim-'+industry+'-delivery-1',v=await call('business-workbench?generationId='+fixtures.companies.find(c=>c.businessId===business).generationId,business),run=await call('business-reviews',business,{generationId:v.generation.id});console.log(JSON.stringify({industry,runId:run.id,status:run.status}));
 let status=run;for(let n=0;n<120&&!['completed','failed','cancelled'].includes(status.status);n++){await new Promise(r=>setTimeout(r,5000));status=await call('agent-runs/'+run.id,business);}
 const saved=await call('business-workbench?generationId='+v.generation.id,business),item={industry,business,generationId:v.generation.id,status:status.status,reviews:saved.reviews,synthetic:true,externalMarketRetrieved:false};results.push(item);await writeFile('outputs/backend-closure/verification/online-three-v1.7.json',JSON.stringify(results,null,2));console.log(JSON.stringify({industry,status:status.status,joint:saved.reviews.result?.operatingReviews?.joint}));
}

if(results.some(r=>r.status!=='completed'))process.exitCode=1;
