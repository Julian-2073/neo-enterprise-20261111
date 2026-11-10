// A separate business module; the reference source is never modified.
export function operatingHomeLayout(source:string){
 const old='<PeopleSummary openEvidence={openEvidence}/><GoodsSummary openEvidence={openEvidence}/><MarketSummary openEvidence={openEvidence}/>';
 if(source.split(old).length!==2)throw Error('首页业务组件入口已变化，请核对人货场组件');
 return source.replace('"use client";','"use client";\nimport {LiveHomeSections} from "./live-home-sections";').replace(old,'<LiveHomeSections/>');
}
