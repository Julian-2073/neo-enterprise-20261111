"""Published middle-platform settings narrow existing runtime capabilities."""
import json
from .ontology import expand_ontology
from .providers import ProviderError
ROLES=('conversion','supply','market')

def role_setting(envelope, role):
    return expand_ontology(envelope).get('platformConfiguration',{}).get('agents',{}).get(role)

def enabled_roles(envelope, roles):
    return [r for r in roles if role_setting(envelope,r) is None or role_setting(envelope,r).get('enabled') is True]

def configured_tools(envelope,role,specs):
    setting=role_setting(envelope,role)
    if setting is None:return specs
    if not setting.get('enabled'):raise ProviderError('该专业在已发布配置中停用')
    # Required evidence reads cannot be removed through business configuration.
    allowed={'describe_business','read_business','query_objects',*setting.get('tools',[])}
    if role=='market':allowed.add('read_decisions')
    return [t for t in specs if t['function']['name'] in allowed]

def configured_instruction(envelope,role):
    setting=role_setting(envelope,role)
    if setting is None:return ''
    if not setting.get('enabled'):raise ProviderError('该专业在已发布配置中停用')
    return '\n当前企业已发布的业务职责和重点：'+json.dumps({'mission':setting['mission'],'instructions':setting['instructions']},ensure_ascii=False)+'。补充要求不能改变事实、证据条件、输出结构、专业读取范围或工具权限。'
