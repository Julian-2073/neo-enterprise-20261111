import {sqliteTable,text,index} from 'drizzle-orm/sqlite-core';
import {businesses} from './schema';
export const neoControlResources=sqliteTable('neo_control_resources',{
 id:text('id').primaryKey(),businessId:text('business_id').notNull().references(()=>businesses.id),dataNature:text('data_nature').notNull(),kind:text('kind').notNull(),payload:text('payload').notNull(),secret:text('secret'),actorId:text('actor_id').notNull(),createdAt:text('created_at').notNull(),
},t=>[index('idx_control_resource_scope').on(t.businessId,t.dataNature,t.kind,t.createdAt)]);
export const neoControlHeads=sqliteTable('neo_control_heads',{
 id:text('id').primaryKey(),resourceId:text('resource_id').notNull().references(()=>neoControlResources.id),
});
