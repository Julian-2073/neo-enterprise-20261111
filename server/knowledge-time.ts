export function shanghaiDay(now=new Date()){return new Date(now.getTime()+8*3600000).toISOString().slice(0,10);}
export function researchTime(iso=new Date().toISOString()){return {researchAt:iso,researchAsOf:shanghaiDay(new Date(iso)),researchTimezone:'Asia/Shanghai'};}
export function nextDailyAt(now:Date){const start=new Date(shanghaiDay(now)+'T01:00:00.000Z');return start>now?start:new Date(start.getTime()+86400000);}
export function emergencyDeadline(deadline:unknown,now:Date){
 if(typeof deadline!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(deadline))return false;
 const value=new Date(deadline);return Number.isFinite(value.getTime())&&value>now&&value<nextDailyAt(now);
}
