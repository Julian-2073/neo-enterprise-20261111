export const PATROL_QUESTION='主动巡检当前经营快照：先理解业务结构与口径，由转化、供需、市场分别审查本专业，查找值得关注的异常、其他解释和数据缺口；行动编排层整理优先核查议题、方案取舍及待验证条件。当前外部信息和历史经营分开。';
export const patrolDay=(now=new Date())=>new Date(now.getTime()+8*3600000).toISOString().slice(0,10);
export const patrolRequestId=(snapshotId:string,day=patrolDay())=>`patrol:${snapshotId}:${day}:v2`;
