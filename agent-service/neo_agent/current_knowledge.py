"""Bounded frozen retrieval; the model rewrites a query and ranks cited results.

Metadata + keyword retrieval only. No vector store, mutable lookups or business
ledger. Runtime publication still passes the shared semantic checker.
"""
import re,json
from .engine import source_hash
from .time_scope import shanghai_day

def read_knowledge(env,query='',limit=6,cursor=0):
    k=env.get('knowledge') or {};s=env.get('snapshot') or env.get('operatingBasis') or {}
    if not k:return {'items':[],'rules':[],'pack':None,'gaps':[]}
    if any(k.get(key)!=s.get(key) for key in ('businessId','dataNature')):raise ValueError('知识企业/数据性质范围不一致')
    if type(cursor) is not int or cursor<0 or type(limit) is not int or not 1<=limit<=6:raise ValueError('知识分页范围无效')
    if not isinstance(query,str) or len(query)>1000:raise ValueError('知识查询过长')
    if re.search(r'多少|笔数|件数|数量|支付订单|退款订单',query) and not re.search(r'规则|政策|行业|知识|限制|约束|方法|为什么|为何',query):return {'items':[],'rules':[],'pack':None,'gaps':[],'versionFrozen':k.get('version')}
    captured=shanghai_day(k['capturedAt']) if 'T' in k['capturedAt'] else k['capturedAt'];active=env.get('conversation',{}).get('active',{});entity=active.get('skuId') or active.get('entityId');tokens=set(re.findall(r'[\u4e00-\u9fff]{2}|[A-Za-z_]{3,}',query.lower()))
    def eligible(r):
        scope=r.get('scope',{});period=active.get('period') or s.get('period') or {'start':s.get('periodStart'),'end':s.get('periodEnd')}
        if scope.get('entities') and (not entity or entity not in scope['entities']):return False
        if scope.get('channels') and active.get('channelId') not in scope['channels']:return False
        if scope.get('period') and (not period.get('start') or not period.get('end') or period['start']<scope['period']['start'] or period['end']>scope['period']['end']):return False
        return r.get('freshness',{}).get('status','current')=='current' and (not entity or not r.get('scope',{}).get('entities') or entity in r['scope']['entities']) and r.get('state') in ('active','confirmed') and (not r.get('expiresAt') or r['expiresAt']>=captured)
    def score(r):return sum(t in json.dumps(r,ensure_ascii=False).lower() for t in tokens)
    items=sorted([r for r in k.get('items',[]) if eligible(r) and r.get('supportStatus')=='supported'],key=lambda r:(-score(r),r['id']))
    rules=sorted([r for r in k.get('rules',[]) if eligible(r) and r.get('confirmedBy')],key=lambda r:(-score(r),r['id']))
    return {'items':items[cursor:cursor+limit],'rules':rules[cursor:cursor+limit],'page':{'cursor':cursor,'limit':limit,'totalItems':len(items),'totalRules':len(rules),'nextCursor':cursor+limit if cursor+limit<max(len(items),len(rules)) else None},'pack':k.get('pack'),'gaps':k.get('gaps',[]),'query':query,'retrieval':'metadata_keyword_model_rewrite_and_citation_ranking','limits':k.get('limits',[]),'coverage':k.get('coverage',{}),'absenceMeans':'not_in_frozen_delivery_not_proof_no_applicable_rule'}

def knowledge_catalog(value):
    refs={}
    # Paragraph identity describes only the readable original. Applicability
    # and effective dates belong to each separate claim, never to the paragraph.
    for item in sorted(value.get('items',[]),key=lambda item:item['id']):
        common={'sourceId':item['sourceId'],'sourceVersion':str(item.get('sourceVersion','')),'documentId':item['documentId'],'documentVersion':item['documentVersion'],'publishedAt':item['publishedAt'],'retrievedAt':item['retrievedAt'],'location':item['url']}
        claim={**common,'id':item['id'],'kind':'knowledge_claim','exact':item.get('statement',''),'knowledgeId':item['id'],'knowledgeVersion':item['version'],'effectiveAt':item.get('effectiveAt'),'expiresAt':item.get('expiresAt'),'applicabilityVerified':item.get('applicabilityVerified') is True}
        refs[item['id']]=claim
        for p in item['paragraphs']:
            ident=item['documentId']+':paragraph:'+str(p['index'])
            if ident not in refs:refs[ident]={**common,'id':ident,'kind':'paragraph','exact':p['text'],'claims':[],'locator':{'paragraph':p['index'],'start':p['start'],'end':p['end']}}
            refs[ident]['claims'].append(claim)
    for r in value.get('rules',[]):refs[r['id']]={'id':r['id'],'kind':'enterprise_rule','exact':json.dumps(r,ensure_ascii=False),'knowledgeId':r['id'],'knowledgeVersion':r['version'],'location':r.get('location','neo_enterprise_memories')}
    if value.get('pack'):
        p=value['pack'];refs[p['id']]={'id':p['id'],'kind':'reference_guidance','exact':json.dumps(p,ensure_ascii=False),'knowledgeId':p['id'],'knowledgeVersion':p['version'],'location':'server/knowledge-packs.ts','confirmation':'unconfirmed'}
    return refs

def model_knowledge_view(value):
    """Use already verified claims for diagnosis, with exact original locators.

    The frozen retrieval and semantic checker retain the complete paragraphs.
    Explicit knowledgeQuery reads still deliver the original supporting body.
    This is a claim index, never presented as a complete document read.
    """
    items=[]
    for item in value.get('items',[]):
        items.append({**{k:v for k,v in item.items() if k not in ('paragraphs','support')},
                      'paragraphReferences':[{'id':item['documentId']+':paragraph:'+str(p['index']),
                                               'index':p['index'],'start':p['start'],'end':p['end']}
                                              for p in item.get('paragraphs',[])]})
    return {**value,'items':items,'delivery':'verified_claim_index',
            'originalBodyRead':'describe_business with knowledgeQuery; complete original retained in frozen knowledge'}

def merge_knowledge_catalog(target,value):
    for ident,ref in knowledge_catalog(value).items():
        prior=target.get(ident)
        if prior and prior.get('kind')=='paragraph' and ref['kind']=='paragraph':
            if prior['exact']!=ref['exact'] or prior.get('documentVersion')!=ref.get('documentVersion'):raise ValueError('同段落身份对应不同原文版本')
            claims={(c['knowledgeId'],c['knowledgeVersion']):c for c in prior.get('claims',[])+ref.get('claims',[])}
            ref={**ref,'claims':[claims[k] for k in sorted(claims)]}
        target[ident]=ref
    return target

def knowledge_versions(claims):
    versions={}
    def add(r):
        if r.get('knowledgeId'):
            kind='industry_pack' if r['knowledgeId'].startswith('pack:') else 'enterprise_memory' if r.get('kind')=='enterprise_rule' else 'knowledge'
            versions[(r['knowledgeId'],r['knowledgeVersion'])]={'kind':kind,'id':r['knowledgeId'],'version':r['knowledgeVersion'],'location':r['location']}
        if r.get('documentId'):
            key=(r['documentId'],r['documentVersion']);prior=versions.get(key,{})
            paragraphs=list(dict.fromkeys(prior.get('paragraphReferences',[])+([r['id']] if r.get('kind')=='paragraph' else [])))
            versions[key]={'kind':'document','id':r['documentId'],'version':r['documentVersion'],'location':r['location'],'paragraphReference':paragraphs[0] if paragraphs else None,'paragraphReferences':paragraphs}
        if r.get('sourceVersion'):versions[(r['sourceId'],r['sourceVersion'])]={'kind':'knowledge_source','id':r['sourceId'],'version':r['sourceVersion'],'location':r['location']}
        for claim in r.get('claims',[]):add(claim)
    for c in claims:
        for r in [*c.get('supportingReferences',[]),*c.get('counterevidence',[])]:
            if isinstance(r,dict) and r.get('id') and r.get('kind') and isinstance(r.get('exact'),str):add(r)
    return list(versions.values())
