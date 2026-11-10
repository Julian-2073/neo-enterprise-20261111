'use client';
import {emphasisParts,businessText} from '../../lib/business-presentation';
import {useFrozenDomain} from './operating-context';
import {scenarioSummary} from '../../lib/scenario-presentation';
import type {ScenarioInput} from '../../server/agent-contracts';
export function BusinessText({text,review=false}:{text:string;review?:boolean}){const domain=useFrozenDomain();const products=domain?.products??[],channels=domain?.channels??[];return <>{emphasisParts(review?businessText(text,products,channels):text).map((part,i)=>part.strong?<strong key={i}>{part.text}</strong>:part.text)}</>;}
export function ScenarioConditions({value}:{value:ScenarioInput}){const products=useFrozenDomain()?.products??[];return <><ul>{scenarioSummary(value,products).map((text,i)=><li key={i}><BusinessText text={text}/></li>)}</ul><details><summary>原始计算参数与来源</summary><pre>{JSON.stringify(value,null,2)}</pre></details></>;}
