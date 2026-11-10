import assert from 'node:assert/strict';
import {test} from 'node:test';
import {backtestNote} from '../components/neo-demo/forecast-presentation.ts';
const backtest={status:'evaluated',timeAware:true,methodVersion:'asof-backtest-v2',timezone:'Asia/Shanghai',coverageBasis:'published_source_declaration',labelKnownAt:'2026-09-24T23:59:59+08:00',skippedFolds:[]};
test('only explicit complete time-aware metadata describes new method with limits',()=>{assert.match(backtestNote({backtest}),/截止前已录入.*标签.*相同窗口.*尚不是独立证明.*误差.*不代表真实预测效果/);});
test('old or missing metadata keeps historical availability pending',()=>{for(const k of ['timeAware','methodVersion','timezone','coverageBasis','labelKnownAt','skippedFolds']){const b={...backtest};delete b[k];assert.match(backtestNote({backtest:b}),/尚未核验/);}assert.match(backtestNote({backtest:{status:'evaluated'}}),/尚未核验/);});
test('partial and gap cases explain skipped windows without zero imputation',()=>{assert.match(backtestNote({backtest:{status:'partially_evaluated'}}),/部分历史窗口.*跳过.*不能认定/);for(const status of ['historical_availability_unverified','insufficient_coverage'])assert.match(backtestNote({backtest:{status}}),/跳过.*不能.*零销量/);});
