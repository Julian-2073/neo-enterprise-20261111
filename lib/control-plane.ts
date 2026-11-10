export const modelProviders = {
 openai: {name:'OpenAI',baseUrl:'https://api.openai.com/v1'},
 deepseek: {name:'DeepSeek',baseUrl:'https://api.deepseek.com/v1'},
 dashscope: {name:'阿里云百炼',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1'},
} as const;
export type ProviderId=keyof typeof modelProviders;
export const governanceNodes=[
 {id:'profile',name:'数据剖析',description:'识别空值、重复记录与字段类型',kind:'deterministic'},
 {id:'mapping',name:'映射建议',description:'匹配已发布对象属性与主键',kind:'deterministic'},
 {id:'agent',name:'Agent 辅助',description:'按字段摘要给出语义映射建议',kind:'model'},
 {id:'review',name:'人工确认',description:'核对建议，确认业务含义',kind:'gate'},
 {id:'validation',name:'正式校验',description:'复用现有导入校验，拒绝错误记录',kind:'gate'},
 {id:'commit',name:'确认入库',description:'人工提交后保存不可变事实',kind:'gate'},
] as const;
export type GovernanceWorkflow={name:string;agentEnabled:boolean;instructions:string};
export const defaultWorkflow:GovernanceWorkflow={name:'数据治理与 Ontology 建模',agentEnabled:false,instructions:'优先使用已有业务对象，识别主键、金额单位与关联字段；无法确定的映射留空，由业务人员确认。'};
