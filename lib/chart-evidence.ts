import type {Snapshot} from '../server/contracts.ts';
import {viewEvidenceId} from './evidence-refs.ts';
export type ChartForecasts=Record<string,{id:string;weeks:Array<{start:string}>}>;
export function chartEvidenceId(s:Snapshot,title:string,series:string,index:number,forecastStart?:number,forecasts?:ChartForecasts){
 if(!Number.isInteger(index)||index<0)return null;
 if(title.includes('供给'))return s.data.weeks[index]?viewEvidenceId(s.id,'supply-pulse',s.data.weeks[index].start):null;
 if(title==='4A 相对走势')return s.data.customerJourney?.weekly[index]?viewEvidenceId(s.id,'customer-pulse',s.data.customerJourney.weekly[index].start):null;
 if(title.includes('历史支付出库')&&forecastStart!=null){
  if(index<forecastStart)return s.data.weeks[index]?viewEvidenceId(s.id,'week',s.data.weeks[index].start,'paidUnits'):null;
  const f=forecasts?.[series],week=f?.weeks[index-forecastStart];return week?viewEvidenceId(s.id,'forecast-week',f.id,week.start):null;
 }
 return null;
}
