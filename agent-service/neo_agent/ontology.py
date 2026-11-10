"""Bounded, read-only ObjectSet tools over the version pinned by the TS gateway."""
from datetime import date, datetime, timezone
import math, base64, zlib, json

def _unpack_ontology(packed):
    if not isinstance(packed,dict):raise ValueError('固定输入编码无效')
    if packed.get('codec')!='gzip-base64':raise ValueError('不支持的Ontology编码')
    compressed=base64.b64decode(packed['payload'],validate=True)
    decoder=zlib.decompressobj(16+zlib.MAX_WBITS);raw=decoder.decompress(compressed,16*1024*1024+1)
    if len(raw)>16*1024*1024 or decoder.unconsumed_tail or decoder.unused_data or not decoder.eof:raise ValueError('对象数据超过解码预算或损坏')
    if 'rawBytes' in packed and (type(packed['rawBytes']) is not int or packed['rawBytes']!=len(raw)):raise ValueError('固定输入存储大小不一致')
    value=json.loads(raw)
    if not isinstance(value,dict):raise ValueError('固定对象输入无效')
    return value

def expand_ontology(env):
    try:
        if env.get('envelopePacked'):
            value=_unpack_ontology(env['envelopePacked'])
            if value.get('ontologyRef')!=env.get('ontologyRef') or value.get('envelopePacked'):raise ValueError('对象版本不匹配或嵌套输入')
            # The TS gateway attaches decision context after storing the compact envelope.
            # Never allow outer fields to replace frozen facts/snapshot/domain.
            env={**value,**{k:env[k] for k in ('decisionContext','ontologyRequestedObjectSet','platformConfiguration','runtimeScope','operatingPlanning') if k in env}}
        if env.get('ontology') or not env.get('ontologyPacked'):return env
        value=_unpack_ontology(env['ontologyPacked'])
        if value.get('ref')!=env.get('ontologyRef'):raise ValueError('对象版本不匹配')
        view={**env,'ontology':value}
        if env.get('ontologyRequestedObjectSet'):view['ontology']['requestedObjectSet']=env['ontologyRequestedObjectSet']
        return view
    except (KeyError,TypeError,zlib.error,ValueError) as e:raise ValueError('固定对象输入无法解码或版本不匹配') from e

def _scalar(value, prop):
    if value is None or value == '':
        if prop.get('required'): raise ValueError('必填值缺失')
        return None
    kind=prop['type']
    if kind=='string':
        if not isinstance(value,str) or len(value)>2000:raise ValueError('需要文本')
        return value.strip()
    if kind=='boolean':
        if value is True or value=='true':return True
        if value is False or value=='false':return False
        raise ValueError('需要布尔值')
    if kind in ('date','datetime'):
        if not isinstance(value,str):raise ValueError('日期无效')
        parsed=date.fromisoformat(value) if kind=='date' else datetime.fromisoformat(value.replace('Z','+00:00'))
        if kind=='datetime' and parsed.tzinfo is None:raise ValueError('时间需要时区')
        return value if kind=='date' else parsed.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
    if isinstance(value,bool):raise ValueError('数值无效')
    try:n=float(value)
    except (ValueError,TypeError):raise ValueError('数值无效')
    if not math.isfinite(n) or kind=='integer' and (not n.is_integer() or abs(n)>9007199254740991):raise ValueError('数值无效')
    return n

def scalar(value, prop):
    v=_scalar(value,prop)
    if prop.get('enum') is not None and not any(v==x and isinstance(v,bool)==isinstance(x,bool) for x in prop['enum']):raise ValueError('不符合枚举约束')
    if v is not None and isinstance(v,(int,float)):
        if prop.get('min') is not None and v<prop['min']:raise ValueError('低于属性最小值')
        if prop.get('max') is not None and v>prop['max']:raise ValueError('高于属性最大值')
    return v

def policy_view(env, role):
    env=expand_ontology(env)
    if role!='orchestrator' and 'operatingPlanning' in env:env={k:v for k,v in env.items() if k!='operatingPlanning'}
    policy=env.get('agentPolicy')
    if not policy:return env
    access=policy.get('roles',{}).get(role)
    if policy.get('version')!='ontology-policy-v2' or not access:raise ValueError('缺少当前专业的受控策略')
    ontology=env.get('ontology')
    if not ontology:return env
    properties=access['types'];types=[]
    for t in ontology['definition']['types']:
        allowed=properties.get(t['id'],[])
        if allowed:types.append({**t,'properties':{k:v for k,v in t['properties'].items() if k in allowed}})
    ids={t['id'] for t in types}
    links=[l for l in ontology['definition']['links'] if l['from'] in ids and l['to'] in ids and l['property'] in properties[l['from']]]
    linkids={l['id'] for l in links}
    titleprops={t['id']:t.get('title') for t in ontology['definition']['types']}
    objects=[{**o,'title':o.get('title',o['id']) if titleprops.get(o['typeId']) in properties[o['typeId']] else o['id'],'properties':{k:v for k,v in o['properties'].items() if k in properties[o['typeId']]}} for o in ontology['objects'] if o['typeId'] in ids]
    return {**env,'ontology':{**ontology,'definition':{**ontology['definition'],'types':types,'links':links},'objects':objects,'links':[l for l in ontology['links'] if l['linkId'] in linkids]}}

def query_objects(env,q):
    env=expand_ontology(env);o=env.get('ontology')
    if not o:raise ValueError('当前任务尚未绑定 Ontology 对象版本')
    if not isinstance(q,dict):raise ValueError('需要对象集查询')
    types={t['id']:t for t in o['definition']['types']};t=types.get(q.get('typeId'))
    if not t:raise ValueError('对象类型不存在')
    filters=q.get('filters',[])
    if not isinstance(filters,list) or len(filters)>20:raise ValueError('筛选条件无效')
    def matches(obj):
        for f in filters:
            p=t['properties'].get(f.get('property'));op=f.get('op')
            if not p or op not in ('eq','in','gte','lte','isNull'):raise ValueError('属性或筛选无效')
            v=obj['properties'].get(f['property'])
            if op=='isNull':
                if v is not None:return False
                continue
            if op=='in':
                vals=f.get('value')
                if not isinstance(vals,list) or len(vals)>100:raise ValueError('in筛选无效')
                if v not in [scalar(x,p) for x in vals]:return False
                continue
            c=scalar(f.get('value'),p)
            if op=='eq':
                if v!=c:return False
            else:
                if p['type'] not in ('integer','number','date','datetime'):raise ValueError('此类型不支持范围筛选')
                if v is None or c is None or (v<c if op=='gte' else v>c):return False
        return True
    # Validate filters even for an empty input set.
    for f in filters:
        p=t['properties'].get(f.get('property'));op=f.get('op')
        if not p or op not in ('eq','in','gte','lte','isNull'):raise ValueError('属性或筛选无效')
        if op in ('gte','lte') and p['type'] not in ('integer','number','date','datetime'):raise ValueError('此类型不支持范围筛选')
        if op=='in':
            if not isinstance(f.get('value'),list) or len(f['value'])>100:raise ValueError('in筛选无效')
            for v in f['value']:scalar(v,p)
        elif op!='isNull':scalar(f.get('value'),p)
    result=[x for x in o['objects'] if x['typeId']==t['id'] and matches(x)]
    traversal=q.get('traverse')
    if traversal:
        link=next((l for l in o['definition']['links'] if l['id']==traversal.get('linkId')),None);direction=traversal.get('direction')
        if not link or direction not in ('out','in') or link['from' if direction=='out' else 'to']!=t['id']:raise ValueError('联查关系无效')
        ids={x['id'] for x in result};origin='fromId' if direction=='out' else 'toId';dest='toId' if direction=='out' else 'fromId'
        targets={x[dest] for x in o['links'] if x['linkId']==link['id'] and x[origin] in ids};t=types[link['to' if direction=='out' else 'from']]
        result=[x for x in o['objects'] if x['typeId']==t['id'] and x['id'] in targets]
    result.sort(key=lambda x:x['id'])
    sort=q.get('sort')
    if sort:
        prop=sort.get('property');direction=sort.get('direction')
        if prop not in t['properties'] or direction not in ('asc','desc'):raise ValueError('排序无效')
        present=[x for x in result if x['properties'].get(prop) is not None];missing=[x for x in result if x['properties'].get(prop) is None]
        present.sort(key=lambda x:x['properties'][prop],reverse=direction=='desc');result=present+missing
    cursor=q.get('cursor',0);limit=q.get('limit',50)
    if type(cursor)!=int or cursor<0 or type(limit)!=int or limit<1 or limit>100:raise ValueError('分页无效')
    aggregate=None;a=q.get('aggregate')
    if a:
        if a.get('op')=='count':aggregate={'value':len(result),'unit':'个'}
        elif a.get('op')=='sum':
            p=t['properties'].get(a.get('property'))
            if not p or p['type'] not in ('integer','number'):raise ValueError('sum需要数值属性')
            values=[x['properties'].get(a['property']) for x in result if type(x['properties'].get(a['property'])) in (int,float)]
            total=sum(values)
            if not math.isfinite(total):raise ValueError('汇总溢出')
            aggregate={'value':total if values else None,'unit':p.get('unit'),'missing':len(result)-len(values)}
        else:raise ValueError('聚合无效')
    selected=result[cursor:cursor+limit]
    # Object provenance IDs are admitted only after a successful read and emitted in the trace.
    evidence=list(dict.fromkeys(p['id'] for x in selected for p in x.get('provenance',[])))
    return {'typeId':t['id'],'items':selected,'total':len(result),'nextCursor':cursor+limit if cursor+limit<len(result) else None,'aggregate':aggregate,'ontologyRef':o['ref'],'evidenceIds':evidence,'requestedObjectSet':o.get('requestedObjectSet')}
