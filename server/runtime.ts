import { env } from "cloudflare:workers";
import type { Runtime } from "./store.ts";
import {configuredRuntime} from "./runtime-config.ts";
declare const __NEO_LOCAL_CONFIG__: {
    enabled: boolean;
    development: boolean;
    userId: string;
} | null;
export function runtime(): Runtime { return configuredRuntime(env,__NEO_LOCAL_CONFIG__ ?? undefined); }
