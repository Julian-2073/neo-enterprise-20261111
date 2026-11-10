import { handleStoreV2 } from "../../../../../server/v2/router";
import { runtime } from "../../../../../server/runtime";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return handleStoreV2(request, runtime()); }
export function POST(request: Request) { return handleStoreV2(request, runtime()); }
