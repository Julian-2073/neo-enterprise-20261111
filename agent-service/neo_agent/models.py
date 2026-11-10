"""Versioned assessment document persisted alongside compatible saved outputs."""
from typing import Literal
from pydantic import Field
from .contracts import Strict

ASSESSMENT_VERSION='business-assessment-v1'
RUNTIME_VERSION='neo-runtime-v1'

class AssessmentScope(Strict):
    businessId:str
    dataNature:Literal['demo','business']
    inputId:str
    sourceKind:Literal['snapshot','generation']
    operatingVersion:str
    asOf:str
    researchAsOf:str
    configurationVersion:str
    metricScope:dict|None=None

class BusinessAssessment(Strict):
    version:Literal['business-assessment-v1']=ASSESSMENT_VERSION
    runtimeVersion:Literal['neo-runtime-v1']=RUNTIME_VERSION
    scope:AssessmentScope
    taskType:Literal['QUERY','EXPLAIN','DIAGNOSE','FORECAST','SIMULATE','DECIDE','REVIEW']
    inputHash:str
    metrics:dict=Field(default_factory=dict)
    problems:list[dict]=Field(default_factory=list)
    hypotheses:list[dict]=Field(default_factory=list)
    claims:list[dict]=Field(default_factory=list)
    evidence:list[dict]=Field(default_factory=list)
    confirmations:list[dict]=Field(default_factory=list)
    candidates:list[dict]=Field(default_factory=list)
    priorityAction:dict|None=None
    reviewConditions:list[str]=Field(default_factory=list)
    optimality:Literal['conditional','unavailable']='unavailable'
    projections:dict
    context:dict=Field(default_factory=dict)
