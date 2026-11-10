// A legacy branch migration may be reused only after its exact objects are verified.
const owners={neo_business_heads:'0016_light_mac_gargan.sql',neo_business_publications:'0016_light_mac_gargan.sql',neo_forecast_jobs:'0018_perfect_maddog.sql',neo_control_heads:'0019_typical_king_bedlam.sql',neo_control_resources:'0019_typical_king_bedlam.sql'};
const normalize=s=>String(s).replace(/[`"[\]]/g,'').replace(/\bIF NOT EXISTS\b/gi,'').replace(/\s+/g,' ').replace(/;$/,'').trim().toLowerCase();
export async function legacyCompatibleStatements(DB,name,statements){
 if(name!=='0018_woozy_puma.sql')return statements;
 const result=[];
 for(const sql of statements){
  const match=sql.match(/^CREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX)\s+`?(\w+)`?/i);
  if(match){
   const table=match[1].toUpperCase()==='TABLE'?match[2]:sql.match(/\bON\s+`?(\w+)`?/i)?.[1],owner=owners[table];
   const existing=await DB.prepare('SELECT sql FROM sqlite_master WHERE name=?').bind(match[2]).first();
   if(!existing){result.push(sql);continue;}
   const receipt=owner&&await DB.prepare('SELECT name FROM neo_local_migrations WHERE name=?').bind(owner).first();
   if(!receipt||normalize(existing.sql)!==normalize(sql))throw Error('Legacy migration object differs: '+match[2]);
   continue;
  }
  if(/^ALTER TABLE `ontology_builds` ADD `generation_id`/.test(sql)){
   const info=await DB.prepare('PRAGMA table_info(ontology_builds)').all(),field=info.results.find(r=>r.name==='generation_id');
   if(!field){result.push(sql);continue;}
   const receipt=await DB.prepare('SELECT name FROM neo_local_migrations WHERE name=?').bind('0017_pretty_revanche.sql').first(),foreign=await DB.prepare('PRAGMA foreign_key_list(ontology_builds)').all();
   if(!receipt||field.type.toLowerCase()!=='text'||field.notnull||!foreign.results.some(r=>r.from==='generation_id'&&r.table==='neo_business_generations'&&r.to==='id'))throw Error('Legacy generation relation differs');
   continue;
  }
  result.push(sql);
 }
 return result;
}
