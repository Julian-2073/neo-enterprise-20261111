export type ResultScope={businessId:string;dataNature:string;snapshotId:string;ontologyRef?:{buildId:string}|null};
export function sameResultScope(a:ResultScope,b:ResultScope){return a.businessId===b.businessId&&a.dataNature===b.dataNature&&a.snapshotId===b.snapshotId&&(a.ontologyRef?.buildId??null)===(b.ontologyRef?.buildId??null);}
export type CalculationIdentity={calculationVersion?:unknown;inputHash?:unknown};
export function sameCalculation(a:CalculationIdentity,b:CalculationIdentity){return typeof a.calculationVersion==='string'&&!!a.calculationVersion&&a.calculationVersion===b.calculationVersion&&typeof a.inputHash==='string'&&!!a.inputHash&&a.inputHash===b.inputHash;}
export function scenarioBelongsToBaseline(s:ResultScope&CalculationIdentity&{parentId:string|null},b:ResultScope&CalculationIdentity&{id:string}|null){return !!b&&s.parentId===b.id&&sameResultScope(s,b)&&sameCalculation(s,b);}
