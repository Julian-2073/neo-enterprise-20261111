'use client';
import {Prototype as OriginalPrototype} from './prototype.tsx';
import {Prototype as OperatingGoodsPrototype} from './prototype.tsx?operating-goods';
import {Prototype as OperatingHomePrototype} from './prototype.tsx?operating-home';
import {OperatingProvider} from './operating-context';
import {LivePeoplePage} from './live-people';
import {LiveOverviewPage} from './live-overview';
import {LiveMarketPage} from './live-market';
type Props={page:'home'|'people'|'goods'|'market'|'overview';mode?:'business'|'example'};
// Keep the reference source byte-for-byte intact. Business-only layouts
// enter here; example mode always uses the original component.
export function Prototype({page,mode='business'}:Props){
 if(page==='overview'&&mode!=='example')return <OperatingProvider><LiveOverviewPage/></OperatingProvider>;
 if(page==='home'&&mode!=='example')return <OperatingHomePrototype page={page} mode={mode}/>;
 if(page==='market'&&mode!=='example')return <OperatingProvider><LiveMarketPage/></OperatingProvider>;
 if(page==='goods'&&mode!=='example')return <OperatingGoodsPrototype page={page} mode={mode}/>;
 return page==='people'&&mode!=='example'?<OperatingProvider><LivePeoplePage/></OperatingProvider>:<OriginalPrototype page={page} mode={mode}/>;
}
