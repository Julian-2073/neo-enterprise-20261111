from neo_agent.business_quality import evaluate_business_review

def case(industry='ecommerce'):
 return {'profile':{'industry':industry},'metrics':{'forecastUnmet':{'value':2},'A3Customers':{'value':None}}}

def review(title):
 return {'headline':'经营待承接','explanation':'已确认供给存在缺口。','claims':[{'metricKey':'forecastUnmet','value':2}],'nextAction':{'title':title,'reason':'先确认决定条件','condition':'确认后再比较方案'}}

def test_priority_rubric_distinguishes_optional_data_from_known_constraint():
 assert evaluate_business_review(review('补齐客户阶段资料'),case())['findings']==['confirmed_supply_gap_not_prioritized']
 assert evaluate_business_review(review('确认可履约仓和到货条件'),case())['status']=='passed_targeted_checks'
 assert evaluate_business_review(review('先核实器材安全合规'),case())['status']=='passed_targeted_checks'

def test_industry_units_and_unknown_claims():
 assert 'hotel_unit_mismatch' in evaluate_business_review(review('核实东仓库存'),case('hotel'))['findings']
 assert evaluate_business_review(review('确认房型可售房晚'),case('hotel'))['status']=='passed_targeted_checks'
 bad=review('确认物料与产能');bad['claims']=[{'metricKey':'A3Customers','value':0}]
 assert evaluate_business_review(bad,case('manufacturing'))['findings']==['metric_claim_mismatch']
