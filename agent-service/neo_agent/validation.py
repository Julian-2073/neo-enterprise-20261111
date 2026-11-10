"""Code-level numeric grounding; semantic support is a later validation layer."""
import re
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

def percentage_values(value):
    """Unrounded percentage-point values from registered ratio fields only."""
    values=set()
    def visit(v,key='',journey_change=False):
        if type(v) in (int,float):
            ratio_field=bool(re.search(r'(?:^|_)(?:rate|ratio)$',key,re.I)) or key.endswith(('Rate','Ratio')) or key=='relativeChange'
            if ratio_field or key=='change' and journey_change:
                number=Decimal(str(v))
                if number.is_finite():values.add(number*100)
        elif isinstance(v,dict):
            # CustomerJourney.changes.change is a relative change, unlike
            # absolute difference/count fields elsewhere in the diagnostics.
            relative=v.get('stage') in ('A1','A2','A3','A4') and all(type(v.get(k)) in (int,float) for k in ('current','previous','change')) and v['previous']>0
            for k,x in v.items():visit(x,k,relative)
        elif isinstance(v,list):
            for x in v:visit(x,key)
    visit(value);return values

class NumericGrounding(set):
    """Keep ratio units when combining numeric context and frozen tool reads."""
    def __init__(self,values=(),percentage_basis=()):
        super().__init__(values);self.percentage_basis=set(percentage_basis)
    def update(self,*values):
        for value in values:
            super().update(value)
            self.percentage_basis.update(getattr(value,'percentage_basis',()))

def numeric_values(value):
    values=set()
    def visit(v,key=''):
        if type(v) in (int,float):
            values.add(Decimal(str(v)))
            if key.endswith('Cents') or key.endswith('_cents'):values.add(Decimal(str(round(v/100,2))))
            if 'rate' in key.lower() or 'ratio' in key.lower():values.add(Decimal(str(round(v*100,2))))
        elif isinstance(v,dict):
            for k,x in v.items():visit(x,k)
        elif isinstance(v,list):
            for x in v:visit(x,key)
    visit(value);return NumericGrounding(values,percentage_values(value))

_CN_DIGITS={c:n for n,chars in enumerate(('零〇','一壹','二两贰','三叁','四肆','五伍','六陆','七柒','八捌','九玖')) for c in chars}
_CN_SMALL={'十':10,'拾':10,'百':100,'佰':100,'千':1000,'仟':1000}
_CN_LARGE={'万':10000,'亿':100000000}
_NUMERAL=r'[0-9零〇一二两三四五六七八九十百千壹贰叁肆伍陆柒捌玖拾佰仟][0-9,零〇一二两三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖拾佰仟]*'
_QUANTITY=re.compile(r'((?:负|-)?'+_NUMERAL+r'(?:[.点]'+_NUMERAL+r')?)(元|件|人|笔|次|房晚|公斤|吨|台|套|间|个|条|天|日|周|月|年|%)')

def quantity_value(raw):
    """Normalize literal quantities only; metric/source support remains separate."""
    negative=raw.startswith(('负','-'));raw=raw.lstrip('负-').replace(',','')
    def integer(text):
        if text.isdigit():return Decimal(text)
        total=Decimal(0);section=Decimal(0);number=None
        for token in re.findall(r'\d+|.',text):
            if token.isdigit():number=Decimal(token)
            elif token in _CN_DIGITS:number=Decimal(_CN_DIGITS[token]) if number is None else number*10+_CN_DIGITS[token]
            elif token in _CN_SMALL:section+=(number if number is not None else 1)*_CN_SMALL[token];number=None
            elif token in _CN_LARGE:
                explicit=number is not None or section!=0
                section+=number if number is not None else 0
                if token=='亿':total=(total+section)*_CN_LARGE[token]
                else:total+=(section if explicit else 1)*_CN_LARGE[token]
                section=Decimal(0);number=None
            else:raise ValueError('不支持的数量表达：'+raw)
        return total+section+(number if number is not None else 0)
    parts=re.split(r'[.点]',raw)
    if len(parts)==1:value=integer(raw)
    elif len(parts)==2:
        fraction=parts[1];scales=re.search(r'[百千万亿]+$',fraction);factor=integer('一'+scales.group()) if scales else 1
        if scales:fraction=fraction[:scales.start()]
        digits=''.join(str(_CN_DIGITS[c]) if c in _CN_DIGITS else c for c in fraction)
        if not digits.isdigit():raise ValueError('不支持的数量表达：'+raw)
        value=(integer(parts[0])+Decimal('0.'+digits))*factor
    else:raise ValueError('不支持的数量表达：'+raw)
    return -value if negative else value

def validate_numeric_prose(finding,allowed,domain,*,percentage_grounding=None):
    errors=[]
    percentages=getattr(allowed,'percentage_basis',()) if percentage_grounding is None else percentage_grounding
    def rounded_percentage(value,ratio=False):
        # Use the displayed literal's precision, never an epsilon or a twice-
        # rounded rate. Only percentages and registered bare decimal ratios
        # qualify; money and counts still require their original exact values.
        quantum=Decimal(1).scaleb(min(0,value.as_tuple().exponent))
        for source in percentages:
            try:
                if ratio:source=source/100
                if source.is_finite() and source.quantize(quantum,rounding=ROUND_HALF_UP)==value:return True
            except InvalidOperation:continue
        return False
    texts=[]
    prose_keys={'conclusion','alternatives','gaps','candidates','title','summary','steps','headline','reason','why','check','whyFirst','decisionGate','nextChecks','rationale','nextVerification','assessment','explanation'}
    def collect(value,key=None):
        if isinstance(value,str) and key in prose_keys:texts.append(value)
        elif isinstance(value,dict):
            for k,v in value.items():collect(v,k)
        elif isinstance(value,list):
            for v in value:collect(v,key)
    collect(finding)
    for text in texts:
        for rows in domain.values():
            if isinstance(rows,list):
                for row in rows:
                    if isinstance(row,dict) and row.get('name'):text=text.replace(row['name'],'商品或渠道')
        text=re.sub(r'\b[Aa][1-5]\b','',text)
        def calendar_literal(match):
            # Dates are checked for scope/meaning by claim support, not as
            # business quantities. Do not swallow ratios followed by a unit.
            parts=re.split(r'[-/年月]',match.group().rstrip('日月'))
            if match.group().endswith('月'):parts=[*parts,'1']
            try:date(*(map(int,parts) if len(parts)==3 else (2000,*map(int,parts))))
            except ValueError:return match.group()
            return ' '
        def calendar_range_literal(match):
            try:
                first=date(int(match.group(1) or 2000),int(match.group(2)),int(match.group(3)))
                second=date(int(match.group(4) or first.year),int(match.group(5)),int(match.group(6)))
                if second<first and match.group(4) is None:
                    second=date(first.year+1,second.month,second.day)
            except ValueError:return match.group()
            return ' '
        # Remove a complete calendar range before removing its individual
        # endpoints. Otherwise ``8/24-9/20`` becomes ``-9/20`` and the bare
        # number pass incorrectly reports ``-9`` as an ungrounded metric.
        md=r'(?:0?[1-9]|1[0-2])';day=r'(?:0?[1-9]|[12]\d|3[01])'
        text=re.sub(r'(?<![A-Za-z\d./-])(?:(\d{4})[-/])?('+md+r')[-/]('+day+r')\s*(?:至|到|—|–|~|～|-)\s*(?:(\d{4})[-/])?('+md+r')[-/]('+day+r')(?![\d元件人笔次房公吨台套间%])',calendar_range_literal,text)
        text=re.sub(r'(?<![A-Za-z\d./-])(?:\d{4}[-/])?(?:0?[1-9]|1[0-2])[-/](?:0?[1-9]|[12]\d|3[01])(?![\d元件人笔次房公吨台套间%])',calendar_literal,text)
        text=re.sub(r'(?<![A-Za-z\d])(?:\d{4}年)?(?:0?[1-9]|1[0-2])月(?:0?[1-9]|[12]\d|3[01])日(?![\d元件人笔次房公吨台套间%])',calendar_literal,text)
        text=re.sub(r'(?<![A-Za-z\d])\d{4}年(?:0?[1-9]|1[0-2])月(?![\d元件人笔次房公吨台套间%])',calendar_literal,text)
        def check_quantity(match):
            value=quantity_value(match.group(1))
            percent=match.group().startswith('百分之') or match.lastindex==2 and match.group(2)=='%'
            if value not in allowed and not (percent and rounded_percentage(value)):errors.append('回答数量（数字）未匹配已读取计算结果：'+match.group())
            return ''
        text=re.sub(r'百分之((?:负|-)?'+_NUMERAL+r'(?:[.点]'+_NUMERAL+r')?)',check_quantity,text)
        text=_QUANTITY.sub(check_quantity,text)
        # A bare scaled amount is still quantitative (e.g. 收益九百万).
        text=re.sub(r'(?:收益|成交|库存|销量|订单|成本|预算|投放|毛利|损失|合计|总计|数量)((?:负|-)?'+_NUMERAL+r'(?:[.点]'+_NUMERAL+r')?[万亿])',check_quantity,text)
        # Product/warehouse identifiers and percentages are formatted values;
        # require each remaining number to exist in a calculated tool result.
        for token in re.findall(r'(?<![A-Za-z\d])[-+]?\d+(?:,\d{3})*(?:\.\d+)?(?![A-Za-z\d])',text):
            value=Decimal(token.replace(',',''))
            # A raw decimal ratio (e.g. relativeChange=0.083333...) may be
            # displayed as 0.0833. Quantities with units were checked above,
            # so this does not permit rounding money/counts or integer IDs.
            if value not in allowed and not ('.' in token and rounded_percentage(value,ratio=True)):errors.append('回答数字未匹配已读取计算结果：'+token)
    if errors:
        # One repair must receive every completed numeric finding, rather than
        # fixing the first number and discovering another only after repair.
        raise ValueError('；'.join(dict.fromkeys(errors)))
