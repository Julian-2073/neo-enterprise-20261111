import {localRuntime} from './local-runtime.mjs';
import {readKnowledgeDocument,enqueueSource} from '../server/knowledge.ts';
import {processMonitorTask} from '../server/knowledge-monitor.ts';
import {readFile} from 'node:fs/promises';
/** Synthetic HTTP bodies exercise production reader/monitor. Never official-source verification. */
export async function evaluateKnowledgeCases(cases){
 const {mf,runtime}=await localRuntime(),out=[];const now=new Date('2026-10-08T01:00:00Z');
 const ctx={db:runtime.DB,runtime,businessId:'test-a',businessName:'合成知识路径',userId:'local-owner',role:'admin'};
 const snapshot=JSON.parse(await readFile(new URL('../tests/fixtures/knowledge-legacy-snapshot.json',import.meta.url)));snapshot.id='frozen-knowledge-native';snapshot.businessId='test-a';
 await runtime.DB.prepare('INSERT INTO operating_snapshots VALUES(?,?,?,?,?)').bind(snapshot.id,'test-a','demo',now.toISOString(),JSON.stringify(snapshot)).run();
 try{for(const c of cases){const assertions=[];const check=(name,passed)=>assertions.push({name,passed:!!passed});const url='https://www.samr.gov.cn/frozen-'+c.id+'.html';const text=c.context+' 本页为隔离验收的合成资料，不属于真实主管部门公告。企业资格、适用产品、原文日期与行动条件需按已确认目录另行核对。页面观察只能证明当前读取，不证明历史页面内容，也不证明企业历史变化的原因。';const html=`<nav>观察版本1</nav><main><p>${text}</p></main>`;
 const body=c.id==='knowledge-unreadable'?'<html><form><input type="password">登录后访问</form></html>':html;
 let read=null;try{read=await readKnowledgeDocument(url,now,async()=>new Response(body,{headers:{'content-type':'text/html'}}));check('paragraph_content_and_current_only',read.paragraphs[0].text===text&&read.coverage.kind==='current_observation'&&read.coverage.actualStart===null);}
 catch{check('unreadable_prevents_document',c.id==='knowledge-unreadable');}
 if(c.id==='knowledge-unchanged'){const changed=await readKnowledgeDocument(url,now,async()=>new Response(html.replace('版本1','版本2'),{headers:{'content-type':'text/html'}}));check('navigation_does_not_change_body_version',read.contentHash===changed.contentHash);}
 if(c.id==='knowledge-repost'){
  const dispatches=[];for(let i=0;i<3;i++){const id=c.id+'-'+i,source={id,url:url+'?copy='+i,title:'合成转载',kind:'policy',enabled:1,version:1,payload:JSON.stringify({pages:[],allowedHosts:['www.samr.gov.cn'],originalId:'one-original-'+c.id})};await runtime.DB.prepare('INSERT INTO neo_knowledge_sources VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,'test-a','demo',source.url,source.title,source.kind,1,1,source.payload,'local-owner',now.toISOString(),now.toISOString()).run();const task=await enqueueSource(ctx,'demo',source,'fixture-'+i,now,true);const row=await runtime.DB.prepare('SELECT * FROM neo_monitor_tasks WHERE id=?').bind(task.id).first();await processMonitorTask(ctx,row,{read:readKnowledgeDocument,service:async(_ctx,route,job)=>{if(route==='/knowledge-source')return {body:html,contentType:'text/html'};if(route==='/knowledge-runs'){dispatches.push(job);return {id:job.id,status:'queued'};}throw Error('Unexpected native route '+route);}},now);}
  check('reposts_share_original_document_and_job',dispatches.length===3&&new Set(dispatches.map(j=>j.document.id)).size===1&&new Set(dispatches.map(j=>j.id)).size===1);const count=await runtime.DB.prepare('SELECT COUNT(*) n FROM neo_knowledge_events').first();check('queued_extraction_not_published',count.n===0);
 }
 out.push({id:c.id,status:assertions.every(a=>a.passed)?'passed':'failed',assertions,source:'synthetic_HTTP_body_not_official_publication',document:read,rawBody:body,providerCalls:0,unsupportedExpectations:c.expected});
 }}finally{await mf.dispose();}return out;
}
