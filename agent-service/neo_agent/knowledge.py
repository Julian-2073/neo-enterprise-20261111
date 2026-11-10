"""Bounded, read-only business guidance; never tenant facts or approved parameters."""
import json
import re
from functools import lru_cache
from pathlib import Path

@lru_cache(maxsize=1)
def catalog():
    value=json.loads(Path(__file__).with_name('business-knowledge.json').read_text())
    if value.get('kind')!='REFERENCE_GUIDANCE' or value.get('enterpriseConfirmation')!='unconfirmed':
        raise ValueError('知识包性质无效')
    return value

def business_knowledge(env, role='joint', question='', limit=6):
    s=env['snapshot']
    if not s.get('businessId') or s.get('dataNature') not in ('demo','business'):
        raise ValueError('知识检索必须绑定当前企业与资料性质')
    if role not in ('conversion','supply','market','joint','orchestrator') or not isinstance(limit,int) or isinstance(limit,bool) or not 1<=limit<=6:
        raise ValueError('知识检索范围无效')
    data=catalog()
    groups={'conversion':{'K01','K02','K03','K04','K05','K06','K07','K08','K09','K11','K12','K27'},'supply':{'K01','K04','K10','K13','K15','K16','K17','K18','K19','K20','K21','K22','K27'},'market':{'K01','K06','K11','K12','K14','K23','K24','K25','K26','K27'}}
    candidates=[r for r in data['rules'] if r['id'] in groups.get(role,{f'K{i:02}' for i in range(1,29)})]
    tokens=set(re.findall(r'[\u4e00-\u9fff]{2}|[a-zA-Z_]{3,}',question[:1000].lower()))
    def score(r):
        text=(r['relationship']+' '+r['rule']+' '+r['scope']).lower()
        return sum(token in text for token in tokens)
    selected=sorted(candidates,key=lambda r:(-score(r),r['id']))[:limit]
    practices=sorted(data['practices'],key=lambda r:-sum(t in (r['title']+' '+r['proposal']).lower() for t in tokens))[:2] if tokens else []
    refs={x for r in selected+practices for x in r['sources']}
    return {'businessId':s['businessId'],'dataNature':s['dataNature'],'snapshotId':s['id'],
            'version':data['version'],'digest':data['digest'],'kind':data['kind'],
            'enterpriseConfirmation':'unconfirmed','rules':selected,'practices':practices,
            'sources':[{'id':r['id'],'title':r['title'],'url':r['url'],'checkedOn':r['checked_on'],'caveat':r['caveat']} for r in data['sources'] if r['id'] in refs],
            'limits':['这些是跨业务参考建议，不是当前企业事实或老板确认参数。','知识来源日期固定；未重新抓取网页，不证明当前政策或产品规格。','不能据此修改阈值、身份映射、采购、投放或创建实际经营结果。']}
