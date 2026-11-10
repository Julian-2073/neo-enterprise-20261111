// Create the business-only layout at the existing integration boundary.
// The reference prototype file and example module are never rewritten.
export function operatingGoodsLayout(source:string){
 const start='{operating&&<Card><details><summary>按仓库与商品规格核查';
 const end='{operating&&<SupplyRuleCard onEvidence={openEvidence}/>}';
 const from=source.indexOf(start),to=source.indexOf(end,from);
 if(from<0||to<from||source.indexOf(start,from+start.length)>=0||source.indexOf(end,to+end.length)>=0)
  throw Error('供应链业务布局结构已变化，请核对待删除的两个组件');
 const trimmed=(source.slice(0,from)+source.slice(to+end.length)).replace('if (page === "goods") return','if (page === "goods" && operating?.snapshot?.operating) return <SupplyOperatingContent onEvidence={openEvidence}/>; if (page === "goods") return');
 const heading='<PageHeading page={page} view={decisionView}/>';
 if(trimmed.split(heading).length!==2)throw Error('供应链页面标题入口已变化');
 return trimmed.replace('"use client";','"use client";\nimport {SupplyPageHeading,SupplyOperatingContent} from "./live-home-sections";').replace(heading,'<SupplyPageHeading/>');
}
