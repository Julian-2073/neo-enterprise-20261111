import type {Fact, StoredFact} from '../contracts.ts';
export const materialKinds = ['roles','products','skus','channels','warehouses','customers','customer_identities','arrivals','supply_rules'] as const;
export type MaterialKind = typeof materialKinds[number];
export const isMaterialKind = (kind: string): kind is MaterialKind => (materialKinds as readonly string[]).includes(kind);
export type MaterialRow = StoredFact & {kind: MaterialKind; fact: Fact; availableAt: string};
export type FrozenObject = Record<string, unknown> & {id:string;factId:string;batchId:string;row:number;effectiveFrom:string;effectiveTo:string|null;availableAt:string};
export type FrozenDomain = {
 products:FrozenObject[];skus:FrozenObject[];roles:FrozenObject[];channels:FrozenObject[];warehouses:FrozenObject[];
 customers:FrozenObject[];customerIdentities:FrozenObject[];arrivals:FrozenObject[];supplyRules:FrozenObject[];
};
export type CustomerFunnelRule = {cohortStage:'A1'|'A2'|'A3';conversionWindowDays:number;channelPolicy:'same_channel'|'any'};
export type MaterialsProjection = {
 version:'operating-materials-v1';dataProvenance:'SYNTHETIC_DEMO'|'BUSINESS_UNVERIFIED';knownAt:string;availability:'system_recorded';domain:FrozenDomain;
 customerAnalysis:{status:'ready'|'partial'|'unconfigured';stageCustomerCounts:Record<string,number|null>;unidentifiedRecords:number;
  rule:CustomerFunnelRule|null;cohortCustomers:number|null;matureCustomers:number|null;convertedCustomers:number|null;conversionRate:number|null;immatureCustomers:number|null;limitations:string[]};
 supply:{ruleStatus:'configured'|'unconfigured';roles:Array<{roleId:string;skuCount:number;observedSkuCount:number;qualifiedSkuCount:number|null;qualifiedRatio:number|null;targetRatio:number|null;currentInventoryCostCents:number|null;weekly:Array<{start:string;observedSkuCount:number;qualifiedSkuCount:number|null;qualifiedRatio:number|null}>}>;
  products:Array<{productId:string;netQuantity:number|null;sellableUnits:number|null;inTransitUnits:number|null;inventoryCostCents:number|null;earliestArrival:string|null;plannedArrivalUnits:number|null;remainingArrivalUnits:number|null}>;limitations:string[]};
 quality:{missingFields:string[];unresolvedReferences:number};customerLinks:Array<{factId:string;customerId:string|null;linkedOrderId:string|null;linkedOrderLineId:string|null}>;sourceFactIds:string[];
};
