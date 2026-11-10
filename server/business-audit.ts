import type {Context} from './auth.ts';
import {statement} from './store.ts';
// Kept in the same publish transaction as the business record.
export function businessAudit(ctx:Context,action:string,resourceId:string,at:string){
 return statement(ctx.db,'INSERT OR IGNORE INTO audit_events(id,business_id,actor_id,action,resource_id,created_at) VALUES(?,?,?,?,?,?)',action+':'+resourceId,ctx.businessId,ctx.userId,action,resourceId,at);
}
