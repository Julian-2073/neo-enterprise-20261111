"""Delivery evaluation signals; kept separate from structural fact validation.

A passing signal is not a claim of causal correctness or globally optimal action.
These targeted rubrics catch known enterprise-unit and priority regressions.
"""
import re

def evaluate_business_review(review:dict,basis:dict)->dict:
 industry=basis['profile']['industry']
 action=review.get('nextAction',{})
 action_text=' '.join(str(action.get(k,'')) for k in ('title','reason','condition'))
 text=' '.join([review.get('headline',''),review.get('explanation',''),action_text,*review.get('limitations',[])])
 findings=[]
 if industry=='hotel' and re.search('仓库|东仓|西仓|商品调拨|物料|BOM',text):
  findings.append('hotel_unit_mismatch')
 unmet=basis.get('metrics',{}).get('forecastUnmet',{}).get('value')
 if isinstance(unmet,(int,float)) and unmet>0 and not re.search('履约|供给|库存|到货|调拨|房晚|房型|物料|产能|补货|收货|备货|合规|安全|政策',action_text):
  findings.append('confirmed_supply_gap_not_prioritized')
 claims=review.get('claims',[])
 if any(c.get('metricKey') not in basis.get('metrics',{}) or basis['metrics'][c['metricKey']].get('value')!=c.get('value') or c.get('value') is None for c in claims):
  findings.append('metric_claim_mismatch')
 return {'rubricVersion':'business-quality-v1','status':'needs_review' if findings else 'passed_targeted_checks','findings':findings,'scope':'行业单位、事实数字和已确认供给缺口优先级；不证明全局最优或因果'}
