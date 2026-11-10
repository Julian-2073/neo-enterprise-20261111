import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const SOURCE=process.env.NEO_SYNTHETIC_SOURCE||fileURLToPath(new URL('../../examples/neo-synthetic-20261004',import.meta.url));
export const EXPECTED_SHA='b00d1a5e683a4a9154008f3a9c5daa3d3c9fd643e60809c7d7fc075c599f13f7';
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function loadSource(){const p=path.join(SOURCE,'normal/source-records.json');const bytes=await readFile(p);if(sha(bytes)!==EXPECTED_SHA)throw Error('Pinned source changed');return {records:JSON.parse(bytes),design:JSON.parse(await readFile(path.join(SOURCE,'design.json'),'utf8')),manifest:JSON.parse(await readFile(path.join(SOURCE,'manifest.json'),'utf8'))};}
export async function sourceFingerprints(){const m=JSON.parse(await readFile(path.join(SOURCE,'manifest.json'))),files=[];async function walk(dir=''){for(const entry of await readdir(path.join(SOURCE,dir),{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else if(entry.isFile()){const raw=await readFile(path.join(SOURCE,file)),actual=sha(raw);if(m.files[file]&&actual!==m.files[file].sha256)throw Error('Source fingerprint changed: '+file);files.push({file,sha256:actual,bytes:raw.length,manifestListed:!!m.files[file]});}else throw Error('Unexpected source entry: '+file);}}await walk();return {manifestListedFiles:Object.keys(m.files).length,files:files.sort((a,b)=>a.file.localeCompare(b.file))};}
export function rawMaterialRows(d){const from='2026-03-30',roles=new Map(d.product_roles.map(r=>[r.id,r.external_id]));return {
 roles:d.product_roles.map(r=>({source_record_id:`${r.external_id}-source`,effective_from:from,role_id:r.external_id,name:r.name,purpose:r.purpose})),
 channels:d.channels.map(r=>({source_record_id:`${r.id}-source`,effective_from:from,channel_id:r.id,name:r.name})),
 warehouses:d.warehouses.map(r=>({source_record_id:`${r.id}-source`,effective_from:from,warehouse_id:r.id,name:r.name})),
 customers:d.customers.map(r=>({source_record_id:`${r.id}-source`,effective_from:r.created_at.slice(0,10),customer_id:r.id,name:r.synthetic_label})),
 products:d.products.map(r=>({source_record_id:`${r.id}-source`,effective_from:r.known_at.slice(0,10),product_id:r.id,name:r.name,role_id:roles.get(r.role_id)})),
 skus:d.skus.map(r=>({source_record_id:`${r.id}-source`,effective_from:from,sku_id:r.id,product_id:r.product_id,name:r.name,role_id:roles.get(r.role_id),unit:'件'})),
 };}
