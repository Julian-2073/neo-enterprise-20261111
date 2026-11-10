import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import pluginReact from '@vitejs/plugin-react';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
test('existing operating assessment shows exact supporting references, units, stale limits and checker prose as unchecked',async()=>{
 const loader=await createServer({configFile:false,plugins:[pluginReact()],server:{middlewareMode:true,watch:null,hmr:false},optimizeDeps:{noDiscovery:true},appType:'custom'});
 try{const {AssessmentDetails}=await loader.ssrLoadModule('/components/neo-demo/assessment-details.tsx');const run={status:'completed',createdAt:'2026-10-08',knowledgeFreshness:{status:'stale'},result:{businessAssessment:{scope:{asOf:'2026-09-30',researchAsOf:'2026-10-08',dataNature:'demo',operatingVersion:'v1'},inputHash:'hash',metrics:{netRevenueCents:{value:12300,unit:'人民币分',status:'complete'}},claims:[{id:'claim-one',statement:'资料需要核对',status:'supported',supportingReferences:[{id:'metric:netRevenueCents',exact:'精确冻结数字12300分'}],counterevidence:['校验器待核意见'],gaps:['范围需要另行确认']}],confirmations:[],reviewConditions:[],projections:{finding:{conclusion:'请核对固定資料'}},priorityAction:null,context:{}}}};const html=renderToStaticMarkup(React.createElement(AssessmentDetails,{run}));assert.match(html,/精确冻结数字12300分/);assert.match(html,/123/);assert.match(html,/支持状态：supported/);assert.match(html,/知识依赖已过期或有冲突/);assert.match(html,/反证核查意见 · 未作为独立事实核验/);assert.match(html,/这些说明尚未作为独立企业事实核验/);
 const legacy=renderToStaticMarkup(React.createElement(AssessmentDetails,{run:{createdAt:'2020-01-01',result:{},status:'completed'}}));assert.match(legacy,/历史结果/);assert.match(legacy,/2020-01-01/);assert.match(legacy,/未取得当前统一校验/);
 }finally{await loader.close();}
});

test('historical failed or stale retained results show original timestamp, status and version independently of current headline',async()=>{
 const loader=await createServer({configFile:false,plugins:[pluginReact()],server:{middlewareMode:true,watch:null,hmr:false},optimizeDeps:{noDiscovery:true},appType:'custom'});
 try{const {HistoricalAssessment}=await loader.ssrLoadModule('/components/neo-demo/assessment-details.tsx');for(const [status,freshness] of [['completed','stale'],['failed','current']]){const html=renderToStaticMarkup(React.createElement(HistoricalAssessment,{run:{id:'old',snapshotId:'old-input',status,createdAt:'2020-01-02',knowledgeFreshness:{status:freshness},result:{finding:{conclusion:'保留原判断'}}}}));assert.match(html,/历史保存判断/);assert.match(html,/2020-01-02/);assert.match(html,new RegExp(status));assert.match(html,/old-input/);assert.match(html,/不能作为本页当前判断/);}}
 finally{await loader.close();}
});
