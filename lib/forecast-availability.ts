/** Read-only scope annotation. Never changes timestamps or frozen Python arithmetic. */
function validDate(value:string){
 return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
}
function explicitInstant(value:unknown){
 if(typeof value!=='string')return NaN;
 // Date.parse alone accepts timezone-free strings and normalizes some invalid dates.
 const match=/^(\d{4}-\d{2}-\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?([Zz]|[+-]\d{2}:?\d{2})$/.exec(value);
 if(!match||!validDate(match[1])||Number(match[2])>23||Number(match[3])>59||Number(match[4]??0)>59)return NaN;
 return Date.parse(value);
}
export function forecastAvailability(envelope:{snapshot:{asOf:string};facts:Array<{kind:string;availableAt?:string;fact:{entry_type?:string}}>}){
 const paid=envelope.facts.filter(r=>r.kind==='orders'&&r.fact.entry_type==='paid');
 const asOf=envelope.snapshot.asOf;
 const cutoff=validDate(asOf)?Date.parse(asOf+'T23:59:59.999+08:00'):NaN;
 const instants=paid.map(r=>explicitInstant(r.availableAt));
 const unknown=instants.filter(t=>!Number.isFinite(t)).length;
 const available=instants.filter(t=>Number.isFinite(t)&&t<=cutoff).length;
 return {status:Number.isFinite(cutoff)&&paid.length>0&&unknown===0&&available===0?'no_paid_series':'historical_availability_unverified',paidRecords:paid.length,availableByForecastDate:available,missingAvailability:unknown,meaning:'此处仅按预测起点的上海经营日结束时点核对资料是否已录入，缺少明确时区的时间待核；每个历史训练窗的可用性和覆盖须另由带方法版本的时点回测核验。'};
}
