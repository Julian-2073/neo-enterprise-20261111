"use client";
// Shell for the /neo2 five-workspace area. Owns the session provider and nav.

import type {ReactNode} from 'react';
import {Neo2SessionProvider, useNeo2Session} from './session';
import {AvailabilityBadge, Notice} from './ui';
import {withBusiness} from './api';
import './neo2.css';

const NAV: Array<{id: string; label: string; short: string; href: string}> = [
    {id: 'home', label: '今日经营', short: '今日', href: '/neo2'},
    {id: 'sales-change', label: '销售变化', short: '销售', href: '/neo2/sales-change'},
    {id: 'structure', label: '商品结构', short: '商品', href: '/neo2/structure'},
    {id: 'campaign', label: '营销复盘', short: '活动', href: '/neo2/campaign'},
    {id: 'actions', label: '行动中心', short: '行动', href: '/neo2/actions'},
];

const ROLE_ZH: Record<string, string> = {admin: '管理员', importer: '导入成员', reader: '只读成员'};

function Nav({active}: {active: string}) {
    const session = useNeo2Session();
    const link = (href: string) => withBusiness(href, session.businessId);
    return (
        <aside className="neo2-nav">
            <a className="neo2-logo" href={link('/neo2')}>NEO<small>门店经营助手 v2</small></a>
            {NAV.map((item) => (
                <a key={item.id} href={link(item.href)} aria-current={active === item.id ? 'page' : undefined}>
                    <span className="neo2-nav-label">{item.label}</span>
                    <span className="neo2-nav-short" aria-hidden="true">{item.short}</span>
                </a>
            ))}
            <div className="neo2-nav-secondary">
                <a href={link('/neo2/data')} aria-current={active === 'data' ? 'page' : undefined}>数据接入与质量</a>
            </div>
        </aside>
    );
}

function Header() {
    const session = useNeo2Session();
    if (!session.businessId) return null;
    return (
        <div className="neo2-scope-bar">
            <label>
                企业 / 工作区
                <select aria-label="企业" value={session.businessId} onChange={(e) => session.setBusiness(e.target.value)}>
                    {session.businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
            </label>
            {session.workspaceName ? <span className="neo2-sr-hint">工作区：{session.workspaceName}</span> : null}
            {session.role ? <span className="neo2-sr-hint">角色：{ROLE_ZH[session.role] ?? session.role}</span> : null}
            {session.capabilities ? <AvailabilityBadge availability={session.capabilities.availability} /> : null}
        </div>
    );
}

export function Neo2Shell({active, title, subtitle, children}: {
    active: string;
    title: string;
    subtitle?: string;
    children: ReactNode;
}) {
    return (
        <Neo2SessionProvider>
            <div className="neo2-shell">
                <Nav active={active} />
                <div style={{flex: 1, minWidth: 0}}>
                    <main className="neo2-main">
                        <h1>{title}</h1>
                        {subtitle ? <p className="neo2-subtitle">{subtitle}</p> : null}
                        <Header />
                        <SessionError />
                        {children}
                    </main>
                    <footer className="neo2-footer">
                        数据来自已确认的 v2 快照与确定性计算；未知数据显示「缺数据」，不使用 0 填充。
                    </footer>
                </div>
            </div>
        </Neo2SessionProvider>
    );
}

function SessionError() {
    const session = useNeo2Session();
    if (!session.error) return null;
    return <Notice tone="error">{session.error}</Notice>;
}
