import { handleApi } from "../../../../server/api";
import { runtime } from "../../../../server/runtime";
export const dynamic = "force-dynamic";
export function GET(request:Request){return handleApi(request,runtime());}
export function POST(request:Request){return handleApi(request,runtime());}
