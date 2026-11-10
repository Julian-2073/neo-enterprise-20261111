export const supportLabel=(value:unknown)=>({supported:'依据支持',insufficient:'依据不足，待核验',contradicted:'与依据冲突',conflict:'与依据冲突'}[String(value)]??'未记录支持判断');
export const dispositionLabel=(value:unknown)=>({ignore:'本次无需跟踪',monitor:'持续观察',research:'待研究核验',affects_assessment:'影响经营判断'}[String(value)]??'未记录筛选理由');
export const runStatusLabel=(value:unknown)=>({completed:'已完成',partial:'部分完成',failed:'未完成，需核验',cancelled:'已取消',running:'处理中',queued:'等待处理',pending:'等待处理',waiting:'等待结果',deferred:'等待可用额度',pending_dispatch:'等待派发确认',unknown:'结果尚未确认',uncertain:'结果尚未确认'}[String(value)]??'状态待核验');
