import {Prototype} from '../../components/neo-demo/prototype';
import {WeeklyActionReport} from '../../components/neo-demo/weekly-report';
export default async function DemoPage({searchParams}:{searchParams:Promise<{page?:string;mode?:string}>}){const q=await searchParams;const mode=q.mode==='example'?'example':'business';if(q.page==='weekly')return <WeeklyActionReport mode={mode}/>;const page=['people','goods','market','overview'].includes(q.page||'')?q.page as 'people'|'goods'|'market'|'overview':'home';return <Prototype page={page} mode={mode}/>;}
