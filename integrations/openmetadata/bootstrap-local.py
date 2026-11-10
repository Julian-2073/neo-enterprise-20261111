"""Bootstrap the official localhost quickstart and private NEO service token.
Only for a fresh development instance using vendor quickstart credentials.
"""
import base64,json,os,sys,time
from pathlib import Path
import requests
url='http://127.0.0.1:8585';out=Path(sys.argv[1])
s=requests.Session();s.trust_env=False
for _ in range(450):
    try:
        r=s.get(url+'/api/v1/system/version',timeout=3)
        if r.status_code in (200,401,403):break
    except requests.RequestException:pass
    time.sleep(2)
else:raise SystemExit('OpenMetadata startup did not become healthy')
r=s.post(url+'/api/v1/users/login',json={'email':'admin@open-metadata.org','password':base64.b64encode(b'admin').decode()},timeout=15);r.raise_for_status()
token=r.json()['accessToken'];s.headers['Authorization']='Bearer '+token
r=s.get(url+'/api/v1/users/name/ingestion-bot',timeout=15);r.raise_for_status();bot=r.json()
r=s.get(url+'/api/v1/users/auth-mechanism/'+bot['id'],timeout=15);r.raise_for_status()
# Use the vendor-provisioned ingestion bot rather than store admin login/session.
mechanism=r.json() or {};config=mechanism.get('config') or {};token=config.get('JWTToken') or config.get('jwtToken')
if not token:
    raise SystemExit('Ingestion bot token unavailable; inspect documented bot-token endpoint')
s.headers['Authorization']='Bearer '+token
r=s.get(url+'/api/v1/users/loggedInUser',timeout=10);r.raise_for_status()
out.parent.mkdir(parents=True,exist_ok=True)
fd=os.open(out,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
with os.fdopen(fd,'w') as f:json.dump({'openmetadataUrl':url,'openmetadataToken':token},f)
print(json.dumps({'configured':True,'serviceUser':r.json().get('name'),'url':url}))
