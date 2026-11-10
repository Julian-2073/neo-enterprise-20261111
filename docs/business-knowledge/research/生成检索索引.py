"""Read-only source inventory. Writes only into this research directory."""
from pathlib import Path
from collections import Counter, defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo
import os, csv, json, hashlib, re

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
MAIN = ROOT
PRUNE = {'node_modules','.git','.venv','.next','.wrangler','dist','build','outputs','storybook-static','__pycache__','.pytest_cache','.openai','.codex','.agents'}
TEXT = {'.ts','.tsx','.py','.mjs','.sql','.md','.css','.toml','.json','.diff','.patch'}
SECRET = {'.dev.vars','.env','.env.local','.env.production'}
SYMBOL = re.compile(r'^(?:export\s+)?(?:async\s+)?(?:function|def|class|interface|type)\s+(\w+)|^export\s+const\s+(\w+)', re.M)

def category(rel):
    p = str(rel)
    if p.startswith('监督/'): return '验收与版本', 'R46,R48'
    if p.startswith('虚拟数据库_Demo/'): return '合成数据', 'R45'
    if '/scripts/synthetic-data/' in p or '/isolated-synthetic-' in p: return '合成数据', 'R45'
    if '/outputs/' in p or '/reports/' in p: return '交付与证据', 'R45,R46,R48'
    if '/docs/' in p or p.endswith('.md'): return '产品与业务文档', 'R01,R48,R49,R50'
    if '/tests/' in p: return '验证', 'R46'
    if '/agent-service/' in p:
        if 'engine' in p or 'evaluation' in p: return '预测与情景', 'R31,R32,R33,R34,R35,R36'
        if 'provider' in p or '/mcp.' in p: return '模型和外部来源', 'R25,R27,R42'
        if any(t in p for t in ['job_queue','execution','runner','patrol','/app.py']): return '任务可靠性', 'R39,R40,R41,R43'
        if 'business_' in p: return '业务调查工具', 'R37,R38'
        if 'ontology' in p: return 'Ontology Agent查询', 'R29,R38'
        return '智能体契约与编排', 'R37,R38,R42'
    if '/server/ontology/' in p or '/components/ontology/' in p or 'ontology-schema' in p: return 'Ontology', 'R28,R29,R30'
    if '/server/' in p:
        if any(t in p for t in ['auth','runtime','errors','/api.']): return '权限与接口', 'R02,R03,R44'
        if 'decision' in p: return '老板选择回读', 'R35,R36'
        if 'agents' in p or 'agent-contracts' in p: return 'Agent与结果契约', 'R35,R37,R39,R42'
        if 'evidence' in p: return '局部证据', 'R10,R24,R47'
        if 'snapshot' in p: return '指标与时点', 'R08,R09,R11,R12,R18'
        return '接入与质量', 'R04,R05,R06,R07,R08'
    if '/db/' in p or '/drizzle/' in p: return '持久化与版本', 'R05,R06,R08,R28,R44'
    if '/lib/' in p:
        if 'hotel' in p: return '酒店场景', 'R49'
        if 'decision' in p: return '方案历史', 'R35,R36'
        if 'presentation' in p or 'evidence' in p: return '表达与证据', 'R10,R47'
        if 'domain' in p: return '人货场关系', 'R13,R14,R15,R16,R17,R18,R19,R20,R21,R22,R23'
        if 'growth-data' in p or 'neo-core' in p: return '历史规则原型', 'R13,R16,R31,R48,R50'
        return '看板数据适配', 'R09,R11,R13,R18,R24,R47'
    if '/app/neo-v2/hotel/' in p: return '酒店原型', 'R49'
    if '/app/neo-v2/' in p: return '历史原型', 'R48,R50'
    if '/app/' in p or '/components/' in p: return '老板页面与交互', 'R09,R10,R24,R35,R36,R47'
    if '/scripts/' in p: return '本地工具与验证', 'R44,R45,R46'
    return '配置与资产', 'R44,R48'

records=[]; skips=Counter(); pruned=Counter(); groups=defaultdict(list)
for base, dirs, files in os.walk(ROOT, followlinks=False):
    keep=[]
    for d in sorted(dirs):
        path=Path(base,d)
        if path==OUT or d in PRUNE or path.is_symlink(): pruned[d]+=1
        else: keep.append(d)
    dirs[:]=keep
    for name in sorted(files):
        p=Path(base,name)
        if p.is_symlink(): skips['symbolic_link']+=1; continue
        if name in SECRET or name.startswith('.env') or p.suffix in {'.vars','.pem','.key'}: skips['credential_name']+=1; continue
        if name in {'package-lock.json','pnpm-lock.yaml','yarn.lock'}: skips['dependency_lock']+=1; continue
        if p.suffix not in TEXT: skips['non_source_or_binary_'+(p.suffix or 'no_suffix')]+=1; continue
        if p.stat().st_size>2*1024*1024: skips['larger_than_2MiB']+=1; continue
        before=p.stat()
        try: raw=p.read_bytes(); value=raw.decode('utf-8')
        except (UnicodeError,OSError): skips['unreadable_text']+=1; continue
        after=p.stat(); rel=p.relative_to(ROOT); module,refs=category(rel)
        digest=hashlib.sha256(raw).hexdigest()
        area='主项目' if p.is_relative_to(MAIN) else '隔离副本' if str(rel).startswith('并行优化/') else '资料与监督'
        symbols=[{'name':m.group(1) or m.group(2),'line':value.count('\n',0,m.start())+1} for m in SYMBOL.finditer(value)]
        headings=[{'name':line.lstrip('# ').strip(),'line':i} for i,line in enumerate(value.splitlines(),1) if re.match(r'^#{1,4} ',line)] if p.suffix=='.md' else []
        rec=dict(path=str(p),relative_path=str(rel),area=area,module=module,research_refs=refs,bytes=len(raw),lines=len(value.splitlines()),sha256=digest,read_level='全文机器索引；关键文件另作人工语义阅读',changed_during_read=before.st_mtime_ns!=after.st_mtime_ns,symbols=symbols,headings=headings)
        records.append(rec); groups[digest].append(str(p))

for rec in records:
    peers=groups[rec['sha256']]
    preferred=next((p for p in peers if Path(p).is_relative_to(MAIN)),peers[0])
    rec['same_content_count']=len(peers);rec['content_representative']=preferred
records.sort(key=lambda r:r['relative_path'])
summary=dict(captured_at=datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(),root=str(ROOT),scope='排除依赖、缓存、凭证、二进制、锁文件和本研究目录后的项目文本文件',files=len(records),unique_contents=len(groups),by_area=dict(Counter(r['area'] for r in records)),by_module=dict(Counter(r['module'] for r in records)),indexed_symbols=sum(len(r['symbols']) for r in records),excluded=dict(skips),pruned_directory_counts=dict(pruned),changed_during_read=[r['path'] for r in records if r['changed_during_read']],limitations=['机器全文索引不等于逐行人工审计','生成输出只作定位与版本证据，不将数量算成功能数量','工作线可能并发更新，本清单为读取时点指纹，不是整仓原子快照','未读取凭证、数据库、截图、压缩包或线上状态'])
(OUT/'项目检索索引.json').write_text(json.dumps(dict(summary=summary,files=records),ensure_ascii=False,indent=2)+'\n')
with (OUT/'逐文件实践映射.csv').open('w',encoding='utf-8-sig',newline='') as f:
    cols=['relative_path','area','module','research_refs','read_level','lines','sha256','same_content_count','content_representative','changed_during_read']
    w=csv.DictWriter(f,fieldnames=cols);w.writeheader();w.writerows({k:r[k] for k in cols} for r in records)
print(json.dumps(summary,ensure_ascii=False,indent=2))
