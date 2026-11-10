import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {handleWorkbenchCompat} from '../server/workbench-compat.ts';
import {recommendScenario} from '../components/neo-demo/forecast-presentation.ts';
test('original demo source preserves baseline except the explicit snapshot-state boundary; independent frontend removed',async()=>{
 for(const file of ['components/neo-demo/prototype.tsx','components/neo-demo/shell.tsx','components/neo-demo/charts.tsx','components/neo-demo/evidence-drawer.tsx','components/neo-demo/today-briefing.tsx','lib/neo-demo-data.json','app/globals.css']){
  let source=await readFile(file,'utf8');
  if(file==='components/neo-demo/shell.tsx'){
   // Invalid pinned snapshots must hide analysis children. Only this exact
   // boundary wiring may differ; operating-scope-ui exercises its behavior.
   const boundary='<main className="neo-main"><OperatingScope>{children}</OperatingScope></main>';
   assert.equal(source.split(boundary).length,2);
   source=source.replace(boundary,'<main className="neo-main">{operating&&<OperatingScope/>}{children}</main>');
  }
  assert.equal(source,execFileSync('git',['show','299793e24b4174c66e15283b89af147cba9bf764:'+file],{encoding:'utf8'}),file);
 }
 await assert.rejects(access('components/business-closure/workbench.tsx'));assert.doesNotMatch(await readFile('components/neo-demo/operating-context.tsx','utf8'),/CanonicalWorkbench|business-closure/);
});
test('compatibility probe does not consume legacy POST bodies',async()=>{
 const request=new Request('http://localhost/api/v1/scenarios?businessId=test-a&dataNature=demo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({snapshotId:'snap-old',baselineId:'original'})});assert.equal(await handleWorkbenchCompat(request,{},['scenarios']),null);assert.deepEqual(await request.json(),{snapshotId:'snap-old',baselineId:'original'});
});
test('canonical recommendation excludes infeasible or unconfirmed higher-margin choices',()=>{
 const base={id:'baseline',snapshotId:'generation-a',businessId:'a',dataNature:'demo',calculationVersion:'v',inputHash:'hash',totals:{contributionMarginCents:100,spendCents:1,variableCostCents:1,unmetUnits:0},feasibility:{status:'feasible'}};
 const scenario={...base,id:'s',parentId:base.id,totals:{...base.totals,contributionMarginCents:200},feasibility:{status:'infeasible'}};assert.equal(recommendScenario(base,[scenario]),null);
 assert.equal(recommendScenario(base,[{...scenario,feasibility:{status:'feasible'}}]).id,'s');
});
