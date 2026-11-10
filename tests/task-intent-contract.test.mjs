import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {recognizeTask} from '../server/neo-task-plan.ts';

const cases=[
 ['请核对一下库存量。','QUERY'],['帮我核对收入','QUERY'],['核对毛利','QUERY'],
 ['核对当前订单笔数','QUERY'],['请核对支付件数。','QUERY'],['帮我核对本期退款金额','QUERY'],
 ['请帮我核对一下当前库存量','QUERY'],['核对毛利！','QUERY'],['库存量呢？','QUERY'],
 ['核对订单下降原因','DIAGNOSE'],['为什么订单下降','EXPLAIN'],
 ['如果增加预算，核对订单笔数','SIMULATE'],['核对库存金额并建议先做什么','DECIDE'],
 ['全面审查并核对本期毛利','REVIEW'],['预测未来销量','FORECAST'],['核对异常库存量','DIAGNOSE'],
 ['不要分析原因，只查询退款笔数','QUERY'],['不要预测销量，综合审查目前经营问题','REVIEW'],
];

test('entry task classification agrees with the Python planner contract',()=>{
 const jobs=cases.map(([question,expected])=>{
  const taskType=recognizeTask(question);
  assert.equal(taskType,expected,question);
  return {question,taskType,mode:'joint'};
 });
 const code='import json,sys; from neo_agent.task_plan import recognize_task,plan_task; jobs=json.load(sys.stdin); print(json.dumps([{ "recognized":recognize_task({k:v for k,v in j.items() if k!="taskType"}), "plan":plan_task(j)} for j in jobs]))';
 const plans=JSON.parse(execFileSync('agent-service/.venv/bin/python',['-c',code],{input:JSON.stringify(jobs),encoding:'utf8',env:{...process.env,PYTHONPATH:'agent-service'}}));
 for(const [i,{recognized,plan}] of plans.entries()){
  assert.equal(recognized,cases[i][1],cases[i][0]);
  assert.equal(plan.taskType,cases[i][1],cases[i][0]);
  if(plan.taskType==='QUERY'){
   assert.equal(plan.budgetClass,'simple');
   assert.ok(!plan.tools.includes('search_market'));
   assert.ok(!plan.tools.includes('simulate_scenario'));
  }
 }
});
