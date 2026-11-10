'use client';
import {useOperating} from './operating-context';
// Import the frozen original explicitly; the integration alias only matches
// the extensionless entry used by the host, never this original module.
import {TodayBriefing as OriginalBriefing} from './today-briefing.tsx';
import {LiveTodayBriefing} from './live-today-briefing';
export function TodayBriefing(props:{onClose:()=>void}){
 return useOperating()?<LiveTodayBriefing {...props}/>:<OriginalBriefing {...props}/>;
}
