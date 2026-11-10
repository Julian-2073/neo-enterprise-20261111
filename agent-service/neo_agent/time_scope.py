from datetime import datetime,timedelta,timezone
SHANGHAI=timezone(timedelta(hours=8))
def aware_time(value):
    result=datetime.fromisoformat(value.replace('Z','+00:00'))
    if result.tzinfo is None:raise ValueError('时间必须带时区')
    return result

def shanghai_day(value):return aware_time(value).astimezone(SHANGHAI).date().isoformat()
def next_daily(value):
    now=aware_time(value).astimezone(SHANGHAI)
    boundary=now.replace(hour=9,minute=0,second=0,microsecond=0)
    return boundary if now<boundary else boundary+timedelta(days=1)
def emergency_deadline(value,evaluation):
    if not value or 'T' not in value:return False
    deadline=aware_time(value)
    return aware_time(evaluation)<deadline<next_daily(evaluation)
