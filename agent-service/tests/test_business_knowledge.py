import json
from pathlib import Path
import pytest
from neo_agent.knowledge import business_knowledge,catalog

ENV={'snapshot':{'businessId':'test-tenant','dataNature':'demo','id':'test-snapshot'}}
def test_full_catalog_and_sources_are_packaged():
    data=catalog();assert len(data['rules'])==30;assert len(data['practices'])==50;assert len(data['sources'])==29
    sources={s['id'] for s in data['sources']};assert all(set(r['sources'])<=sources for r in data['rules'])
    assert data['enterpriseConfirmation']=='unconfirmed'
def test_retrieval_bound_to_pinned_business_and_role():
    result=business_knowledge(ENV,'conversion','订单笔数与客户人数有什么区别')
    assert result['businessId']=='test-tenant';assert result['snapshotId']=='test-snapshot';assert result['dataNature']=='demo'
    assert len(result['rules'])<=6;assert any(r['id']=='K04' for r in result['rules'])
    assert all(r['id'] not in ('K29','K30') for r in result['rules']);assert result['enterpriseConfirmation']=='unconfirmed'
def test_supply_knowledge_preserves_pending_parameters_and_sources():
    result=business_knowledge(ENV,'supply','退款可以直接补回可售库存吗')
    assert any(r['id']=='K13' for r in result['rules']);assert result['sources'];assert all(r['must_confirm'] for r in result['rules'])
    assert '不能据此修改' in result['limits'][2]
def test_invalid_scope_and_unbounded_retrieval_rejected():
    for limit in (0,7,True):
        with pytest.raises(ValueError):business_knowledge(ENV,limit=limit)
    with pytest.raises(ValueError):business_knowledge({'snapshot':{'businessId':'x','dataNature':'other','id':'s'}})
    with pytest.raises(ValueError):business_knowledge(ENV,'unrecognized')
def test_bounded_retrieval_and_archival_materials_present():
    main=Path(__file__).resolve().parents[2]
    limited=business_knowledge(ENV,'conversion','订单笔数与客户人数有什么区别',limit=2)
    assert len(limited['rules'])<=2 and limited['snapshotId']=='test-snapshot'
    assert limited['enterpriseConfirmation']=='unconfirmed'
    original=json.loads((main/'docs/business-knowledge/research/业务关系与规则.json').read_text());assert original['items']==catalog()['rules']
