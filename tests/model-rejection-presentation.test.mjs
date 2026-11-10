import test from 'node:test';
import assert from 'node:assert/strict';
import {investigationError} from '../lib/business-presentation.ts';
test('HTTP 402 alone does not assert the user account is out of quota',()=>{
 const text=investigationError('模型请求被拒绝（HTTP 402）；供应商原因：route_unavailable');
 assert.doesNotMatch(text,/额度不足|余额不足/);
 assert.match(text,/拒绝/);
});
test('explicit provider balance rejection identifies the currently configured credential',()=>{
 const text=investigationError('模型请求被拒绝（HTTP 402）；供应商原因：Insufficient Balance');
 assert.match(text,/当前配置|凭证/);
 assert.match(text,/供应商|服务/);
});
