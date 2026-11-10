import copy,json
import pytest
from neo_agent.claim_support import decode_compact_claims,validate_claims
from neo_agent.current_knowledge import knowledge_versions
from neo_agent.runtime import assessment_document,frozen_scope
from neo_agent.task_plan import plan_task
from test_unified_runtime import job


def counter_assessment(span=False):
    j=job(question='如果适用范围得到确认，则可能需要调整履约方案')
    j['businessId']='test-a';j['envelope']['snapshot']['businessId']='test-a';j['envelope']['runtimeScope']['businessId']='test-a'
    scope=frozen_scope(j)
    item={'statement':j['question'],'statementType':'hypothesis','path':'draft.hypotheses.0','paths':['draft.hypotheses.0']}
    metric={'id':'metric:units','kind':'metric','exact':'{"value":10,"unit":"件","status":"observed"}'}
    counter={'id':'document-B:paragraph:0','kind':'paragraph','exact':'该地区暂不适用此规则，条件须另行核验。','documentId':'document-B','documentVersion':'body-v1','sourceId':'source-B','sourceVersion':'1','location':'https://example.gov.cn/policy','claims':[{'id':'claim-B','kind':'knowledge_claim','knowledgeId':'claim-B','knowledgeVersion':'claim-v1','location':'https://example.gov.cn/policy','documentId':'document-B','documentVersion':'body-v1','sourceId':'source-B','sourceVersion':'1'}]}
    selected=[1,0,10] if span else 1
    value,catalog=decode_compact_claims({'claims':[{'i':0,'s':'I','r':[0],'c':[selected],'g':['适用范围待确认']}]},{metric['id']:metric,counter['id']:counter},scope,1)
    claims=validate_claims(value,[item],catalog,scope);claims[0]['counterevidence'].append('校验器评论，不是依赖或企业事实')
    draft={'finding':{'conclusion':item['statement'],'evidenceIds':[],'alternatives':[],'gaps':[],'candidates':[],'followups':[]},'specialists':{},'toolReads':[],'marketEvidence':[]}
    state={'job':j,'scope':scope,'runtimePlan':plan_task(j),'claims':claims,'calculationContext':{},'diagnostics':{}}
    return assessment_document(state,draft)


@pytest.mark.parametrize('span',[False,True])
def test_exact_counter_only_versions_reach_actual_assessment_and_nested_paragraph_claim(span):
    a=counter_assessment(span);claim=a['claims'][0];ref=claim['counterevidence'][0]
    assert ref['id'] in claim['dependencyIds'] and claim['dependencyIds'][0]=='metric:units'
    assert '校验器评论，不是依赖或企业事实' not in claim['dependencyIds']
    versions=a['context']['versions'];ids={r.get('id') for r in versions}
    assert {'claim-B','document-B','source-B','configuration:legacy-unversioned'}<=ids
    doc=next(r for r in versions if r.get('id')=='document-B');assert ref['id'] in doc['paragraphReferences']
    assert ref['exact']==('该地区暂不适用此规则' if span else '该地区暂不适用此规则，条件须另行核验。')
    assert knowledge_versions(a['claims'])==knowledge_versions([{**claim,'counterevidence':[ref,ref,'评论']}])
