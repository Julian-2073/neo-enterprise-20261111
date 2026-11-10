"""Bounded stdio client for the user's configured Firecrawl MCP launcher.
Only search and scrape can be invoked; no model-selected commands or tool names.
"""
import asyncio,json,os
from pathlib import Path
from .providers import ProviderError

class FirecrawlMCP:
    def __init__(self,command):
        if not command or not Path(command).is_file():raise ProviderError('Firecrawl MCP 启动器未配置或不存在')
        self.command=command;self.process=None;self.counter=0;self.tools=set()
    async def __aenter__(self):
        self.process=await asyncio.create_subprocess_exec(self.command,stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL,limit=4000000)
        try:
            await self.rpc('initialize',{'protocolVersion':'2024-11-05','capabilities':{},'clientInfo':{'name':'neo-market','version':'1.0'}})
            self.process.stdin.write((json.dumps({'jsonrpc':'2.0','method':'notifications/initialized'})+'\n').encode());await self.process.stdin.drain()
            result=await self.rpc('tools/list',{})
            self.tools={t['name'] for t in result.get('tools',[])}
            return self
        except BaseException:
            await self.__aexit__(None,None,None);raise
    async def __aexit__(self,*args):
        if self.process and self.process.returncode is None:
            self.process.terminate()
            try:await asyncio.wait_for(self.process.wait(),5)
            except asyncio.TimeoutError:self.process.kill();await self.process.wait()
    async def rpc(self,method,params):
        self.counter+=1;ident=self.counter
        self.process.stdin.write((json.dumps({'jsonrpc':'2.0','id':ident,'method':method,'params':params})+'\n').encode());await self.process.stdin.drain()
        async def receive():
            while True:
                line=await self.process.stdout.readline()
                if not line:raise ProviderError('Firecrawl MCP 连接已关闭')
                try:reply=json.loads(line)
                except json.JSONDecodeError:continue
                if reply.get('id')!=ident:continue
                if reply.get('error'):raise ProviderError('Firecrawl MCP 请求失败，请检查插件连接')
                return reply.get('result',{})
        try:return await asyncio.wait_for(receive(),120)
        except asyncio.TimeoutError as e:raise ProviderError('Firecrawl MCP 查询超时') from e
    async def call(self,name,arguments):
        if name not in {'firecrawl_search','firecrawl_scrape'} or name not in self.tools:raise ProviderError('Firecrawl 工具不在本次授权范围')
        reply=await self.rpc('tools/call',{'name':name,'arguments':arguments})
        if reply.get('isError'):raise ProviderError('Firecrawl 来源查询失败')
        if isinstance(reply.get('structuredContent'),dict):return reply['structuredContent']
        for item in reply.get('content',[]):
            if item.get('type')=='text':
                try:return json.loads(item['text'])
                except (ValueError,KeyError):continue
        raise ProviderError('Firecrawl 返回内容格式不可读取')
