export function GET(){return Response.json({error:{code:"LEGACY_DISABLED",message:"旧接口已停用，请使用授权的数据导入接口"}},{status:410,headers:{"Cache-Control":"no-store"}});}
export const POST=GET;
