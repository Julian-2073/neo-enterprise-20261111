"""Preserve provider completion receipts and reject unfinished JSON.

An HTTP reply can be received/billed yet contain truncated output. Keep that
distinction in the model journal; format repair remains owned by the caller.
"""


class ModelOutputIncomplete(ValueError):
    code = 'MODEL_OUTPUT_INCOMPLETE'
    retryable = False


def conversation_message(message):
    """Keep provider fields required when an assistant turn is replayed."""
    return {key: value for key, value in message.items()
            if key in ('role', 'content', 'reasoning_content', 'tool_calls')}


def deepseek_messages(messages):
    """Return a DeepSeek-safe copy without mutating the conversation journal.

    Locally planned and non-thinking turns legitimately have no reasoning, so
    represent that as an empty string while preserving real provider output.
    """
    normalized = []
    for message in messages:
        item = dict(message)
        if item.get('role') == 'assistant' and 'reasoning_content' not in item:
            item['reasoning_content'] = ''
        normalized.append(item)
    return normalized


def response_message(data):
    choice = data['choices'][0]
    message = dict(choice['message'])
    if choice.get('finish_reason') is not None:
        message['_finish_reason'] = choice['finish_reason']
    return message, data.get('usage', {})


def complete_json_content(message):
    if message.get('_finish_reason') == 'length':
        raise ModelOutputIncomplete('模型 JSON 输出达到长度上限被截断；必须从原输入重新生成完整对象，不能补猜缺失字段')
    content = message.get('content')
    if not isinstance(content, str) or not content.strip():
        raise ModelOutputIncomplete('模型未返回完整 JSON 正文')
    return content
