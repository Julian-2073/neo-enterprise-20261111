import {boundedRequestBytes} from './request-body.ts';
import {businessAudit} from './business-audit.ts';
import {generationOrder} from './business-head.ts';
import {publicationEpoch,guardPublication,validatePublishedLedger} from './business-publication.ts';
import {registeredInputVisibility} from './business-input-visibility.ts';
import {legacyOperatingCoverage,legacyOperatingInputs} from './business-legacy-adapter.ts';
import {businessArtifactSummary} from './business-artifact-storage.ts';
import {storedGenerationSummary} from './generation-storage.ts';
import Papa from 'papaparse';
import {buildBusinessState,validateBusinessInput,validateProfile,INPUT_KINDS,type BusinessInput,type FrozenInput} from '../lib/business-state.ts';
import {integerSum,type Coverage} from '../lib/business-metrics.ts';
import {context,requireWrite,type Context} from './auth.ts';
import {assert,json,ApiError} from './errors.ts';
import {dateOnly,hash} from './csv.ts';
import {all,first,statement,type Runtime} from './store.ts';
const rawUpload=Symbol('rawUpload');
type InputBody=Record<string,unknown>&{[rawUpload]?:{bytes:Uint8Array;extension:string;filename:string}};
type ProfileRow={id:string;version:number;payload:string;created_at:string};
type InputRow={id:string;source_id:string;record_key:string;revision:number;known_at:string;payload:string;content_hash:string};
export async function businessProfile(ctx:Context,nature:string,knownAt=new Date().toISOString()){
 return first<ProfileRow>(ctx.db,'SELECT * FROM neo_business_profiles WHERE business_id=? AND data_nature=? AND created_at<=? ORDER BY version DESC LIMIT 1',ctx.businessId,nature,knownAt);
}
function dataNature(x:unknown){assert(x==='demo'||x==='business',422,'INVALID_NATURE','须选择资料性质');return x;}
function validated<T>(fn:()=>T):T{try{return fn();}catch(e){if(e instanceof ApiError)throw e;throw new ApiError(422,'BUSINESS_INPUT',(e as Error).message);}}
async function inputBody(request:Request):Promise<InputBody>{
 const bytes=await boundedRequestBytes(request,1048576);
 const copy=new Request(request.url,{method:'POST',headers:request.headers,body:bytes});
 if(request.headers.get('content-type')?.includes('multipart/form-data')){
  const form=await copy.formData(),file=form.get('file');assert(file instanceof File,422,'FILE','需要CSV文件');
  const parsed=Papa.parse<Record<string,string>>(await file.text(),{header:true,skipEmptyLines:true});assert(!parsed.errors.length,422,'CSV','CSV解析失败');
  const numeric=new Set(['quantity','amountCents','variableCostCents','inventoryCostCents','reservedUnits','inspectionUnits','unitsPerProduct','leadDays','costCents']);
  const records=parsed.data.map(row=>Object.fromEntries(Object.entries(row).filter(([,v])=>v!=='').map(([k,v])=>[k,numeric.has(k)?Number(v):v])));
  const metadata=validated(()=>JSON.parse(String(form.get('metadata')??'{}')));const result:InputBody={...metadata,records};Object.defineProperty(result,rawUpload,{value:{bytes:new Uint8Array(await file.arrayBuffer()),extension:'csv',filename:file.name}});return result;
 }
 const result=validated(()=>JSON.parse(new TextDecoder().decode(bytes)));assert(result&&typeof result==='object'&&!Array.isArray(result),422,'BODY','需要JSON对象');Object.defineProperty(result,rawUpload,{value:{bytes,extension:'json',filename:'input.json'}});return result;
}
export async function readBusinessState(ctx:Context,nature:string,options:{asOf?:string;start?:string;end?:string;knownAt?:string}={}){
 const now=new Date().toISOString();
 assert(!options.knownAt||/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(options.knownAt)&&Number.isFinite(Date.parse(options.knownAt))&&Date.parse(options.knownAt)<=Date.parse(now),422,'KNOWN_AT','知识截止须带时区，且不可晚于现在');
 const knownAt=options.knownAt?new Date(options.knownAt).toISOString():now;
 const profile=await businessProfile(ctx,nature,knownAt);assert(profile,409,'PROFILE_REQUIRED','请先发布企业经营档案');
 const p=validateProfile(JSON.parse(profile.payload)),asOf=dateOnly(options.asOf??new Intl.DateTimeFormat('en-CA',{timeZone:p.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())),end=dateOnly(options.end??asOf),start=dateOnly(options.start??new Date(Date.parse(end+'T00:00:00Z')-55*86400000).toISOString().slice(0,10));
 assert(start<=end&&end<=asOf&&Date.parse(end)-Date.parse(start)<=365*86400000,422,'PERIOD','经营统计窗口无效');
 const future=new Date(Date.parse(asOf+'T00:00:00Z')+p.horizonDays*86400000).toISOString().slice(0,10);

 const rows=await all<InputRow>(ctx.db,`SELECT i.* FROM neo_business_inputs i WHERE i.business_id=? AND i.data_nature=? AND i.known_at<=? AND i.business_date<=? AND (i.kind NOT IN ('order','expense','event','hotel_stay') OR i.business_date>=?) AND ${registeredInputVisibility('i')} AND NOT EXISTS(SELECT 1 FROM neo_business_inputs newer WHERE newer.business_id=i.business_id AND newer.data_nature=i.data_nature AND newer.source_id=i.source_id AND newer.record_key=i.record_key AND newer.revision>i.revision AND newer.known_at<=? AND ${registeredInputVisibility('newer')}) ORDER BY i.business_date,i.known_at,i.id`,ctx.businessId,nature,knownAt,future,start,knownAt,knownAt,knownAt);
 const imports=await all<{payload:string}>(ctx.db,'SELECT payload FROM neo_business_imports WHERE business_id=? AND data_nature=? AND created_at<=?',ctx.businessId,nature,knownAt);
 const spans=[...await legacyOperatingCoverage(ctx,nature,knownAt,p),...imports.flatMap(r=>(JSON.parse(r.payload).coverage??[]) as Coverage[])];
 const inputs:FrozenInput[]=[...await legacyOperatingInputs(ctx,nature,knownAt,future,p,undefined,start),...rows.map(r=>({...JSON.parse(r.payload),id:r.id,sourceId:r.source_id,revision:r.revision,knownAt:r.known_at}))];
 const uniqueInputs=[...new Map(inputs.map(r=>[JSON.stringify([r.sourceId,r.kind,r.recordKey]),r])).values()];
 const state=buildBusinessState({businessId:ctx.businessId,dataNature:nature,profileVersion:profile.id,profile:p,asOf,knownAt,start,end},uniqueInputs,spans);
 const {activePlatformSettings}=await import('./platform-settings.ts'),{businessJourney}=await import('../lib/business-journey.ts');
 const configuration=await activePlatformSettings(ctx,nature,knownAt);
 const journey=businessJourney(state,configuration.settings.customerFunnel);
 for(const transition of journey.transitions)state.metrics[transition.from+'To'+transition.to+'Rate']=transition.metric;
 if(journey.purchaseCohort)state.metrics.cohortToPurchaseRate=journey.purchaseCohort.metric;
 state.quality.gaps=Object.entries(state.metrics).filter(([,m])=>m.value==null).map(([key,m])=>`${key}: ${m.reason}`);
 state.quality.status=state.quality.gaps.length?'partial':'ready';
 return state;
}
export async function handleBusinessState(request:Request,runtime:Runtime,segments:string[]){
 const [resource,id]=segments;if(!['business-profile','business-inputs','business-state','business-generations','business-updates','business-scenarios','business-decisions','business-executions','business-outcomes','business-saved-records','business-reviews','business-workbench','business-forecast-evaluations','business-forecast-jobs','business-forecast-quality','business-assumptions','business-operating-plans'].includes(resource))return null;
 const ctx=await context(request,runtime),url=new URL(request.url);
 if(request.method==='GET'){
  const nature=dataNature(url.searchParams.get('dataNature')??'demo');
  if(resource==='business-operating-plans'){const {readOperatingPlans,operatingPlanInputs}=await import('./operating-plans.ts');const g=url.searchParams.get('generationId');assert(g,422,'GENERATION','请选择经营资料');if(id==='inputs'){const job=url.searchParams.get('forecastJobId');assert(job,422,'FORECAST_JOB','请选择保存模型');return json(await operatingPlanInputs(ctx,nature,g,job));}return json(await readOperatingPlans(ctx,nature,g,id));}
  if(resource==='business-forecast-jobs'){const {readForecastJob,listForecastJobs,forecastDailyPoints}=await import('./forecast-enterprise.ts');if(id&&segments[2]==='points'){const entity=url.searchParams.get('entityId'),channel=url.searchParams.get('channelId');assert(entity&&channel,422,'FORECAST_SERIES','请选择商品与渠道');return json(await forecastDailyPoints(ctx,nature,id,entity,channel));}const g=url.searchParams.get('generationId');assert(id||g,422,'GENERATION','请选择预测资料');return json(id?await readForecastJob(ctx,nature,id):await listForecastJobs(ctx,nature,g!));}
  if(resource==='business-forecast-quality'){assert(id,422,'FORECAST_JOB','请选择预测任务');const {forecastQuality}=await import('./forecast-enterprise.ts');return json(await forecastQuality(ctx,nature,id));}
  if(resource==='business-assumptions'){const {readAssumptions,assumptionSet}=await import('./forecast-assumptions.ts');const g=url.searchParams.get('generationId');assert(id||g,422,'GENERATION','请选择假设资料');return json(id?await assumptionSet(ctx,nature,id):await readAssumptions(ctx,nature,g!));}
  if(resource==='business-forecast-evaluations'){const generationId=url.searchParams.get('generationId');assert(generationId,422,'GENERATION','请选择原预测代次');const rows=await all<{payload:string}>(ctx.db,"SELECT payload FROM neo_artifacts WHERE business_id=? AND data_nature=? AND snapshot_id=? AND kind='sales_forecast_evaluation' ORDER BY created_at DESC LIMIT 20",ctx.businessId,nature,generationId);return json({evaluations:rows.map(r=>businessArtifactSummary(r.payload))});}
  if(resource==='business-profile'){const p=await businessProfile(ctx,nature);return json({profile:p?{id:p.id,version:p.version,settings:JSON.parse(p.payload)}:null});}
  if(resource==='business-inputs')return json({version:'3',kinds:INPUT_KINDS,format:'JSON records or CSV with metadata',maxRows:1000,maxBytes:1048576});
  if(resource==='business-workbench'){const {businessWorkbench}=await import('./business-workbench.ts');return json(await businessWorkbench(ctx,nature,url.searchParams.get('generationId')??undefined));}
  if(resource==='business-state')return json({state:await readBusinessState(ctx,nature,{asOf:url.searchParams.get('asOf')??undefined,start:url.searchParams.get('start')??undefined,end:url.searchParams.get('end')??undefined,knownAt:url.searchParams.get('knownAt')??undefined})});
  if(resource==='business-saved-records'){assert(url.searchParams.get('generationId'),422,'GENERATION','需要经营代次');const {frozenSavedRecordRegistry,recordPage}=await import('./agent-saved-records.ts');const registry=await frozenSavedRecordRegistry(ctx,nature,url.searchParams.get('generationId')!);return json({...recordPage(registry.fullRecords,{cursor:Number(url.searchParams.get('cursor')??0),limit:Number(url.searchParams.get('limit')??20),kind:url.searchParams.get('kind')??undefined,id:id??undefined}),registryHash:registry.registryHash});}
  if(resource==='business-reviews'){assert(id,422,'GENERATION','需要经营代次标识');const {operatingReviews}=await import('./business-reviews.ts');return json(await operatingReviews(ctx,nature,id));}
  if(resource==='business-decisions'){if(id){const {getOperatingDecision}=await import('./business-decisions.ts');return json(await getOperatingDecision(ctx,nature,id));}const rows=await all<{payload:string}>(ctx.db,"SELECT payload FROM neo_artifacts WHERE business_id=? AND data_nature=? AND kind='business_decision' ORDER BY created_at DESC LIMIT 30",ctx.businessId,nature);return json({decisions:rows.map(r=>businessArtifactSummary(r.payload))});}
  if(resource==='business-executions'){const rows=await all<{payload:string}>(ctx.db,'SELECT payload FROM neo_decision_executions WHERE business_id=? AND data_nature=? ORDER BY created_at DESC LIMIT 30',ctx.businessId,nature);const {verifiedExecutions}=await import('./business-decisions.ts');return json({executions:await verifiedExecutions(ctx,nature,rows)});}
  if(resource==='business-outcomes'){assert(id,422,'DECISION','需要决策标识');const {operatingOutcome}=await import('./business-decisions.ts');return json(await operatingOutcome(ctx,nature,id));}
  if(resource==='business-scenarios'){const {readScenarioBundles}=await import('./business-scenarios.ts');return json({bundles:await readScenarioBundles(ctx,nature,id)});}
  if(resource==='business-generations'){const rows=await all<{payload:string;status:string;id:string}>(ctx.db,`SELECT * FROM neo_business_generations WHERE business_id=? AND data_nature=? ${id?'AND id=?':''} ORDER BY (id=(SELECT generation_id FROM neo_business_heads WHERE business_id=? AND data_nature=?)) DESC,${generationOrder} LIMIT 20`,ctx.businessId,nature,...(id?[id]:[]),ctx.businessId,nature);return json({generations:rows.map(r=>({...storedGenerationSummary(r.payload),id:r.id,status:r.status}))});}
  return json({updates:await all(ctx.db,'SELECT * FROM neo_business_updates WHERE business_id=? AND data_nature=? ORDER BY created_at DESC LIMIT 30',ctx.businessId,nature)});
 }
 requireWrite(request,ctx);assert(request.method==='POST',405,'METHOD','需要POST');const body=await inputBody(request),nature=dataNature(body.dataNature);let now=new Date().toISOString();
 if(resource==='business-operating-plans'){const {createOperatingPlan,selectOperatingPlan,evaluateOperatingPlan}=await import('./operating-plans.ts');assert(!id||['select','evaluate'].includes(segments[2]),405,'METHOD','只支持创建任务或保存选择');return json(id?segments[2]==='evaluate'?await evaluateOperatingPlan(ctx,nature,id,body):await selectOperatingPlan(ctx,nature,id,body):await createOperatingPlan(ctx,nature,body),201);}
 if(resource==='business-forecast-jobs'){const {createForecastJob,syncForecastJob,cancelForecastJob,evaluateEnterpriseForecast}=await import('./forecast-enterprise.ts');if(segments[2]==='evaluate')return json(await evaluateEnterpriseForecast(ctx,nature,{...body,jobId:id}),201);return json(id?segments[2]==='cancel'?await cancelForecastJob(ctx,nature,id):await syncForecastJob(ctx,nature,id):await createForecastJob(ctx,nature,body),202);}
 if(resource==='business-assumptions'){const {saveAssumptions,settleAssumption}=await import('./forecast-assumptions.ts');return json(id==='settle'?await settleAssumption(ctx,nature,body):await saveAssumptions(ctx,nature,body),201);}
 if(resource==='business-forecast-evaluations'){const {evaluateGenerationForecast}=await import('./business-forecast.ts');return json(await evaluateGenerationForecast(ctx,nature,body),201);}
 if(resource==='business-updates'){const {drainBusinessUpdates,retryBusinessUpdate}=await import('./business-generations.ts');if(id){assert(await retryBusinessUpdate(ctx,nature,id),409,'UPDATE_NOT_FAILED','只能重试本企业失败的更新');}return json({results:await drainBusinessUpdates(ctx,nature)});}
 if(resource==='business-reviews'){assert(typeof body.generationId==='string',422,'GENERATION','需要经营代次标识');const {operatingReviews}=await import('./business-reviews.ts');assert(body.refreshId===undefined||typeof body.refreshId==='string'&&/^[A-Za-z0-9_-]{1,40}$/.test(body.refreshId),422,'REFRESH','更新标识无效');return json(await operatingReviews(ctx,nature,body.generationId,true,body.refreshId as string|undefined,body.question?{question:String(body.question),role:String(body.mode??'joint'),sessionId:typeof body.sessionId==='string'?body.sessionId:undefined,dialogueScope:body.dialogueScope as import('./agent-conversation.ts').DialogueScope|undefined,scenarios:body.scenarios as unknown[]|undefined}:undefined,body.budget),202);}
 if(resource==='business-decisions'){const {saveOperatingDecision}=await import('./business-decisions.ts');return json(await saveOperatingDecision(ctx,nature,body),201);}
 if(resource==='business-outcomes'){const {confirmOperatingExperience}=await import('./business-decisions.ts');return json(await confirmOperatingExperience(ctx,nature,body),201);}
 if(resource==='business-executions'){const {recordOperatingExecution}=await import('./business-decisions.ts');return json(await recordOperatingExecution(ctx,nature,body),201);}
 if(resource==='business-scenarios'){const {createScenarioBundle}=await import('./business-scenarios.ts');return json(await createScenarioBundle(ctx,nature,body),201);}
 if(resource==='business-profile'){
  assert(ctx.role==='admin',403,'ADMIN_REQUIRED','仅管理员发布企业档案');const profile=validated(()=>validateProfile(body.profile));const previous=await businessProfile(ctx,nature);
  assert(body.baseVersion===(previous?.version??null),409,'PROFILE_CONFLICT','企业档案已更新，请重新读取');
  if(previous&&JSON.parse(previous.payload).industry!==profile.industry){const used=await first<{n:number}>(ctx.db,'SELECT COUNT(*) n FROM neo_business_inputs WHERE business_id=? AND data_nature=?',ctx.businessId,nature);assert(!used?.n,409,'INDUSTRY_CONFLICT','已有经营记录的企业不能直接更换经营单位；请创建独立企业或资料性质');}
  const version=(previous?.version??0)+1,ident='business-profile-'+crypto.randomUUID();
  try{await ctx.db.batch([businessAudit(ctx,'business_profile_published',ident,now),statement(ctx.db,'INSERT INTO neo_business_profiles(id,business_id,data_nature,version,payload,created_at) VALUES(?,?,?,?,?,?)',ident,ctx.businessId,nature,version,JSON.stringify(profile),now),statement(ctx.db,"INSERT INTO neo_business_updates(id,business_id,data_nature,cause,resource_id,status,created_at) VALUES(?,?,?,'profile',?,'pending',?)",'update-'+ident,ctx.businessId,nature,ident,now)]);}catch{throw new ApiError(409,'PROFILE_CONFLICT','另一次企业配置发布已胜出');}
  const {drainBusinessUpdates}=await import('./business-generations.ts');const updates=await drainBusinessUpdates(ctx,nature);
  return json({id:ident,version,profile,updateId:'update-'+ident,updates},201);
 }
 assert(resource==='business-inputs',404,'NOT_FOUND','接口不存在');
 if(id==='seal'){const {sealBusinessImport}=await import('./business-import-groups.ts');return json(await sealBusinessImport(ctx,nature,body),201);}
 let group:{id:string;partIndex:number;partCount:number}|undefined;
 if(body.groupId!==undefined){assert(typeof body.groupId==='string'&&/^[A-Za-z0-9_-]{1,40}$/.test(body.groupId)&&Number.isInteger(body.partCount)&&Number(body.partCount)>=1&&Number(body.partCount)<=100&&Number.isInteger(body.partIndex)&&Number(body.partIndex)>=0&&Number(body.partIndex)<Number(body.partCount),422,'IMPORT_GROUP','分片接入最多100片，每片最多1000条');group={id:body.groupId,partIndex:Number(body.partIndex),partCount:Number(body.partCount)};body.requestId='group-'+body.groupId+'-'+body.partIndex;const sealed=await first(ctx.db,'SELECT id FROM neo_business_imports WHERE business_id=? AND data_nature=? AND request_id=?',ctx.businessId,nature,'seal:'+body.groupId);assert(!sealed,409,'IMPORT_SEALED','已封存接入组不能增加或修改分片');}
 assert(typeof body.requestId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(body.requestId),422,'REQUEST_ID','需要稳定请求标识');
 assert(typeof body.sourceId==='string'&&body.sourceId.length>0&&body.sourceId.length<=100,422,'SOURCE','需要来源标识');
 const requestHash=await hash(JSON.stringify(body)),prior=await first<{payload:string;request_hash:string}>(ctx.db,'SELECT * FROM neo_business_imports WHERE business_id=? AND data_nature=? AND request_id=?',ctx.businessId,nature,body.requestId);
 if(prior){assert(prior.request_hash===requestHash,409,'REQUEST_CONFLICT','相同请求标识内容不同');return json({...JSON.parse(prior.payload),reused:true});}
 const profile=await businessProfile(ctx,nature);assert(profile,409,'PROFILE_REQUIRED','请先发布企业档案');const p=validateProfile(JSON.parse(profile.payload));
 const source=p.expectedSources.find(s=>s.sourceId===body.sourceId);assert(source,422,'SOURCE','来源未在企业档案注册');
 assert(Array.isArray(body.records)&&body.records.length>0&&body.records.length<=1000,422,'ROWS','每次接入须为1至1000条');
 const records=validated(()=>(body.records as unknown[]).map((r:unknown)=>validateBusinessInput(r,p.industry))) as BusinessInput[];
 assert(records.every(r=>source.kinds.includes(r.kind)),422,'SOURCE_KIND','记录类型不属于此来源');
 assert(new Set(records.map(r=>r.recordKey)).size===records.length,422,'DUPLICATE','批次记录标识重复');
 const start=validated(()=>dateOnly(String(body.coverageStart))),end=validated(()=>dateOnly(String(body.coverageEnd)));assert(start<=end,422,'COVERAGE','覆盖区间无效');
 const coverageKinds=body.coverageKinds;assert(Array.isArray(coverageKinds)&&coverageKinds.length&&coverageKinds.every(k=>source.kinds.includes(k)),422,'COVERAGE','需声明此批次完整覆盖的数据类型');
 const expectedRowCount=body.expectedRowCount;assert(Number.isInteger(expectedRowCount)&&expectedRowCount===records.length,422,'RECONCILIATION','记录数量与提供方总数不一致');
 const totals={amountCents:integerSum(records.map(r=>(r.amountCents??0)*(r.entryType==='refund'?-1:1))),quantity:integerSum(records.map(r=>(r.quantity??0)*(r.entryType==='refund'?-1:1)))};
 if(body.expectedTotals){assert(typeof body.expectedTotals==='object',422,'RECONCILIATION','对账总量无效');for(const [k,v] of Object.entries(body.expectedTotals))assert(k in totals&&v===totals[k as keyof typeof totals],422,'RECONCILIATION',`${k}与提供方总量不一致`);}
 const epoch=await publicationEpoch(ctx,nature);now=new Date().toISOString();
 const importId='business-import-'+crypto.randomUUID(),commands:D1PreparedStatement[]=[];let duplicates=0;
 const previousRows=await all<InputRow>(ctx.db,`SELECT i.* FROM neo_business_inputs i WHERE i.business_id=? AND i.data_nature=? AND i.source_id=? AND i.record_key IN (SELECT value FROM json_each(?)) AND NOT EXISTS(SELECT 1 FROM neo_business_inputs n WHERE n.business_id=i.business_id AND n.data_nature=i.data_nature AND n.source_id=i.source_id AND n.record_key=i.record_key AND n.revision>i.revision)`,ctx.businessId,nature,body.sourceId,JSON.stringify(records.map(r=>r.recordKey)));
 const pending=await first(ctx.db,`SELECT i.id FROM neo_business_inputs i WHERE i.business_id=? AND i.data_nature=? AND i.source_id=? AND i.record_key IN (SELECT value FROM json_each(?)) AND NOT (${registeredInputVisibility('i')}) LIMIT 1`,ctx.businessId,nature,body.sourceId,JSON.stringify(records.map(r=>r.recordKey)),now);
 assert(!pending,409,'IMPORT_PENDING','相同记录仍在未封存接入组中；请先完成封存，再导入或更正，不能将暂存记录当作正式重复');
 const previousByKey=new Map(previousRows.map(r=>[r.record_key,r]));
 const legacy=await legacyOperatingInputs(ctx,nature,now,records.map(r=>r.businessDate).sort().at(-1)!,p,records.map(r=>r.recordKey));
 for(const old of legacy.filter(r=>r.sourceId===body.sourceId&&!previousByKey.has(r.recordKey))){const clean=Object.fromEntries(Object.entries(old).filter(([key])=>!['id','sourceId','revision','knownAt'].includes(key)).sort(([a],[b])=>a.localeCompare(b)));previousByKey.set(old.recordKey,{id:old.id,source_id:old.sourceId,record_key:old.recordKey,revision:old.revision,known_at:old.knownAt,payload:JSON.stringify(clean),content_hash:await hash(JSON.stringify(clean))});}
 for(const record of records){
  const last=previousByKey.get(record.recordKey);
  assert(!last||JSON.parse(last.payload).kind===record.kind,409,'RECORD_KIND_CONFLICT','同一来源记录键不能改变数据类型');
  const clean=Object.fromEntries(Object.entries(record).filter(([k])=>k!=='supersedesId').sort(([a],[b])=>a.localeCompare(b)));const contentHash=await hash(JSON.stringify(clean));
  if(last?.content_hash===contentHash){duplicates++;continue;}
  assert(!last||record.supersedesId===last.id,409,'REVISION_CONFLICT','更正记录须明确引用当前版本；不覆盖原始事实');
  commands.push(statement(ctx.db,'INSERT INTO neo_business_inputs(id,business_id,data_nature,source_id,import_id,record_key,revision,kind,business_date,known_at,supersedes_id,payload,content_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)','business-input-'+crypto.randomUUID(),ctx.businessId,nature,body.sourceId,importId,record.recordKey,(last?.revision??0)+1,record.kind,record.businessDate,now,last?.id??null,JSON.stringify(clean),contentHash));
 }
 if(!group)await validatePublishedLedger(ctx,nature,p,now,String(body.sourceId),records);
 const upload=body[rawUpload]!,rawKey=`business-inputs/${ctx.businessId}/${nature}/${importId}.${upload.extension}`;
 assert(runtime.RAW_FILES,503,'RAW_STORAGE','原始资料存储不可用');
 await runtime.RAW_FILES.put(rawKey,upload.bytes);
 const report={rawObjectKey:rawKey,rawFilename:upload.filename,rawHash:await hash(new TextDecoder().decode(upload.bytes)),id:importId,requestId:body.requestId,rowCount:records.length,importedCount:commands.length,duplicateCount:duplicates,totals,status:'reconciled',...(group?{group,recordKeys:records.map(r=>r.recordKey),declaredCoverage:coverageKinds.map(kind=>({kind,sourceId:body.sourceId,start,end}))}:{}),coverage:group?[]:coverageKinds.map(kind=>({kind,sourceId:body.sourceId,start,end})),coverageBasis:'provider_declared',createdAt:now};
 commands.push(statement(ctx.db,'INSERT INTO neo_business_imports(id,business_id,data_nature,request_id,request_hash,source_id,payload,created_at) VALUES(?,?,?,?,?,?,?,?)',importId,ctx.businessId,nature,body.requestId,requestHash,body.sourceId,JSON.stringify(report),now),...(group?[]:[statement(ctx.db,"INSERT INTO neo_business_updates(id,business_id,data_nature,cause,resource_id,status,created_at) VALUES(?,?,?,'import',?,'pending',?)",'update-'+importId,ctx.businessId,nature,importId,now)]));
 try{await ctx.db.batch([guardPublication(ctx,nature,epoch),...commands,businessAudit(ctx,group?'business_input_staged':'business_input_published',importId,now)]);}catch{throw new ApiError(409,'INPUT_CONFLICT','记录被并发更新；批次未发布，请重新读取');}
 const {drainBusinessUpdates}=await import('./business-generations.ts');const updates=group?[]:await drainBusinessUpdates(ctx,nature);
 return json({...report,reconciliationId:importId,updateId:'update-'+importId,updates},201);
}
