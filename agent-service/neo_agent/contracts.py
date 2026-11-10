from typing import Literal
from datetime import date
from pydantic import BaseModel, Field, ConfigDict, model_validator

class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

class Assumption(Strict):
    source: Literal['user_assumption','historical_estimate','external_reference','synthetic','model_hypothesis'] = 'user_assumption'
    note: str = Field(min_length=1, max_length=1000)
    confirmed: bool = False
    evidenceIds: list[str] = Field(default_factory=list)

class Adjustment(Strict):
    productId: str
    channel: str | None = None
    start: date | None = None
    end: date | None = None
    budgetMultiplier: float = Field(default=1, ge=0, le=10)
    budgetResponse: float | None = Field(default=None, ge=0, le=2)
    conversionMultiplier: float = Field(default=1, gt=0, le=3)
    priceMultiplier: float = Field(default=1, gt=0, le=3)
    priceElasticity: float | None = Field(default=None, ge=-5, le=0)
    mixWeight: float | None = Field(default=None, ge=0, le=1)
    assumption: Assumption
    @model_validator(mode='after')
    def dates(self):
        if self.start and self.end and self.start > self.end: raise ValueError('方案起止日期顺序错误')
        return self

class Arrival(Strict):
    skuId: str
    warehouseId: str
    date: date
    units: int = Field(ge=0, le=1000000)
    replacesPlanId: str | None = None
    assumption: Assumption

class Transfer(Strict):
    skuId: str
    fromWarehouse: str
    toWarehouse: str
    date: date
    units: int = Field(gt=0, le=1000000)
    assumption: Assumption
    @model_validator(mode='after')
    def different(self):
        if self.fromWarehouse == self.toWarehouse: raise ValueError('调拨来源仓与目的仓不能相同')
        return self

class ScenarioAssumptions(Strict):
    adjustments: list[Adjustment] = Field(default_factory=list, max_length=100)
    arrivals: list[Arrival] = Field(default_factory=list, max_length=100)
    transfers: list[Transfer] = Field(default_factory=list, max_length=100)
    extraCostCents: int = Field(default=0, ge=0, le=100000000000)
    extraCostAssumption: Assumption | None = None
    @model_validator(mode='after')
    def cost(self):
        if self.extraCostCents and not self.extraCostAssumption: raise ValueError('额外成本需要注明假设来源')
        return self

class Priority(Strict):
    title: str = Field(min_length=1, max_length=60)
    reason: str = Field(min_length=1, max_length=180)
    evidenceIds: list[str] = Field(min_length=1)
    urgency: Literal['先核查', '持续观察', '待补数据']

class ComparisonNote(Strict):
    scenarioId: str
    assessment: str = Field(min_length=1, max_length=180)

class SavedChoiceNote(Strict):
    decisionId: str
    rationale: str = Field(min_length=1, max_length=180)
    nextVerification: str = Field(min_length=1, max_length=120)

class Organization(Strict):
    headline: str = Field(min_length=1, max_length=60)
    summary: str = Field(min_length=1, max_length=180)
    priorities: list[Priority] = Field(default_factory=list, max_length=3)
    comparisons: list[ComparisonNote] = Field(default_factory=list, max_length=10)
    savedChoices: list[SavedChoiceNote] = Field(default_factory=list, max_length=10)
    nextChecks: list[str] = Field(default_factory=list, max_length=5)


class HomeJudgment(Strict):
    title: str = Field(min_length=1, max_length=36)
    summary: str = Field(min_length=1, max_length=160)
    evidenceIds: list[str] = Field(min_length=1, max_length=8)

class HomeOutlook(Strict):
    forecastId: str | None
    title: str = Field(min_length=1, max_length=36)
    summary: str = Field(min_length=1, max_length=140)
    evidenceIds: list[str] = Field(default_factory=list, max_length=8)

class HomeAction(HomeJudgment):
    steps: list[str] = Field(min_length=1, max_length=3)

class HomeSections(Strict):
    conversion: HomeJudgment
    supply: HomeJudgment
    market: HomeJudgment

class JointConfirmation(Strict):
    question: str = Field(min_length=1, max_length=48)
    why: str = Field(min_length=1, max_length=90)
    check: str = Field(min_length=1, max_length=90)
    evidenceIds: list[str] = Field(default_factory=list, max_length=8)

class JointNextAction(HomeJudgment):
    whyFirst: str = Field(min_length=1, max_length=100)
    decisionGate: str = Field(min_length=1, max_length=100)
    steps: list[str] = Field(min_length=1, max_length=3)

class JointAlternative(Strict):
    action: str = Field(min_length=1, max_length=36)
    whyNotFirst: str = Field(min_length=1, max_length=90)

class JointMarket(Strict):
    summary: str = Field(min_length=1, max_length=120)
    evidenceIds: list[str] = Field(default_factory=list, max_length=8)

class JointReview(Strict):
    status: HomeJudgment
    metricKeys: list[Literal['netRevenue','margin','stock','conversion']] = Field(min_length=1,max_length=3)
    market: JointMarket
    confirmations: list[JointConfirmation] = Field(default_factory=list,max_length=3)
    nextAction: JointNextAction
    alternatives: list[JointAlternative] = Field(min_length=1,max_length=2)

class HomeDecision(Strict):
    jointReview: JointReview | None = None
    judgment: HomeJudgment
    outlook: HomeOutlook
    action: HomeAction
    sections: HomeSections
    knowledgeVersion: str
    knowledgeRuleIds: list[str] = Field(min_length=1, max_length=6)

class MarketSignal(HomeJudgment):
    id: Literal['demand','competition','efficiency']

class MarketCell(Strict):
    channel: str
    role: str
    headline: str = Field(min_length=1,max_length=28)
    summary: str = Field(min_length=1,max_length=100)
    status: Literal['needs_check','observed','unavailable']
    evidenceIds: list[str] = Field(min_length=1,max_length=8)

class MarketSelection(Strict):
    id: str
    selected: bool
    reason: str = Field(min_length=1,max_length=100)
    category: Literal['competition','demand','channel','policy']
    summary: str = Field(min_length=1,max_length=100)
    relevance: str = Field(min_length=1,max_length=100)

class MarketWorkbenchReview(Strict):
    judgment: HomeJudgment
    signals: list[MarketSignal] = Field(min_length=3,max_length=3)
    cells: list[MarketCell] = Field(default_factory=list,max_length=200)
    sources: list[MarketSelection] = Field(default_factory=list,max_length=220)
    nextStep: str = Field(min_length=1,max_length=100)

class OperatingRecommendation(Strict):
    planningId: str
    previewId: str
    direction: str = Field(min_length=1, max_length=80)
    reason: str = Field(min_length=1, max_length=300)
    nextChecks: list[str] = Field(default_factory=list, max_length=5)

class Finding(Strict):
    conclusion: str = Field(min_length=1, max_length=180, description="对话回复：2至3句，直接回答本轮问题；详细论据放其他字段")
    answerIntent: str | None = Field(default=None, min_length=1, max_length=60, description="对本轮问题的简短理解，用于审计而不展开思维链")
    basis: list[str] = Field(default_factory=list, max_length=2, description="支持结论的1至2条关键经营事实")
    nextStep: str | None = Field(default=None, min_length=1, max_length=100, description="最多一个下一步；纯查询时可以为null")
    evidenceIds: list[str]
    alternatives: list[str]
    gaps: list[str]
    candidates: list[str]
    followups: list[Literal['conversion','supply','market']] = Field(default_factory=list)
    proposedAssumptions: ScenarioAssumptions | None = None
    organization: Organization | None = None
    homeDecision: HomeDecision | None = None
    businessReview: HomeJudgment | None = None
    marketWorkbench: MarketWorkbenchReview | None = None
    operatingRecommendation: OperatingRecommendation | None = None

class RunBudget(Strict):
    maxAttempts: int = Field(default=3, ge=1, le=3)
    maxModelCalls: int | None = Field(default=None, ge=1)
    maxTokens: int | None = Field(default=None, ge=1)
    maxToolCalls: int | None = Field(default=None, ge=1)
    maxMarketSearches: int | None = Field(default=None, ge=0)
    completionTokens: int | None = Field(default=None, ge=1)
    timeoutSeconds: float = Field(default=1800, gt=0, le=1800)

class Job(Strict):
    id: str
    businessId: str
    dataNature: Literal['demo','business']
    snapshotId: str
    sessionId: str
    mode: Literal['conversion','supply','market','joint','orchestrator']
    purpose: Literal["analysis","patrol","briefing","weekly","home","review","operating"] = "analysis"
    autoRepeat: bool = False
    question: str = Field(min_length=1,max_length=4000)
    taskType: Literal['QUERY','EXPLAIN','DIAGNOSE','FORECAST','SIMULATE','DECIDE','REVIEW'] | None = None
    envelope: dict
    recoveryFrom: str | None = None
    history: list[dict] = Field(default_factory=list,max_length=20)
    budget: RunBudget | None = None
    @model_validator(mode='after')
    def scope(self):
        from .ontology import expand_ontology
        # Validate the actual frozen scope, never an untrusted outer header.
        # Keep the compact representation in the queue/checkpoint payload.
        s=expand_ontology(self.envelope).get('snapshot',{})
        if (s.get('id'),s.get('businessId'),s.get('dataNature')) != (self.snapshotId,self.businessId,self.dataNature):
            raise ValueError('任务与经营快照范围不一致')
        basis=expand_ontology(self.envelope).get('operatingBasis')
        if basis:
            if basis.get('generationId')!=self.snapshotId or basis.get('asOf')!=s.get('asOf'):
                raise ValueError('经营代次与任务时间范围不一致')
            for key in ('businessId','dataNature'):
                if basis.get(key) is not None and basis[key]!=getattr(self,key):
                    raise ValueError('经营指标与任务企业范围不一致')
            period=basis.get('period',{})
            if period.get('start') and period.get('end') and not (period['start']<=period['end']<=basis['asOf']):
                raise ValueError('经营期间超出冻结时间')
        return self
