import {localRuntime} from './local-runtime.mjs';
const{mf}=await localRuntime({persist:true});
console.log('本地 D1 迁移及两个测试企业已初始化；RAW_FILES 使用本地 R2。');
await mf.dispose();
