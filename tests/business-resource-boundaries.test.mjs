import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {readIncomingBody} from '../scripts/local-request-body.mjs';
import {boundedObjectBytes} from '../server/object-bytes.ts';

test('local HTTP wrapper rejects declared and chunked byte overflow and remains usable',async()=>{
 const server=createServer(async(req,res)=>{try{res.end(String((await readIncomingBody(req,1024)).length));}catch(e){res.writeHead(e.status??500);res.end('limited');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const send=(headers,chunks)=>new Promise((resolve,reject)=>{const req=request({host:'127.0.0.1',port:server.address().port,method:'POST',headers},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);for(const c of chunks)req.write(c);req.end();});
 try{assert.equal((await send({'content-length':'2048'},[Buffer.alloc(2048)])).status,413);assert.equal((await send({},[Buffer.alloc(600),Buffer.alloc(600)])).status,413);assert.deepEqual(await send({},[Buffer.from('汉')]),{status:200,body:'3'});}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('R2 read rejects declared size before allocation and cancels overlong streaming objects',async()=>{
 let buffered=false,cancelled=false,pulls=0;
 await assert.rejects(()=>boundedObjectBytes({size:500,arrayBuffer:async()=>{buffered=true;return new ArrayBuffer(500);}},10,100),e=>e.code==='STORAGE_SIZE');assert.equal(buffered,false);
 const body=new ReadableStream({pull(c){pulls++;c.enqueue(new Uint8Array(6));},cancel(){cancelled=true;}},{highWaterMark:0});
 await assert.rejects(()=>boundedObjectBytes({body,arrayBuffer:async()=>{throw Error('must stream');}},10,100),e=>e.code==='STORAGE_SIZE');assert.equal(pulls,2);assert.equal(cancelled,true);
 assert.deepEqual(await boundedObjectBytes({size:3,body:new Blob([new Uint8Array([1,2,3])]).stream(),arrayBuffer:async()=>{throw Error('must stream');}},3,100),new Uint8Array([1,2,3]));
});
