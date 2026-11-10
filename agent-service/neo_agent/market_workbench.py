"""The model selects sources and writes every market workbench judgment."""
import json,re

def check_metric_directions(text, row):
    """Reject explicit trend claims that contradict the computed comparison."""
    terms={'意向':'intent','意向行为':'intent','订单':'paidOrders','支付订单':'paidOrders','净成交':'netRevenueCents','净成交额':'netRevenueCents','投放费用':'spendCents','每笔订单投放费用':'costPerOrderCents'}
    token='(?:'+ '|'.join(sorted(terms,key=len,reverse=True))+')'
    pattern=re.compile('('+token+'(?:(?:与|和|、|及)'+token+')*)'+r'(?:均|都|数|笔数|小幅|明显|继续|有所|呈现|保持|基本|为|仍){0,4}(增长|增加|上升|走高|下降|回落|减少|降低|持平|稳定)')
    for match in pattern.finditer(text):
        trend=match[2]
        for name in re.findall(token,match[1]):
            key=terms[name];change_key={'netRevenueCents':'netRevenue','spendCents':'spend','costPerOrderCents':'costPerOrder'}.get(key,key)
            delta=row.get('changes',{}).get(change_key)
            if delta is None:continue
            sign=0 if abs(delta)<1e-9 else (1 if delta>0 else -1)
            claimed=0 if trend in ('持平','稳定') else (-1 if trend in ('下降','回落','减少','降低') else 1)
            if sign!=claimed:
                def value(period):
                    values=row.get(period) or {};return values.get(key,values.get(key.replace('Cents','Yuan')))
                before=value('previous');after=value('current')
                raise ValueError(f'经营变化方向错误：{row.get("name",row.get("channel",""))}/{row.get("roleName","")}的{name}前期{before}、本期{after}，请依据这两个值纠正“{match[0]}”，其他指标分别按各自变化解释')

def citation_view(value, aliases):
    """Short exact aliases for model input; persisted IDs remain untouched."""
    reverse={original:short for short,original in aliases.items()}
    if isinstance(value,str):return reverse.get(value,value)
    if isinstance(value,list):return [citation_view(v,aliases) for v in value]
    if isinstance(value,dict):return {k:citation_view(v,aliases) for k,v in value.items()}
    return value

def restore_citations(raw, aliases, source_labels=None):
    try:value=json.loads(raw)
    except (json.JSONDecodeError,TypeError):return raw
    source_labels=source_labels or {}
    def restore(item):
        if isinstance(item,list):
            for child in item:restore(child)
        elif isinstance(item,dict):
            if isinstance(item.get('evidenceIds'),list):
                item['evidenceIds']=[aliases.get(x,x) if isinstance(x,str) else x for x in item['evidenceIds']]
            if isinstance(item.get('sources'),list):
                for source in item['sources']:
                    if isinstance(source,dict):
                        if isinstance(source.get('id'),str):source['id']=aliases.get(source['id'],source['id'])
                        for key in ('reason','summary','relevance'):
                            if isinstance(source.get(key),str):source[key]=re.sub(r'(?<![A-Za-z0-9])E\d{3,}(?![A-Za-z0-9])',lambda match:source_labels.get(match[0],match[0]),source[key])
            for child in item.values():restore(child)
    restore(value)
    return json.dumps(value,ensure_ascii=False)
INSTRUCTIONS='''本任务同时生成渠道与竞品工作台。read_business的marketWorkbenchBasis是后台已经计算的渠道货盘对比与已保存原文候选；筛选、归类、分析和输出都由你完成，不照抄规则提示。marketWorkbench必须输出：judgment一句整体判断；signals恰好demand/competition/efficiency三项，各有短title、一句summary、evidenceIds；cells覆盖工具中每个channel/role组合，给一句headline、一句summary及status；sources覆盖工具中的每个原文候选和本轮检索结果，重复页面也要逐ID输出selected=false和理由，不能直接省略。每条reason约25字、summary约40字、relevance约30字，以保证全部来源能完整输出。按实际内容给selected、reason、category（competition竞品、demand需求、channel渠道、policy政策标准）、短summary和relevance，排除无关主页、广告导航、错误页与没有正文的来源；不要因为提到行业词就选。来源无明确竞品动作时competition说资料不足，不把器材指南称为竞品促销。三张卡片的已计算变化见basis.signals，title和summary的总体上升/下降必须与delta符号一致，不要自行汇总或忽略。unallocatedRoleSpendCents分别给出各渠道未归属货盘的费用，0表示已全部归属，不要说未归属商品。不写未核实的最大降幅、最差等排名。数字和百分比只能引用后台signals/current/previous/changes，不手算或输出虚构百分比；涉及费用交代未归属商品的限制。costPerOrder是每笔支付订单对应投放费用，不能称获客成本、CAC或ROI；订单不是新客户。意向行为只用“次”，支付订单只用“笔”，不能写“意向与订单均为两笔”。渠道订单是否持平必须看basis.channels.current/previous，不能把某个货盘的订单持平扩展到整个渠道。cells只覆盖basis.cells，basis.channels是渠道总量，不能作为额外矩阵格子。不要添加cellsOverflow、sourcesOverflow等字段。没有对照时说明缺项。当前原文不能解释历史经营因果。nextStep只给一项具体核查。本任务工具使用E开头的短引用编号，后台会无损还原到企业和资料版本的完整ID；复制短编号，不拼接或补写任何前缀。引用ID必须复制工具；cells引用自身evidenceId。sources.id复制原文id。业务文案不含技术字段名、来源堆砌或长免责声明。sources.summary用自己的话提炼，不抄网页段落。政策和国家标准原文归policy，不算竞品来源数量。仅有净成交额和订单笔数不能判断价格或单价变化，退款、件数与货盘组合尚未分解；用“订单持平、净成交下降”，不要写“量稳价降”。不得用“全面走强”概括存在回落的货盘，要指出具体增长与回落项。整体judgment必须先说本企业经营对比中最值得关注的渠道或货盘差异，再用外部资料补充背景，不能只汇报找到了哪些文章。demand与efficiency的evidenceIds必须分别包含basis.signalEvidenceIds里对应的编号，引用其他渠道或外部原文不能替代这个编号。demand判断先解释内部意向变化，再交代外部需求资料缺口；efficiency先解释每笔订单投放费用变化及主要渠道差异，不需要外部文章来证明已经记录的费用。内部记录与外部原文分开引用，资料缺口不应掩盖已有经营事实。短引用编号只能写在evidenceIds与sources.id，正文、缺口和建议不出现E编号。原文候选按最近保存的12条分页，本轮仅判断已返回候选；模型看到的正文最多1500字符片段，完整原文保存在后台。片段不足以支持的内容不能推测，有疑问要排除或明确范围。judgment必须是title/summary/evidenceIds对象；cells.channel和role逐字复制工具中的ID，不能用显示名；sources覆盖保存候选与本轮检索新来源的所有ID。'''

# Keep presentation copy brief; complete numeric comparisons remain in backend fields.
INSTRUCTIONS+='工作台首屏文案必须精简：judgment.title尽量18字以内，summary只写一项经营重点与一项外部背景、70字以内；signals.title尽量12字以内、summary35字以内。cells.headline尽量14字以内，省略已在列头显示的货盘名称，直接说变化如“订单持平，净成交下降”；cells.summary只解释核查重点、45字以内，后台会单独展示当前数字和前期变化，不要在句子里逐项重复所有金额与数量。sources.summary尽量30字以内，relevance尽量25字以内，nextStep只写一项可行动的核查、40字以内。精简不能删掉资料不足、口径差异或关键方向。完整依据、其他解释与限制放finding相应字段，不堆进首屏文案。'

def validate_market_workbench(finding,basis,evidence,known):
    review=finding.marketWorkbench
    if not basis:
        if review:raise ValueError('本任务没有渠道工作台输入')
        return
    if not review:raise ValueError('工作台必须输出marketWorkbench')
    expected={(c['channel'],c['role']) for c in basis['cells']}
    actual=[(c.channel,c.role) for c in review.cells]
    if set(actual)!=expected or len(actual)!=len(expected):raise ValueError('渠道货盘分析必须逐格覆盖，不能遗漏或自造')
    if {s.id for s in review.signals}!={'demand','competition','efficiency'} or len(review.signals)!=3:raise ValueError('三类判断必须完整')
    sources={e['id']:e for e in basis.get('sourceCandidates',[])+evidence}
    if len({x.id for x in review.sources})!=len(review.sources) or {x.id for x in review.sources}!=set(sources):
        actual={x.id for x in review.sources}
        missing=[{'id':x,'title':sources[x].get('title','原文候选')} for x in sorted(set(sources)-actual)]
        raise ValueError('原文筛选须逐条给出理由；重复来源也要逐ID输出排除理由。缺少：'+json.dumps(missing,ensure_ascii=False)+'；多出：'+json.dumps(sorted(actual-set(sources)),ensure_ascii=False))
    internal={x['evidenceId'] for x in basis.get('cells',[])+basis.get('channels',[])}
    if not internal.intersection(review.judgment.evidenceIds):raise ValueError('整体判断须分析本企业渠道或货盘对比，并引用相应内部证据')
    for signal in review.signals:
        own=next((x for x in basis.get('evidenceIds',[]) if x.endswith(':view:market-'+signal.id)),None)
        if own and own not in signal.evidenceIds:raise ValueError('需求与效率判断须引用本企业对应的前后期计算，外部资料缺口不能替代经营分析')
    for metric in basis.get('signals',[]):
        delta=metric.get('delta')
        if delta is None or delta==0:continue
        signal=next(x for x in review.signals if x.id==metric['id'])
        wrong=(delta>0 and re.search('下降|回落|降低|减少',signal.title)) or (delta<0 and re.search('上升|增长|增加|升高',signal.title))
        if wrong:raise ValueError(f"{metric['name']}总体变化为{metric['value']}，标题和整体解释必须保持这个方向，请纠正：{signal.title}；其他渠道分项方向按各自计算保留")
    semantic_errors=[]
    for cell in review.cells:
        row=next(x for x in basis['cells'] if (x['channel'],x['role'])==(cell.channel,cell.role))
        if re.search(r'意向(?:行为)?(?:与|和|及)订单[^。；，]{0,10}笔|意向(?:行为)?(?:为|共|合计)?\s*\d+(?:\.\d+)?\s*笔',cell.summary):
            current=row.get('current',{})
            semantic_errors.append('意向行为按次、支付订单按笔，不能共用笔。修改'+cell.channel+'/'+cell.role+'的summary：'+cell.summary+'。两项分开写；本期意向'+str(current.get('intent','未知'))+'次，支付订单'+str(current.get('paidOrders','未知'))+'笔。')
    efficiency=next(x for x in review.signals if x.id=='efficiency')
    for cell in review.cells:
        row=next(x for x in basis['cells'] if (x['channel'],x['role'])==(cell.channel,cell.role))
        try:check_metric_directions(cell.headline+'。'+cell.summary,row)
        except ValueError as e:semantic_errors.append(str(e))
    for channel in basis.get('channels',[]):
        name=re.sub('模拟|旗舰|店铺|店|内容','',channel.get('name',''))
        if not name:continue
        prose=[review.judgment.title,review.judgment.summary,*[v for x in review.signals for v in (x.title,x.summary)]]
        for paragraph in prose:
            for clause in re.split('[，,。；;]',paragraph):
                if name in clause:
                    fragment=clause[clause.index(name):]
                    for other in basis.get('channels',[]):
                        other_name=re.sub('模拟|旗舰|店铺|店|内容','',other.get('name',''))
                        if other_name and other_name!=name and other_name in fragment:fragment=fragment[:fragment.index(other_name)]
                    try:check_metric_directions(fragment,channel)
                    except ValueError as e:semantic_errors.append(str(e))
    if semantic_errors:raise ValueError('以下经营表述必须全部纠正，保留其他已正确内容：'+json.dumps(list(dict.fromkeys(semantic_errors)),ensure_ascii=False))
    for channel in basis.get('channels',[]):
        delta=channel.get('changes',{}).get('paidOrders')
        if delta is None or abs(delta)<1e-9:continue
        name=re.sub('模拟|旗舰|店铺|店|内容','',channel.get('name',''))
        if name and re.search(re.escape(name)+r'[^。；，]{0,14}订单持平',efficiency.summary):
            raise ValueError(f"渠道{name}订单并非持平：{channel['previous']['paidOrders']}笔到{channel['current']['paidOrders']}笔；某个货盘持平不能扩展到渠道。请纠正：{efficiency.summary}")
    unsupported=[x.headline for x in review.cells if re.search('量稳价降|量增价降|单价下降|降价|价格下降',x.headline) and not re.search('待核|待查|可能',x.headline)]
    if unsupported:raise ValueError('只读到订单笔数和净成交，不能证明降价。请改为订单与金额变化：'+json.dumps(unsupported,ensure_ascii=False))
    if '全面' in review.judgment.title:raise ValueError('整体标题请指出具体增长或回落的渠道货盘，避免用全面概括不同方向：'+review.judgment.title)
    rankings=[x.summary for x in review.cells if '最大降幅' in x.summary or '最差' in x.summary]
    if rankings:raise ValueError('删除没有按明确指标核实的排名说法，保留数字与变化：'+json.dumps(rankings,ensure_ascii=False))
    text=[finding.conclusion,*finding.alternatives,*finding.gaps,*finding.candidates,review.judgment.title,review.judgment.summary,review.nextStep]
    text += [v for x in review.signals for v in (x.title,x.summary)]
    text += [v for x in review.cells for v in (x.headline,x.summary)]
    text += [v for x in review.sources for v in (x.reason,x.summary,x.relevance)]
    offending=[x for x in text if re.search(r'(?<![A-Za-z0-9])E\d{3,}(?![A-Za-z0-9])',x)]
    if offending:raise ValueError('短引用编号只放在引用字段。以下经营文案删除编号或改成来源名称，保留实际内容：'+json.dumps(offending,ensure_ascii=False)[:1200])
    selected={x.id for x in review.sources if x.selected}
    if any(sources[x].get('verificationStatus')!='source_read' for x in selected):raise ValueError('未读取原文不能入选')
    unread={x for x,e in sources.items() if e.get('verificationStatus')!='source_read'}
    for item in [review.judgment,*review.signals,*review.cells]:
        if not item.evidenceIds or any(x not in known or x in unread for x in item.evidenceIds):raise ValueError('工作台判断必须引用实际读取且可用的证据')
    for c in review.cells:
        ref=next(x['evidenceId'] for x in basis['cells'] if (x['channel'],x['role'])==(c.channel,c.role))
        if ref not in c.evidenceIds:raise ValueError('矩阵判断须引用对应渠道与货盘证据')
