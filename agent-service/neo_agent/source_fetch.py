"""Single-attempt public HTTPS fetch with DNS results bound to the connection.

The request URL contains the validated IP literal, so the transport cannot
resolve the registered domain again. Host and the httpcore sni_hostname
extension preserve the original HTTP authority and TLS certificate identity.
Redirects are rejected, not followed. No proxy or environment trust is used.
"""
import asyncio
import ipaddress
import socket
from urllib.parse import urlsplit
import httpx

async def fetch_knowledge_source(url,allowed_hosts,*,resolver=None,transport=None):
    parsed=urlsplit(url)
    if parsed.scheme!='https' or parsed.hostname not in allowed_hosts or parsed.username or parsed.password or parsed.port not in (None,443) or parsed.fragment:
        raise ValueError('来源不在许可公开 HTTPS 域名内')
    resolver=resolver or asyncio.get_running_loop().getaddrinfo
    addresses=await resolver(parsed.hostname,443,type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise ValueError('不读取本地或私有网络地址')
    # A single vetted address is used; failures do not fall back to an unvetted
    # DNS result or retry a redirect. TLS verification stays enabled.
    target=httpx.URL(url).copy_with(host=addresses[0][4][0])
    async with httpx.AsyncClient(timeout=18,follow_redirects=False,trust_env=False,verify=True,transport=transport) as client:
        async with client.stream('GET',target,headers={'Host':parsed.hostname,'Accept':'text/html,text/plain,application/rss+xml,application/atom+xml'},extensions={'sni_hostname':parsed.hostname}) as response:
            if response.status_code!=200:raise ValueError('原文状态异常或重定向')
            content_type=response.headers.get('content-type','')
            if not any(t in content_type for t in ('text/html','text/plain','application/rss+xml','application/atom+xml')):raise ValueError('原文类型异常')
            body=bytearray()
            async for part in response.aiter_bytes():
                body.extend(part)
                if len(body)>300000:raise ValueError('原文超过上限')
            return {'body':body.decode('utf-8'),'contentType':content_type,'url':url}
