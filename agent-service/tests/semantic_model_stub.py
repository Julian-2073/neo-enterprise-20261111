"""Explicit deterministic checker adapter for offline transport/cap tests."""
import json

def semantic_response(messages):
    if not messages[0]['content'].startswith('NEO_SEMANTIC_SUPPORT_CHECK'):return None
    payload=json.loads(messages[1]['content']);evidence=payload['evidence'];ref=evidence[0] if evidence else None
    return {'role':'assistant','content':json.dumps({'claims':[{'i':i,'s':'S' if ref else 'I','r':[0] if ref else [],'c':[],'g':[]} for i,_ in enumerate(payload['statements'])]},ensure_ascii=False)}
