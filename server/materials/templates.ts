import type {MaterialKind} from './contracts.ts';
const meta=['source_record_id','effective_from'];
const make=(name:string,required:string[],optional:string[]=[])=>({name,required:[...meta,...required],optional:['effective_to',...optional,'source_known_at'],notes:'版本2；有效区间左闭右开，同对象同有效起日不可覆盖。严格企业/数据性质内关联；原件和记录血缘保存。'});
export const materialTemplates:Record<MaterialKind,ReturnType<typeof make>>={
 roles:make('商品角色',['role_id','name'],['purpose']),
 products:make('商品主数据',['product_id','name','role_id'],['image_url']),
 skus:make('SKU主数据',['sku_id','product_id'],['name','role_id','safety_units','unit']),
 channels:make('渠道主数据',['channel_id','name']),
 warehouses:make('仓库主数据',['warehouse_id','name']),
 customers:make('客户主数据',['customer_id'],['name']),
 customer_identities:make('客户身份映射',['identity_namespace','external_id','customer_id']),
 arrivals:make('到货计划',['arrival_id','sku_id','warehouse_id','eta','units','status'],['received_units','source_status','source_version']),
 supply_rules:make('供给评价规则',['rule_id','role_id','minimum_sellable_units','target_ratio_bps'],['qualification_basis']),
};
export const materialIdField:Record<MaterialKind,string>={roles:'role_id',products:'product_id',skus:'sku_id',channels:'channel_id',warehouses:'warehouse_id',customers:'customer_id',customer_identities:'external_id',arrivals:'arrival_id',supply_rules:'rule_id'};
