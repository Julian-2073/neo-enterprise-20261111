"""Read-only Git delivery inventory, with generated evidence under outputs only."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
SAFE=('app/','components/','lib/','server/','worker/','db/','drizzle/','public/','scripts/','tests/','stories/','.storybook/','docs/','agent-service/neo_agent/','agent-service/scripts/','agent-service/tests/')
TOP={'package.json','package-lock.json','tsconfig.json','vite.config.ts','.gitignore','NEO_STABLE_VERSION.json','AGENTS.md','README.md'}
def inventory(base='HEAD'):
    rev=subprocess.check_output(['git','rev-parse','--verify',base+'^{commit}'],cwd=ROOT,text=True).strip()
    raw=subprocess.check_output(['git','ls-files','-z','--cached','--others','--exclude-standard'],cwd=ROOT).decode().split('\0')
    files=[]
    for relative in sorted(set(raw)-{''}):
        p=ROOT/relative
        if relative not in TOP and not relative.startswith(SAFE):continue
        if p.suffix in ('.log','.db','.sqlite','.pyc') or any(x in ('node_modules','state','__pycache__','.venv') for x in p.parts):continue
        if p.is_symlink() or not p.is_file() or not p.resolve().is_relative_to(ROOT):continue
        if any(x.startswith('.env') or x.startswith('.dev.vars') for x in p.parts):continue
        files.append({'path':relative,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size})
    digest=hashlib.sha256(json.dumps(files,separators=(',',':')).encode()).hexdigest()
    return {'schemaVersion':1,'root':str(ROOT),'gitBase':rev,'files':files,'digest':digest,'acceptance':'not_claimed','scope':'source inventory only; excludes credentials, caches, runtime databases and logs'}
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--base',default='HEAD');parser.add_argument('--output',type=Path,default=ROOT/'outputs/tool-handoff/manifest.json');args=parser.parse_args()
    target=args.output.resolve()
    if not target.is_relative_to(ROOT/'outputs') or target==ROOT/'outputs':parser.error('交付清单必须写入outputs子目录')
    value=inventory(args.base);target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'files':len(value['files']),'digest':value['digest'],'output':str(target),'acceptance':'not_claimed'}))
if __name__=='__main__':main()
