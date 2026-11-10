"""Homepage decisions connect business evidence, reference guidance and a saved forecast."""
import re, json
from .knowledge import catalog

def close_json_containers(raw):
    """Tolerate only missing terminal }/]; never supply values or fields.

    Provider responses remain unchanged in the invocation journal. The complete
    object still passes the same strict schema and evidence validation.
    """
    try:json.loads(raw);return raw
    except (json.JSONDecodeError,TypeError):pass
    if not isinstance(raw,str):return raw
    stack=[];quoted=False;escaped=False
    for char in raw:
        if quoted:
            if escaped:escaped=False
            elif char=='\\':escaped=True
            elif char=='"':quoted=False
        elif char=='"':quoted=True
        elif char in '{[':stack.append('}' if char=='{' else ']')
        elif char in '}]':
            if not stack or stack.pop()!=char:return raw
    if quoted or not stack:return raw
    candidate=raw+''.join(reversed(stack))
    try:json.loads(candidate)
    except json.JSONDecodeError:return raw
    return candidate

def home_output_schema(schema):
    """Only expose output types this read-only task can actually produce."""
    out=json.loads(json.dumps(schema))
    for key in ('organization','proposedAssumptions','businessReview','marketWorkbench','operatingRecommendation'):
        out['properties'][key]={'type':'null'}
    out['properties']['followups']={'type':'array','maxItems':0,'items':{'type':'string'}}
    definitions=out.pop('$defs',{})
    out['properties']['homeDecision']={'$ref':'#/$defs/HomeDecision'}
    out['required']=list(dict.fromkeys([*out.get('required',[]),'homeDecision']))
    home=definitions['HomeDecision']
    home['properties']['jointReview']={'$ref':'#/$defs/JointReview'}
    home['required']=list(dict.fromkeys([*home.get('required',[]),'jointReview']))
    needed=set()
    def visit(value):
        if isinstance(value,dict):
            ref=value.get('$ref','')
            if ref.startswith('#/$defs/'):
                name=ref.split('/')[-1]
                if name not in needed:
                    needed.add(name);visit(definitions[name])
            for child in value.values():visit(child)
        elif isinstance(value,list):
            for child in value:visit(child)
    visit(out)
    out['$defs']={key:definitions[key] for key in definitions if key in needed}
    def compact(v):
        if isinstance(v,dict):return {k:compact(x) for k,x in v.items() if k not in ('title','description','default')}
        return [compact(x) for x in v] if isinstance(v,list) else v
    return compact(out)

def normalize_home_response(raw):
    """Restore misplaced empty root fields without accepting extra content.

    These fields are explicitly null in the homepage output schema. No prose,
    references or non-null object is moved or discarded; strict validation still
    checks the complete result. The provider journal retains its original text.
    """
    raw=close_json_containers(raw)
    try:value=json.loads(raw)
    except (json.JSONDecodeError,TypeError):return raw
    if not isinstance(value,dict) or not isinstance(value.get('homeDecision'),dict):return raw
    home=value['homeDecision'];changed=False
    for key in ('organization','proposedAssumptions','businessReview','marketWorkbench','operatingRecommendation'):
        if key in home and home[key] is None and value.get(key) is None:
            value[key]=home.pop(key);changed=True
    return json.dumps(value,ensure_ascii=False) if changed else raw

def professional_output_schema(schema,market_workbench=False):
    """Prune unreachable output types; retain exact validation contract."""
    out=json.loads(json.dumps(schema));definitions=out.pop('$defs',{});needed=set()
    for key in ('organization','proposedAssumptions','homeDecision','operatingRecommendation')+(() if market_workbench else ('marketWorkbench',)):
        out['properties'][key]={'type':'null'}
    out['properties']['followups']={'type':'array','maxItems':0,'items':{'type':'string'}}
    def visit(value):
        if isinstance(value,dict):
            ref=value.get('$ref','')
            if ref.startswith('#/$defs/'):
                name=ref.split('/')[-1]
                if name not in needed:needed.add(name);visit(definitions[name])
            for child in value.values():visit(child)
        elif isinstance(value,list):
            for child in value:visit(child)
    visit(out);out['$defs']={k:definitions[k] for k in needed}
    def compact(v):
        if isinstance(v,dict):return {k:compact(x) for k,x in v.items() if k not in ('title','description','default')}
        return [compact(x) for x in v] if isinstance(v,list) else v
    return compact(out)

def dialogue_output_schema(schema,fields,optional=()):
    """Retain all reachable assumption definitions in the compact dialogue contract."""
    out=json.loads(json.dumps({'type':'object','properties':fields,'required':[k for k in fields if k not in optional],'additionalProperties':False}))
    definitions=schema.get('$defs',{});needed=set()
    def visit(value):
        if isinstance(value,dict):
            ref=value.get('$ref','')
            if ref.startswith('#/$defs/'):
                key=ref.split('/')[-1]
                if key not in needed:needed.add(key);visit(definitions[key])
            for child in value.values():visit(child)
        elif isinstance(value,list):
            for child in value:visit(child)
    visit(out)
    if needed:out['$defs']={key:definitions[key] for key in sorted(needed)}
    return out


def saved_dialogue_context(env):
    """Bounded view of the same immutable, scoped saved records; never a live read."""
    snapshot=env['snapshot'];context=env.get('decisionContext',{})
    scoped=dict(context)
    for collection in ('forecasts','scenarios','decisions'):
        scoped[collection]=[row for row in context.get(collection,[])
                            if all(row.get(key,expected)==expected for key,expected in
                                   (('businessId',snapshot['businessId']),('dataNature',snapshot['dataNature']),('snapshotId',snapshot['id'])))]
    return synthesis_context_view(scoped,env.get('homeDecisionContext',{}))


def synthesis_context_view(context,basis):
    """Synthesis uses every saved choice/total, and relevant source excerpts.

    Complete originals remain behind read_decisions(section='market') pagination
    and existing artifact APIs. Omitted weekly details are not sampled totals.
    """
    out=home_context_view(context,basis)
    # Historical UI blocks repeat the same saved conclusions; preserve the
    # primary conclusion, references, counterevidence, gaps and candidates.
    out['findings']=[{**r,'finding':{k:v for k,v in r.get('finding',{}).items() if k not in ('homeDecision','businessReview') }} for r in out.get('findings',[])]
    def compact_forecast(f):
        if not isinstance(f,dict):return f
        return {k:v for k,v in f.items() if k not in ('weeks','products','daily','endingInventory','forecastLines','featureSnapshots','sensitivity')}
    out['forecasts']=[compact_forecast(f) for f in out.get('forecasts',[])]
    out['scenarios']=[compact_forecast(f) for f in out.get('scenarios',[])]
    out['decisions']=[{**d,**({'selectedScenario':compact_forecast(d['selectedScenario'])} if d.get('selectedScenario') else {})} for d in out.get('decisions',[])]
    if out.get('homeDecisionContext',{}).get('forecast'):out['homeDecisionContext']['forecast']=compact_forecast(out['homeDecisionContext']['forecast'])
    cited={e for f in context.get('findings',[]) for e in f.get('finding',{}).get('evidenceIds',[])}
    selected={s['id'] for f in context.get('findings',[]) for s in (f.get('finding',{}).get('marketWorkbench') or {}).get('sources',[]) if s.get('selected')}
    candidates=out.get('marketEvidence',[])
    out['marketEvidence']=[s for s in candidates if s['id'] in cited|selected]
    out['marketSourcePagination']={'candidateCount':len(candidates),'includedCount':len(out['marketEvidence']),'readTool':'read_decisions','section':'market','limit':10,'note':'候选原文不是已确认事实；未选取或引用原文未送入本轮综合判断，可按页核查。'}
    out['projectionNote']='完整期间与所有保存选择/方案的总量、未知状态、时间和限制保留；各周/商品明细使用既有记录API。经营三分区完整查询已由专业检查点核验。'
    return out

HOME_INSTRUCTIONS = '''本轮生成首页三块经营结论，必须输出homeDecision，organization和proposedAssumptions为null，followups为空。
先describe_business，再read_business分别读取conversion、supply、market的当前完整范围，grain使用period，不传商品、渠道或缩窄日期。period已经同时给出完整期间与所有周的weeklyTotals，不需要再使用week生成重复的商品渠道周分组。事实样本不是全部资料，商品渠道明细按nextAggregateOffset继续分页，需要时精查。再read_decisions读取已经保存的调查、预测、选择及homeDecisionContext。同一范围及偏移已返回时不要重复查询；完成必要核查后直接输出最终JSON。不得用另一企业、快照或前端演示数值。
judgment.title是一句有业务含义的当前判断（例如某种商品库存承接不足、渠道投入与收益不匹配，必须有本次依据），不是“已读取数据/待巡检”。summary先解释已经发生的经营问题，至少引用一个本统计期的事实或当前库存事实，通常只留1至2个关键数值。不能用预测销量、未来毛利或期末库存替代当前经营情况，也不能把预期值当已发生的事实。各sections分别给客户、供给、渠道的短判断和实际证据。同期变化不能直接写成已经证明的因果关系。
outlook.forecastId逐字复制homeDecisionContext.forecast.id。title直接概括维持现状的预测结果，summary解释该基线的核心经营含义。outlook.title和summary只作定性解释，不使用任何阿拉伯数字、中文数词或带数字的产品型号；期间、数量、毛利和供给缺口由保存的预测自动展示。不能重新手算或编造预测。预测为null时forecastId=null，并具体指出缺少的预测资料，不产生数值。销量为支付出库件数，不是客户人数；部分商品需求未估算时，结论仅限已估算商品。贡献毛利不是净利润，毛利为null就说成本待补，不能按毛利好坏下结论。回测不足不等于基线数值不存在；无历史可用时点不能声称已验证预测准确率。假设敏感性不叫置信区间。
action.title是建议先做的一个具体动作，summary解释为何现在先做；steps最多3项，依次说明核查什么、再决定什么。建议应来自同一份judgment、已保存预测和查到的行业经营知识，不是通用“比较方案”，不把补库存当需求增长，不声称已经采购、投放或派单。
knowledgeVersion与knowledgeRuleIds只能复制describe_business.businessKnowledge实际返回值，并明确应用到判断与建议中；参考知识帮助解释和确定核查顺序，不是企业事实、已确认阈值或收益承诺。经营引用只能复制已成功读到的证据ID，知识规则ID不放evidenceIds。未知资料放gaps；来源、回测等细节不堆在首页短结论中，但改变结论的限制要说明。jointReview必须独立综合人货场，不是拼接首页摘要或重复三位专业的整段结论。status.title概括当前经营状况，status.summary最多两句话、建议100字内，只选一至两个已查询数字。先核对企业实际发生的经营事实，再结合read_decisions中的专业审查和marketWorkbench的AI筛选来源判断。market.summary一句说明市场线索对企业的具体意义，未核验或无相关原文时明确说缺什么；相关原文evidenceIds必须引用source_read的来源，读取时间晚于经营截至时间的原文只能当当前观察，不能解释已发生经营的因果。metricKeys选最能支撑判断的1至3个经营数字：netRevenue、margin、stock、conversion，数字由后端按原口径展示，不再生成数字字符串。confirmations最多3个真正可能改变经营选择的问题：question说要确认什么、why说对决策有何影响、check说核对什么资料；缺少资料时evidenceIds可为空，不能伪造缺失资料的来源；没有额外确认问题就空数组。nextAction给出当前证据下最优先的一个具体动作，summary简述做什么；whyFirst解释为何现在优于其他动作，decisionGate明确确认什么结果后再进入什么决策，steps最多3项且每项80字内。alternatives必须给1至2个可选动作及为何暂不优先，不能声称未计算方案是数学上收益最优、已经实施或保证收益。nextAction应与首页action保持相同核查方向。不要用内部标识、审计字段或绕口的时间关系代替业务判断。所有title短于36字，summary短于160字，steps每项短于80字。'''

HOME_INSTRUCTIONS+='联合研判对象必须嵌套于homeDecision.jointReview，不能放顶层，不能省略或置null。当前库存与整个统计期成交并列，不证明零库存时仍在履约，也不能据此认定成交受库存制约。联合研判的status和whyFirst要区分经营事实与推断：库存偏低只能说明供给风险需要优先核实，不说唯一已证实的制约或原因；购买客户增加不等于潜在需求已验证。nextAction优先安排核实，不用先补供给代替先核实供给。status.title尽量18字以内、summary90字以内；confirmations.question尽量24字、why45字，nextAction.title尽量20字，summary60字、whyFirst55字、decisionGate65字，保持业务含义。'

HOME_INSTRUCTIONS+='JSON层级：businessReview、marketWorkbench、operatingRecommendation只能在顶层为null，不能嵌入homeDecision。homeDecision.outlook必须含forecastId、title、summary；jointReview.alternatives每项只含action和whyNotFirst，不添加evidenceIds。全统计期、最近四周、前四周的数量须分别匹配其来源窗口；不能将全期退款量写成最近四周退款量。确认问题使用是否、哪些、如何等问句；核查步骤明确用核对或核实起句，尚未确认的归属与执行状态作为待核问题，不写成已知事实。'

HOME_INSTRUCTIONS+='预测解释只按homeDecisionContext.forecast.totals及forecastCoverage逐项形成：未来贡献毛利为负时必须说明该基线毛利为负，不能称毛利延续当前正水平；供给约束只称基线的条件推演，不能认定已经造成历史损失。待核步骤不重复事实段的数量与日期，实际事实单独呈现并引用；不足以说明原因时明确原因待核，不能编造整个企业从未核查。'

def full_section_read(args, snapshot):
    return (not args.get('productId') and not args.get('channel')
            and args.get('periodStart', args.get('start', snapshot['periodStart'])) == snapshot['periodStart']
            and args.get('periodEnd', args.get('end', snapshot['periodEnd'])) == snapshot['periodEnd'])

def home_business_view(value):
    """Complete business metrics, with audit-only duplication kept in query traces."""
    metric_keys = {'paidOrders','paidUnits','refundOrders','refundUnits','grossRevenueCents',
                   'refundCents','netRevenueCents','spendCents','variableCostCents',
                   'contributionMarginCents','behaviorCounts','metricStatus','inventoryPosition'}
    identity_keys = {'productId','channel','weekStart','periodStart','periodEnd','start','end'}
    def metrics(row):
        out={k:v for k,v in row.items() if k in metric_keys|identity_keys}
        if 'metricStatus' in out:
            out['metricStatus']={k:v for k,v in out['metricStatus'].items() if k in metric_keys or k.startswith('A')}
        return out
    keys=('snapshotId','asOf','dataNature','scope','evidenceIds','factCount','coverage','quality','limitations',
          'aggregateCount','nextAggregateOffset','inventoryPosition','inventoryPositions',
          'inventoryPositionCount','nextInventoryOffset','domain','customerAnalysis','customerJourney','previousPeriod')
    out={k:value[k] for k in keys if k in value}
    for key in ('totals',):
        if key in value:out[key]=metrics(value[key])
    for key in ('weeklyTotals','productChannelAggregates','channelAggregates'):
        if key in value:out[key]=[metrics(row) for row in value[key]]
    q=value.get('queryEvidence',{})
    out['queryEvidence']={k:q[k] for k in ('method','scope','matchingFactIdsHash','factCount') if k in q}
    out['projectionNote']='汇总和所有周保留完整业务数值及缺失状态；商品渠道和库存页保留全部本页记录与下一页偏移。行级审计和重复统计字段保存在原始查询记录，不作为新增经营事实。'
    return out

def deduplicate_home_view(value, section, seen):
    """Identical aggregates remain in the first successful tool message.

    Only byte-equivalent business blocks receive references. Query traces keep
    every original value and source ID; distinct period/channel results remain.
    """
    out=dict(value)
    for key in ('totals','weeklyTotals','productChannelAggregates'):
        if key not in value:continue
        identity=(key,json.dumps(value[key],sort_keys=True,ensure_ascii=False))
        prior=seen.get(identity)
        if prior and prior!=section:
            out[key]={'sameAsSection':prior,'sameField':key,'note':'与上面成功查询的这一字段完全相同；沿用全部数值和缺失状态。'}
        else:seen[identity]=section
    return out

def home_context_view(context, basis):
    """Prompt gets saved conclusions/totals; immutable envelope keeps detail."""
    keys = ('id', 'title', 'snapshotId', 'businessId', 'dataNature', 'asOf', 'inputHash',
            'calculationVersion', 'totals', 'weeks', 'products', 'forecastCoverage',
            'backtest', 'backtestAvailability', 'limitations', 'evidenceIds')
    def forecast_view(value):
        out = {k: value[k] for k in keys if k in value}
        backtest=value.get('backtest', {})
        if backtest:
            out['backtest']={k:backtest[k] for k in ('status','weeks','wape','methodVersion','timeAware','timezone','coverageBasis','labelKnownAt') if k in backtest}
            if 'skippedFolds' in backtest:
                out['backtest']['skippedFoldCount']=len(backtest['skippedFolds'])
                out['backtest']['skippedReasons']=list(dict.fromkeys(f.get('reason','原因待核') for f in backtest['skippedFolds']))
        return out
    def archive_view(value):
        # The home baseline below retains all forecast weeks/products. Older
        # versions need totals/coverage for context, not repeated row citations.
        out = {k:v for k,v in forecast_view(value).items() if k not in ('weeks','products','evidenceIds')}
        backtest=value.get('backtest', {})
        out['backtest']={k:backtest[k] for k in ('status','weeks','wape','methodVersion','timeAware','timezone','coverageBasis','labelKnownAt') if k in backtest}
        if 'skippedFolds' in backtest:
            out['backtest']['skippedFoldCount']=len(backtest['skippedFolds'])
            out['backtest']['skippedReasons']=list(dict.fromkeys(f.get('reason','原因待核') for f in backtest['skippedFolds']))
        return out
    result = {**context}
    relevant_sources=set()
    def collect_references(value):
        if isinstance(value,dict):
            relevant_sources.update(value.get('evidenceIds',[]) if isinstance(value.get('evidenceIds'),list) else [])
            if value.get('selected') and value.get('id'):relevant_sources.add(value['id'])
            for child in value.values():collect_references(child)
        elif isinstance(value,list):
            for child in value:collect_references(child)
    collect_references(context.get('findings',[]))
    # Preserve every source reference and its time/status. Full scraped pages
    # stay in the immutable envelope and evidence store, not every model turn.
    result['marketEvidence']=[]
    for r in context.get('marketEvidence',[]):
        source={k:r[k] for k in ('id','url','title','publishedAt','retrievedAt','verificationStatus','historicalEligible') if k in r}
        excerpt=r.get('excerpt') or ''
        # Professional reviews already select and cite the relevant sources.
        # Keep the complete source index; unrelated archive excerpts need not
        # be repeated in full at every homepage model turn.
        limit=450 if r.get('id') in relevant_sources else 120
        source.update(excerpt=excerpt[:limit],modelExcerptIsPartial=len(excerpt)>limit,modelExcerptLimit=limit,limitations=r.get('limitations',[]))
        result['marketEvidence'].append(source)
    result['findings']=[{**{k:r[k] for k in ('id','mode','createdAt') if k in r},'finding':{k:v for k,v in r.get('finding',{}).items() if k in ('conclusion','evidenceIds','alternatives','gaps','candidates','homeDecision','businessReview','marketWorkbench')}} for r in context.get('findings',[])]
    for row in result['findings']:
        workbench=row['finding'].get('marketWorkbench')
        if workbench:
            row['finding']['marketWorkbench']={k:workbench[k] for k in ('judgment','signals','nextStep') if k in workbench}
            row['finding']['marketWorkbench']['sources']=[source for source in workbench.get('sources',[]) if source.get('selected')]
    result['projectionNote']='保留全部市场来源及核验时间、全部保存结果的关键数值和反证。专业审查引用或AI选中的原文保留最多450字摘要，其他历史来源保留120字索引摘要；超出时明确标为部分摘要，不代表已读完整原文。完整原文、逐窗回测、逐日结果及全部调查详情保存在原始证据中，摘要不能替代原文核验。'
    result['forecasts'] = [archive_view(f) for f in context.get('forecasts', [])]
    result['scenarios'] = [{**archive_view(f), **{k: f[k] for k in ('parentId', 'delta', 'assumptions') if k in f}} for f in context.get('scenarios', [])]
    result['decisions'] = [{**d, 'selectedScenario':
        {**archive_view(d['selectedScenario']), **{k:d['selectedScenario'][k] for k in ('parentId', 'delta', 'assumptions') if k in d['selectedScenario']}}
        if d.get('selectedScenario') else None} for d in context.get('decisions', [])]
    result['homeDecisionContext'] = {**basis, 'forecast': forecast_view(basis['forecast']) if basis.get('forecast') else None}
    return result

def validate_home_decision(finding, known, env, read_sections, knowledge_rules):
    home = finding.homeDecision
    if not home:
        raise ValueError('首页任务必须输出homeDecision，不能以普通回复或占位内容替代')
    if read_sections != {'conversion', 'supply', 'market'}:
        raise ValueError('首页判断必须先核查人、货、场的完整当前范围')
    data = catalog()
    basis = env.get('homeDecisionContext', {})
    if (home.knowledgeVersion != data['version'] or basis.get('knowledgeDigest') != data['digest']
            or any(rule not in knowledge_rules for rule in home.knowledgeRuleIds)):
        raise ValueError('首页判断引用了未读取或已变化的行业知识版本')
    forecast = basis.get('forecast')
    if home.outlook.forecastId != (forecast['id'] if forecast else None):
        raise ValueError('首页预测结论必须引用本次固定的预测基线')
    if re.search(r'[0-9零一二三四五六七八九十百千万亿两]',home.outlook.title+home.outlook.summary):
        raise ValueError('预测期间、数量和金额由保存基线自动展示；outlook只解释经营含义，不写数字或产品型号')
    if any(ident not in known for ident in home.outlook.evidenceIds):
        raise ValueError('首页预测解释引用了未实际读取的经营证据')
    blocks = [home.judgment, home.action, home.sections.conversion, home.sections.supply, home.sections.market]
    if any(ident not in known for block in blocks for ident in block.evidenceIds):
        raise ValueError('首页判断或建议引用了未实际读取的经营证据')
    if any(len(step) > 80 for step in home.action.steps):
        raise ValueError('首页建议步骤须短于80字')
    joint=home.jointReview
    if basis.get('schemaVersion') == 'home-decision-v3' and joint is None:
        raise ValueError('本轮必须输出homeDecision.jointReview（嵌套在homeDecision内，不是顶层jointReview）：经营状况、决策确认点与优先动作；保留已核实的内容并补齐此对象，不能删除联合研判')
    if joint:
        blocks=[joint.status,joint.market,joint.nextAction,*joint.confirmations]
        if any(ident not in known for block in blocks for ident in block.evidenceIds):
            raise ValueError('联合研判引用了未实际读取的证据')
        sources={r['id']:r for r in env.get('decisionContext',{}).get('marketEvidence',[])}
        invalid=[ident for ident in joint.market.evidenceIds if ident not in sources or sources[ident].get('verificationStatus')!='source_read']
        if invalid:
            allowed=[ident for ident,r in sources.items() if r.get('verificationStatus')=='source_read' and ident in known]
            raise ValueError('homeDecision.jointReview.market.evidenceIds 的市场判断必须引用已读取原文的市场来源；'
                +'这些引用是内部指标或未读取来源，请替换：'+json.dumps(invalid,ensure_ascii=False)
                +'；本轮已读市场原文ID：'+json.dumps(allowed,ensure_ascii=False)
                +'。仅选择实际支持该句的原文；无支持原文时改写为资料缺口并使用空数组，不可复制指标引用。')
        if any(len(step)>80 for step in joint.nextAction.steps):
            raise ValueError('联合研判行动步骤须短于80字')
        if len(set(joint.metricKeys)) != len(joint.metricKeys):
            raise ValueError('联合研判的关键指标不能重复')
    if finding.organization or finding.proposedAssumptions or finding.followups:
        raise ValueError('首页只给判断与建议，不自动改条件、创建方案或发起额外任务')
