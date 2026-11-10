import type {CustomerJourney} from '../server/customer-journey.ts';
// Shared by the backend homepage projection and the customer detail page.
export function customerJourneyChart(j:CustomerJourney){
 const names=['了解','互动','意向','购买'];
 return (['A1','A2','A3','A4'] as const).map((stage,i)=>{
  const values=j.weekly.map(w=>w.counts[stage]),first=values.slice(0,4);
  const mean=first.length===4&&first.every(x=>x!=null)?first.reduce((n,x)=>n+x!,0)/4:null;
  return {id:stage,name:names[i],color:['#7196e2','#a36af1','#006bff','#0ab5a5'][i],values:values.map(x=>x==null||!mean?null:x/mean*100),actualValues:values};
 });
}
