"""Shared request planning and unlimited usage policy, independent of source adapters/providers."""
import re

TASK_TYPES = ('QUERY', 'EXPLAIN', 'DIAGNOSE', 'FORECAST', 'SIMULATE', 'DECIDE', 'REVIEW')

ANSWER_INTENTS = {
    'QUERY': '取得用户所问的经营事实或数值，不扩展成诊断报告',
    'EXPLAIN': '解释用户所问的口径或变化，区分已知现象与未证实原因',
    'DIAGNOSE': '找出最关键的经营问题，核对可能原因与反证',
    'FORECAST': '回答未来数值与适用条件，不把预测当承诺',
    'SIMULATE': '比较已明确条件下的方案差异，不把试算当已执行',
    'DECIDE': '给出当前最值得先做的一件事及成立条件',
    'REVIEW': '综合已核对事实，只保留最重要的经营判断和次序',
}

def answer_contract(task):
    """Stable boss-facing contract; internal reasoning and tool traces stay out of the reply."""
    return {
        'intent': ANSWER_INTENTS[task],
        'workflow': ['界定问题对象、时间与口径', '只读取回答所需的经营数据', '分开事实、推断与缺口', '生成简短直接回答'],
        'visible': {
            'conclusion': '一句直接回答，不超过70个中文字符',
            'basis': '最多2条关键经营事实，不复述查询过程',
            'nextStep': '最多1个可执行下一步；纯查询且无需行动时为null',
        },
    }

def saved_record_query(question):
    return bool(re.search(r"已保存|保存的|保存选择|选择记录|方案记录|决策记录",question) and re.search(r"查询|读取|列出|解释|含义|口径|为何|为什么|是什么|查一下",question))

def recognize_task(job):
    if job.get('taskType') in TASK_TYPES:
        return job['taskType']
    purpose=job.get('purpose','analysis')
    if purpose in ('patrol','home','review','briefing','weekly'):
        return 'REVIEW'
    from .ontology import expand_ontology
    basis=expand_ontology(job.get('envelope',{})).get('operatingBasis',{})
    if purpose=='operating' and not basis.get('interaction'):
        return 'REVIEW'
    question=job.get('question','')
    if re.fullmatch(r'(你好|您好|嗨|hello|hi|谢谢|帮助|你能做什么)[!！?？。\s]*',question.strip(),re.I):return 'QUERY'
    if saved_record_query(question):return 'EXPLAIN' if re.search(r'解释|含义|口径|为何|为什么',question) else 'QUERY'
    # Negative instructions do not promote a factual question to simulation.
    question=re.sub(r'(?:不|无需|不要|先不)[^，。；\n]*?(?:预测|推演|模拟|方案|研判|审查|诊断|分析|建议|解释)', '',question)
    for task,pattern in [('REVIEW',r'全面|整体|综合|复核|审查|研判|周报|简报'),
                         ('SIMULATE',r'如果|假设|推演|模拟|方案比较|比较(?:[^，。；\n]{0,16})方案'),
                         ('FORECAST',r'预测|未来.*(?:多少|销量|库存|房晚)'),
                         ('DECIDE',r'优先|先做|该怎么|怎么办|决策|选择|建议'),
                         ('EXPLAIN',r'解释|含义|口径|怎么计算|为何|为什么'),
                         ('QUERY',r'多少|查询|读取|列出|只核对|只比较|查一下|查看|看看|是什么')]:
        if re.search(pattern,question,re.I):return task
    # Explicit metric checks are factual queries even without a question mark.
    # Keep diagnosis/causal language out; higher-priority scenario/decision intents
    # above still win, so a conditional or recommendation is never demoted.
    if re.match(r'^(?:请)?(?:帮我)?核对(?:一下)?',question.strip()) and not re.search(r'分析|诊断|排查|异常|原因|涨跌|上升|下降|增长|变化|增加|减少|问题',question) and re.search(r'(?:笔数|件数|数量|金额|余额|总数|库存量|销量|收入|营收|毛利|成本|费用)[。？?！!\s]*$',question):return 'QUERY'
    # Metric-name follow-ups need not repeat an explicit query verb.
    if not re.search(r'分析|诊断|排查|异常|原因|涨跌|上升|下降|增长|变化|增加|减少|问题',question) and re.search(r'(?:笔数|件数|数量|金额|余额|总数|库存量|销量|收入|营收|毛利|成本|费用)(?:呢[？?]?|[？?])\s*$',question):return 'QUERY'
    return 'DIAGNOSE'

def plan_task(job):
    task=recognize_task(job);mode=job.get('mode','joint');purpose=job.get('purpose','analysis')
    from .ontology import expand_ontology
    env=expand_ontology(job.get('envelope',{}))
    scenario_context=env.get('scenarioContext') or env.get('operatingBasis',{}).get('scenarioContext') or {}
    complex_decide=task=='DECIDE' and len(scenario_context.get('results',[]))>1
    budget_class='simple' if task in ('QUERY','EXPLAIN') else 'scenario' if task=='SIMULATE' or complex_decide else 'review'
    records=task in ('QUERY','EXPLAIN') and saved_record_query(job.get('question',''))
    # Keep the organization adapter only when the factual question needs its
    # saved-record reader; ordinary business metrics use a subject specialist.
    if records:mode='orchestrator'
    elif mode=='orchestrator' and task in ('QUERY','EXPLAIN'):mode='joint'
    if task=='REVIEW' and (mode=='joint' or purpose in ('home','briefing','weekly')):roles=['conversion','supply','market']
    elif purpose in ('home','briefing','weekly') or mode=='orchestrator':roles=['orchestrator']
    elif mode in ('conversion','supply','market'):roles=[mode]
    elif task=='REVIEW':roles=['conversion','supply','market']
    else:
        question=job.get('question','')
        roles=[]
        for role,pattern in [('conversion',r'客户|转化|订单|成交|销量|退款|旅程|成本|毛利|营收|收入|经营费用'),('supply',r'库存|供给|到货|房晚|房型|房量|容量|停售|维修占用|入住日|预订|产能|物料|履约|返库|预测'),('market',r'渠道|市场|竞品|政策|广告|投放')]:
            if re.search(pattern,question):roles.append(role)
        if task=='FORECAST' and 'supply' not in roles:roles.append('supply')
        if not roles:roles=['joint']
    computation_roles=[r for r in roles if r in ('conversion','supply','market')] or ['conversion']
    if task in ('QUERY','EXPLAIN') and len(roles)>1:roles=['joint']
    tools=['describe_business','read_business','query_objects']
    if records:tools+=['read_decisions']
    if task not in ('QUERY','EXPLAIN'):tools+=['read_specialists','read_decisions']
    if task in ('REVIEW','DIAGNOSE','DECIDE'):tools+=['search_market']
    if task in ('FORECAST','SIMULATE'):tools+=['forecast']
    if task=='SIMULATE':tools+=['simulate_scenario']
    if env.get('operatingPlanning'):tools+=['read_operating_plan','optimize_operating_plan']
    return {'taskType':task,'budgetClass':budget_class,'requiresSavedRecords':records,'selected':roles,'computationSections':computation_roles,'tools':tools,'answerContract':answer_contract(task),
            'stages':['context_plan','query_calculation','hypothesis_investigation','synthesis','validation','save']}

def unlimited_limits(limits):
    """Runtime usage is recorded, without spending or call-count admission caps.

    Zero market searches means the provider is disabled, not a cost budget.
    Retry/timeout bounds still describe execution lifecycle.
    """
    return {**limits,**{k:None for k in ('maxTokens','maxModelCalls','maxToolCalls','completionTokens')},
            'maxMarketSearches':0 if limits.get('maxMarketSearches')==0 else None}


def task_limits(job,defaults):
    requested=job.get('budget') or {}
    lifecycle={k:min(defaults[k],requested.get(k) or defaults[k]) for k in ('maxAttempts','timeoutSeconds')}
    return unlimited_limits({**defaults,**requested,**lifecycle})
