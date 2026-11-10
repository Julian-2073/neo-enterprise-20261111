
def test_scoped_enterprise_memory_cannot_be_applied_to_global_or_other_channel_period():
    from neo_agent.current_knowledge import read_knowledge
    env={'snapshot':{'businessId':'b','dataNature':'demo','periodStart':'2026-09-01','periodEnd':'2026-09-30'},'knowledge':{'businessId':'b','dataNature':'demo','capturedAt':'2026-10-08','rules':[{'id':'r','state':'active','confirmedBy':'owner','scope':{'entities':['SKU-R1'],'channels':['douyin'],'period':{'start':'2026-09-03','end':'2026-09-30'}}}]}}
    assert read_knowledge(env,'安全库存规则')['rules']==[]
    env['conversation']={'active':{'entityId':'P1','skuId':'SKU-R1','channelId':'douyin','period':{'start':'2026-09-03','end':'2026-09-30'}}}
    assert len(read_knowledge(env,'安全库存规则')['rules'])==1
    env['conversation']['active']['channelId']='tmall';assert read_knowledge(env,'安全库存规则')['rules']==[]
    env['conversation']['active']['channelId']='douyin';env['conversation']['active']['period']['start']='2026-09-01';assert read_knowledge(env,'安全库存规则')['rules']==[]
