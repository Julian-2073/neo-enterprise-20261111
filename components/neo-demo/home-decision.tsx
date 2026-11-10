"use client";
import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {api,automaticAnalysisAllowed} from '../business/use-workspace';
import {useOperating} from './operating-context';
import {runNeedsRefresh,runBusinessStatus} from './agent-presentation';
import {displayMoney,displayNumber} from '../../lib/operating-demo-data';
import type {HomeDecisionResponse,AgentRun,ForecastResult} from '../../server/agent-contracts';

type HomeState={data:HomeDecisionResponse|null;busy:boolean;error:string;update:()=>Promise<void>};
const Context=createContext<HomeState>({data:null,busy:false,error:'',update:async()=>{}});
export const useHomeDecision=()=>useContext(Context);

export function HomeDecisionProvider({enabled,children}:{enabled:boolean;children:ReactNode}){
 const w=useOperating();const snapshot=w?.snapshot,business=w?.business,nature=w?.nature;const scope=`${business}/${nature}/${snapshot?.id}`;
 const [state,setState]=useState<{scope:string;data:HomeDecisionResponse|null;busy:boolean;error:string}>({scope:'',data:null,busy:false,error:''});
 const updateRef=useRef<()=>Promise<void>>(async()=>{});
 useEffect(()=>{
  let disposed=false;let timer:ReturnType<typeof setTimeout>|undefined;let fetching=false;
  const s=snapshot;if(!enabled||!s||!business||!nature)return;
  const q=new URLSearchParams({businessId:business,dataNature:nature,snapshotId:s.id});
  const endpoint=`/api/v1/home-decision?${q}`;
  const accept=(data:HomeDecisionResponse)=>{if(!disposed)setState({scope,data,busy:runNeedsRefresh(data.run),error:''});};
  const load=async(refresh=false)=>{
   if(disposed||fetching)return;fetching=true;if(timer)clearTimeout(timer);
   setState(v=>({scope,data:v.scope===scope?v.data:null,busy:true,error:''}));
   try{
    let data=await api<HomeDecisionResponse>(endpoint);if(disposed)return;
    if(data.canGenerate&&(refresh||(!s.id.startsWith('generation-')&&!data.run&&await automaticAnalysisAllowed(q)))){
     data=await api<HomeDecisionResponse>(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({snapshotId:s.id,dataNature:s.dataNature,...refresh?{refresh:true,requestId:crypto.randomUUID()}:{}})});
     if(disposed)return;
    }
    if(runNeedsRefresh(data.run)){
     await api<AgentRun>(`/api/v1/agent-runs/${data.run!.id}?${q}`);if(disposed)return;
     data=await api<HomeDecisionResponse>(endpoint);if(disposed)return;
    }
    accept(data);
    if(runNeedsRefresh(data.run))timer=setTimeout(()=>void load(),2500);
   }catch(e){if(!disposed)setState(v=>({...v,scope,busy:false,error:(e as Error).message}));}
   finally{fetching=false;}
  };
  updateRef.current=()=>load(true);
  const changed=()=>void load();window.addEventListener('neo:results',changed);void load();
  return()=>{disposed=true;if(timer)clearTimeout(timer);window.removeEventListener('neo:results',changed);updateRef.current=async()=>{};};
 },[scope,enabled,snapshot,business,nature]);
 const current=state.scope===scope?state:{data:null,busy:enabled&&!!w?.snapshot,error:''};
 return <Context.Provider value={{...current,update:()=>updateRef.current()}}>{children}</Context.Provider>;
}

export function homeStatus(data:HomeDecisionResponse|null,busy:boolean){
 return data?.decision?'已完成经营研判':data?.run?runBusinessStatus(data.run):busy?'正在核查经营情况':'尚未生成经营判断';
}

export function HomeForecastCard({forecast,outlook,notice,href,busy=false}:{forecast:ForecastResult|null;outlook?:{title:string;summary:string};notice?:string|null;href:string;busy?:boolean}){
 const weeks=forecast?.weeks.length??0;
 const days=forecast&&weeks?Math.round((Date.parse(forecast.weeks[weeks-1].end)-Date.parse(forecast.weeks[0].start))/86400000)+1:28;
 return <div className="neo-decision-future"><span className="neo-decision-kicker">如果维持现状 <i>02</i></span>
  <span className="neo-decision-future-label">{forecast?`未来 ${days} 天${forecast.unit==='房晚'?'履约房晚':forecast.snapshotId?.startsWith('generation-')?'商品可承接量':'商品销量'}`:'未来经营预判'}</span>
  {forecast?<strong>{displayNumber(forecast.totals.units)}<small>{forecast.unit??"件"}</small></strong>:<h3>{busy?'正在计算经营基线':'预测资料待补齐'}</h3>}
  {outlook&&<h3 className="neo-home-outlook-title">{outlook.title}</h3>}
  <p>{outlook?.summary||notice||(forecast?(busy?'已保存维持现状的预测基线，经营含义正在分析。':'已保存预测基线，经营研判尚未完成。'):'尚无可用预测，补齐销售历史与供给资料后再判断。')}</p>
  {forecast&&<p className="neo-home-forecast-money">净成交额 {displayMoney(forecast.totals.netRevenueCents/100)} · 贡献毛利 {displayMoney(forecast.totals.contributionMarginCents==null?null:forecast.totals.contributionMarginCents/100)}</p>}
  {forecast&&forecast.totals.unmetUnits>0&&<p className="neo-home-forecast-money">受供给条件约束 {displayNumber(forecast.totals.unmetUnits)} {forecast.unit??"件"} · 期末可售 {displayNumber(forecast.totals.endingUnits)} {forecast.unit??"件"}</p>}
  {forecast&&<HomeForecastBasis forecast={forecast}/>}
  <a href={href} className="neo-decision-secondary">比较未来情景</a>
 </div>;
}

function HomeForecastBasis({forecast}:{forecast:ForecastResult}){
 const b=forecast.backtest;
 const checked=b?.status==='evaluated'&&b.timeAware===true&&b.methodVersion==='asof-backtest-v2'&&b.timezone==='Asia/Shanghai'&&b.coverageBasis==='published_source_declaration'&&!!b.labelKnownAt&&b.skippedFolds?.length===0;
 const coverage=forecast.forecastCoverage?.status==='partial'?'部分商品资料不足，暂未计入销量。':!forecast.forecastCoverage?'商品资料是否齐全，还需核对。':'只估算有销售记录的商品。';
 const confidence=checked?'已做历史对照，实际效果仍需持续观察。':b?.status==='partially_evaluated'?'只检验了部分历史，预测是否可靠还需继续观察。':'预测是否可靠，还没有完成历史检验。';
 return <details className="neo-home-details"><summary>查看预测依据</summary>
  <p><b>依据：</b>截至 {forecast.asOf} 已导入的销量、库存和到货计划。</p>
  <p><b>算法：</b>{forecast.snapshotId?.startsWith('generation-')?'延续保存统计期的支付或已入住节奏，结合仓库、房晚或物料产能约束计算；目标单位与评估状态随结果保存。':'延续近四周的销售节奏，结合库存和到货，估算未来能卖出多少件。'}</p>
  <p><b>提醒：</b>{coverage}{forecast.totals.contributionMarginCents==null?'成本资料不全，暂不能判断毛利。':''}{confidence}</p>
  {forecast.dataNature==='demo'&&<small>当前使用模拟数据，结果仅供参考，不是实际收益。</small>}
 </details>;
}

export function HomeDecisionBasis({onEvidence}:{onEvidence:(id:string)=>void}){
 const {data}=useHomeDecision();const home=data?.decision;if(!home)return null;
 const evidence=[...new Set([...(data.run?.result?.finding?.evidenceIds??[]),...home.judgment.evidenceIds,...home.action.evidenceIds])];
 return <details className="neo-home-details neo-home-basis"><summary>查看经营判断与建议的依据</summary>
  <p>AI 已核查当前经营范围的客户、供给和渠道资料，并结合行业参考知识与保存的预测。行业知识用于解释与核查顺序，企业目标和因果关系仍需用本企业证据确认。</p>
  <div>{evidence.map((id,i)=><button type="button" className="neo-text-button" key={id} onClick={()=>onEvidence(id)}>经营依据 {i+1}</button>)}</div>
  <p>参考知识：{home.knowledgeVersion} · {home.knowledgeRuleIds.join('、')}</p>
  {data.run?.result?.finding?.gaps.map((gap,i)=><p key={i}>{gap}</p>)}
  <small>研判生成于 {data.run?.createdAt?new Date(data.run.createdAt).toLocaleString('zh-CN'): '已保存资料版本'}</small>
 </details>;
}
