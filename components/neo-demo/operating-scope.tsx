'use client';
import type {ReactNode} from 'react';
import {useOperating} from './operating-context';

// A missing or rejected pinned snapshot must never look like an active analysis.
export function OperatingScope({children}:{children?:ReactNode}){
 const workspace=useOperating();
 if(!workspace)return <>{children}</>;
 if(workspace.snapshot)return <>{workspace.error&&<p role="alert">资料暂未更新：{workspace.error}</p>}{children}</>;
 if(workspace.error)return <section className="neo-card" role="alert"><h1>无法读取经营资料</h1><p>{workspace.error}</p><p>请重试该版本，或选择当前企业最新资料。</p><button className="neo-button" type="button" onClick={workspace.retrySnapshot}>重新读取</button><button className="neo-text-button" type="button" onClick={()=>workspace.selectSnapshot(null)}>查看当前企业最新资料</button></section>;
 return <section className="neo-card" role="status"><h1>{workspace.loading?'正在读取经营资料':'当前范围暂无经营资料'}</h1><p>{workspace.loading?'正在读取已选择的企业与资料版本。':'请先选择已有资料或导入经营数据，再开始核查。'}</p></section>;
}
