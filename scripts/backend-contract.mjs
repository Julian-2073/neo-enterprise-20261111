// Current operating resources; static declarations never imply business acceptance.
export const contractPath='docs/稳定主版本.md';
export const capabilities=[
 {id:'identity',title:'企业与权限',file:'server/api.ts',resource:'businesses',methods:['GET'],source:['server/auth.ts','export async function context'],work:'按用户与企业核对读取和写入权限。',storage:'企业与成员'},
 {id:'ingestion',title:'资料入库',file:'server/api.ts',resource:'ingestion-batches',methods:['GET','POST'],source:['server/ingestion.ts','export'],work:'CSV校验、原件保存、提交事实；生成器只用于隔离验收。',storage:'来源、批次与事实'},
 {id:'snapshot',title:'看板与证据',file:'server/api.ts',resource:'operating-snapshot',methods:['GET'],source:['server/snapshots.ts','export'],work:'原demo读取已保存快照，指标保持相同范围。',storage:'快照与证据'},
 {id:'agents',title:'智能体调查',file:'server/agents.ts',resource:'agent-runs',methods:['GET','POST'],source:['agent-service/neo_agent/agent.py','class AgentRuntime'],work:'真实模型读取固定经营事实与相关业务知识，任务和回复保存。',storage:'运行、会话与轨迹'},
 {id:'forecast',title:'预测与情景',file:'server/agents.ts',resource:'forecasts',methods:['GET','POST'],source:['agent-service/neo_agent/engine.py','def simulate'],work:'确定性工具计算基线与情景，不把假设写成实际效果。',storage:'输入、计算与方案'},
 {id:'decisions',title:'老板选择与周报',file:'server/agents.ts',resource:'decisions',methods:['GET','POST'],source:['lib/decision-history.ts','export'],work:'保存选择与理由，周报回读；不执行投放或采购。',storage:'选择与理由'},
 {id:'ontology',title:'经营对象与关系',file:'server/ontology/api.ts',resource:'object-sets',methods:['POST'],source:['server/ontology/query.ts','export'],work:'在固定企业、模型与资料版本内查询对象和关系。',storage:'定义、投影与来源'},
 {id:'knowledge',title:'业务知识',file:'agent-service/neo_agent/knowledge.py',resource:null,methods:[],source:['agent-service/neo_agent/knowledge.py','def business_knowledge'],work:'读取来源明确的30条业务关系规则与50项实践建议；商户参数仍待确认。',storage:'主仓版本化知识包'},
];
export const pages=['home','people','goods','market','overview','weekly'].map(id=>({id,name:({home:'今日经营',people:'我的客户',goods:'供应链与库存',market:'渠道与竞品',overview:'预测与推演',weekly:'经营决策周报'})[id],route:'/demo'+(id==='home'?'':'?page='+id),file:'app/demo/page.tsx',story:id==='weekly'?'neo-weekly-report--default':'neo-pages--'+id}));
