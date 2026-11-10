import {useState} from 'react';
import {ReactFlow,Background,Controls,Handle,Position,type NodeProps,type Node} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import raw from '../backend-map.generated.json';
import './backend-overview.css';
type Source={file:string;line:number|null;found:boolean;excerpt:string};
type Capability={id:string;title:string;work:string;storage:string;codePresent:boolean;evidence:Source[];endpoints:{endpoint:string;codePresent:boolean}[]};
const report=raw as unknown as {sourceFingerprint:string;scannedAt:string;scan:{files:number;limits:string};capabilities:Capability[];totals:{codeGroups:number;capabilities:number};current:{routes:unknown[];pythonRoutes:unknown[];tables:string[]}};
type FlowNode=Node<{label:string;state:string},'business'>;
function BusinessNode({data}:NodeProps<FlowNode>){return <div style={{background:'white',border:'1px solid #bbd5f9',borderRadius:12,padding:16,width:200}}><Handle type="target" position={Position.Left}/><strong>{data.label}</strong><p style={{fontSize:12,color:'#57718d',marginTop:6}}>{data.state}</p><Handle type="source" position={Position.Right}/></div>;}
const nodeTypes={business:BusinessNode};
const links=[['identity','ingestion'],['ingestion','snapshot'],['snapshot','agents'],['snapshot','forecast'],['forecast','decisions'],['ontology','agents'],['knowledge','agents']];
export function BackendOverview(){
 const [selected,setSelected]=useState('agents');const chosen=report.capabilities.find(c=>c.id===selected)!;
 const positions:Record<string,[number,number]>={identity:[0,0],ingestion:[260,0],snapshot:[520,0],agents:[780,0],forecast:[520,160],decisions:[780,160],ontology:[260,320],knowledge:[520,320]};
 const nodes:FlowNode[]=report.capabilities.map(c=>({id:c.id,type:'business',position:{x:positions[c.id][0],y:positions[c.id][1]},data:{label:c.title,state:c.codePresent?'已发现当前源码；经营验收另核':'源码待检查'}}));
 return <main className="bom-root"><header className="bom-header"><h1>NEO 后端链路观察</h1><span>开发工具 · 原产品仍为 /demo</span></header><section className="bom-intro"><div><h2>从经营资料到老板决策</h2><p>{report.totals.codeGroups}/{report.totals.capabilities}组发现源码，扫描{report.scan.files}个文件。这个比例不是项目完成率。</p><p>{report.scan.limits}</p></div></section><section className="bom-chain"><div className="bom-canvas" style={{height:480}}><ReactFlow nodes={nodes} edges={links.map(([a,b])=>({id:a+'-'+b,source:a,target:b}))} nodeTypes={nodeTypes} fitView onNodeClick={(_,n)=>setSelected(n.id)}><Background/><Controls/></ReactFlow></div><div className="bom-inspector"><div><h2>{chosen.title}</h2><p>{chosen.work}</p><p>保存内容：{chosen.storage}</p><p>运行与真实经营效果：请查看总控对应版本验收记录。</p></div><div><h3>源码与接口依据</h3>{chosen.endpoints.map(e=><p key={e.endpoint}>{e.endpoint} · {e.codePresent?'发现声明':'待核查'}</p>)}{chosen.evidence.map(e=><p key={e.file}>{e.file}:{e.line??'待核'} · {e.found?'已找到':'待检查'}</p>)}</div></div></section><footer className="bom-footer"><p>模型只读业务知识建议，不把尚未确认的参数当成企业事实。自动巡检和外部检索是否启用，以运行配置为准。</p><p>扫描时间：{report.scannedAt} · 指纹：{report.sourceFingerprint}</p></footer></main>;
}
