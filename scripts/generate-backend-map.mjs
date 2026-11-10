import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';
import {capabilities,pages,contractPath} from './backend-contract.mjs';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function list(root,dir){const full=path.join(root,dir);if(!fs.existsSync(full))return [];return fs.readdirSync(full,{withFileTypes:true}).flatMap(e=>e.isSymbolicLink()||['__pycache__','state','outputs','.venv','node_modules'].includes(e.name)?[]:e.isDirectory()?list(root,path.posix.join(dir,e.name)):[path.posix.join(dir,e.name)]);}
// Inspect syntax, not comments. Resource-level method discovery is deliberately
// conservative and does not prove authorization, response contents or a running service.
function declarations(file,text){
 const ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);const rows=[];
 function visit(node){
  if(ts.isIfStatement(node)){
   const resources=[];const methods=[];
   function condition(n){
    if(ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.EqualsEqualsEqualsToken){
     const left=n.left.getText(ast);const right=n.right;
     if(ts.isStringLiteral(right)&&left==='resource')resources.push(right.text);
     if(ts.isStringLiteral(right)&&['request.method','method'].includes(left))methods.push(right.text);
    }
    if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='includes'&&ts.isArrayLiteralExpression(n.expression.expression)&&n.arguments[0]?.getText(ast)==='resource')resources.push(...n.expression.expression.elements.filter(ts.isStringLiteral).map(e=>e.text));
    ts.forEachChild(n,condition);
   }
   condition(node.expression);
   if(resources.length){
    function body(n){if(ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.EqualsEqualsEqualsToken&&['request.method','method'].includes(n.left.getText(ast))&&ts.isStringLiteral(n.right))methods.push(n.right.text);ts.forEachChild(n,body);}
    body(node.thenStatement);
    for(const resource of resources)rows.push({resource,methods:[...new Set(methods)],line:ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1});
   }
  }
  ts.forEachChild(node,visit);
 }
 visit(ast);return rows;
}
export function buildBackendMap(root){
 const files=[...new Set(['app','components','lib','db','drizzle','server','worker','agent-service/neo_agent','scripts'].flatMap(d=>list(root,d)))].filter(f=>/\.(?:[cm]?[jt]sx?|py|json|sql|md)$/.test(f)).sort();
 const texts=new Map(files.map(f=>[f,fs.readFileSync(path.join(root,f),'utf8')]));
 const fingerprint=hash(files.map(f=>f+'\0'+hash(texts.get(f))).join('\n'));
 const source=(file,needle)=>{const text=texts.get(file)||'';const at=text.indexOf(needle);return {file,line:at<0?null:text.slice(0,at).split('\n').length,found:at>=0,excerpt:at<0?'未发现对应源码':text.slice(at,at+240)};};
 const routes=['server/api.ts','server/agents.ts','server/ontology/api.ts'].flatMap(file=>declarations(file,texts.get(file)||'').map(r=>({file,route:'/api/v1/'+(file.includes('/ontology/')?'ontology/':'')+r.resource,...r})));
 const pythonRoutes=[...texts].filter(([f])=>f.endsWith('.py')).flatMap(([file,text])=>[...text.matchAll(/^@(?:app|router)\.(get|post|patch|put|delete)\(['"]([^'"]+)['"]/gm)].map(m=>({file,route:m[2],methods:[m[1].toUpperCase()]})));
 const tables=[...new Set([...texts].filter(([f])=>f.startsWith('db/')).flatMap(([,t])=>[...t.matchAll(/sqliteTable\(['"]([^'"]+)/g)].map(m=>m[1])))];
 const matched=capabilities.map(c=>{const refs=[source(...c.source)];const declared=routes.filter(r=>r.file===c.file&&r.resource===c.resource);const eps=c.methods.map(m=>({endpoint:m+' /api/v1/'+(c.file.includes('/ontology/')?'ontology/':'')+c.resource,codePresent:declared.some(r=>r.methods.includes(m))}));return {...c,endpoints:eps,codePresent:c.resource?eps.every(e=>e.codePresent):refs.every(r=>r.found),evidence:refs,verification:{integration:{status:'unverified',note:'静态源码发现不替代当前版本实际链路验收。'},business:{status:'unverified',note:'真实企业经营效果需另验。'}}};});
 return {schemaVersion:2,scannedAt:new Date().toISOString(),sourceFingerprint:fingerprint,projectRoot:root,scan:{files:files.length,contractPath,warnings:[],limits:'扫描TS资源分支和FastAPI声明。计数仅代表发现代码，不代表运行、模型质量或业务通过。'},current:{routes,pythonRoutes,tables},pages,capabilities:matched,totals:{capabilities:matched.length,codeGroups:matched.filter(c=>c.codePresent).length,codeOperations:matched.flatMap(c=>c.endpoints).filter(e=>e.codePresent).length,accepted:0}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const root=path.resolve(import.meta.dirname,'..');const report=buildBackendMap(root);fs.mkdirSync(path.join(root,'stories'),{recursive:true});fs.writeFileSync(path.join(root,'stories/backend-map.generated.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({sourceFingerprint:report.sourceFingerprint,files:report.scan.files,resources:report.current.routes.length,fastApiDeclarations:report.current.pythonRoutes.length,codeGroups:report.totals.codeGroups,businessAcceptance:'not_claimed'}));}
