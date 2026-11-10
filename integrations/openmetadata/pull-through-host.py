"""Import official Docker Hub image through host networking when VM registry fails.
Uses Registry v2 manifests, content-digest verification, and Docker load archive.
"""
import hashlib,json,sys,tarfile,tempfile,gzip,shutil,subprocess
from pathlib import Path
import requests
repo,tag,target=sys.argv[1:]
s=requests.Session()
token=s.get('https://auth.docker.io/token',params={'service':'registry.docker.io','scope':f'repository:{repo}:pull'},timeout=30);token.raise_for_status()
h={'Authorization':'Bearer '+token.json()['token'],'Accept':'application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.docker.distribution.manifest.v2+json,application/vnd.oci.image.manifest.v1+json'}
def get(path):
 r=s.get('https://registry-1.docker.io/v2/'+repo+'/'+path,headers=h,timeout=60);r.raise_for_status();return r
m=get('manifests/'+tag).json()
if 'manifests' in m:
 platforms=m['manifests'];chosen=next((p for p in platforms if p.get('platform',{}).get('architecture')=='arm64' and p['platform'].get('os')=='linux'),None) or next(p for p in platforms if p.get('platform',{}).get('architecture')=='amd64' and p['platform'].get('os')=='linux')
 print('platform',chosen['platform'],flush=True);m=get('manifests/'+chosen['digest']).json()
with tempfile.TemporaryDirectory(prefix='neo-om-image-') as folder:
 root=Path(folder); config=get('blobs/'+m['config']['digest']).content
 if hashlib.sha256(config).hexdigest()!=m['config']['digest'].split(':')[1]:raise ValueError('config digest mismatch')
 cfg=m['config']['digest'].split(':')[1]+'.json';(root/cfg).write_bytes(config);layers=[]
 for i,layer in enumerate(m['layers']):
  digest=layer['digest'].split(':')[1];print('layer',i+1,len(m['layers']),layer['size'],flush=True)
  r=s.get('https://registry-1.docker.io/v2/'+repo+'/blobs/'+layer['digest'],headers=h,stream=True,timeout=90);r.raise_for_status()
  compressed=root/'compressed';sha=hashlib.sha256()
  with compressed.open('wb') as f:
   for chunk in r.iter_content(1024*1024):sha.update(chunk);f.write(chunk)
  if sha.hexdigest()!=digest:raise ValueError('layer digest mismatch')
  name=digest+'/layer.tar';out=root/name;out.parent.mkdir()
  with compressed.open('rb') as source:
   magic=source.read(2);source.seek(0)
   with (gzip.GzipFile(fileobj=source) if magic==b'\x1f\x8b' else source) as inp,out.open('wb') as dest:shutil.copyfileobj(inp,dest)
  compressed.unlink();layers.append(name)
 (root/'manifest.json').write_text(json.dumps([{'Config':cfg,'RepoTags':[target],'Layers':layers}]))
 proc=subprocess.Popen(['docker','--context','colima','load'],stdin=subprocess.PIPE)
 with tarfile.open(fileobj=proc.stdin,mode='w|') as tar:
  tar.add(root/'manifest.json',arcname='manifest.json');tar.add(root/cfg,arcname=cfg)
  for name in layers:tar.add(root/name,arcname=name)
 proc.stdin.close()
 if proc.wait():raise RuntimeError('docker load failed')
