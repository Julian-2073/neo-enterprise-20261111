import { sites } from "@openai/sites-vite-plugin";
import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import {fileURLToPath} from 'node:url';
import {operatingHomeLayout} from './lib/operating-home-layout';
import {operatingGoodsLayout} from './lib/operating-goods-layout';

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async ({ command, mode }) => {
  if (process.env.NEO_LOCAL_AUTH === "true" && (command === "build" || mode === "production" || process.env.NODE_ENV === "production")) throw new Error("生产构建禁止 NEO_LOCAL_AUTH；仅 dev:local 可用");
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    // Must stay under node_modules/.vite: vinext's vite-plugin-commonjs skips
    // its export-statement wrapper only for optimized deps under that path;
    // a custom cacheDir made every rsc dep fail with "multiple default exports".
    cacheDir: "node_modules/.vite",
    // Integration boundary: the reference demo component and its source stay
    // frozen. Only a workspace with OperatingProvider uses the live brief.
    resolve: {alias:[{find:/^\.\/evidence-drawer$/,replacement:fileURLToPath(new URL('./components/neo-demo/evidence-entry.tsx',import.meta.url))},{find:/^\.\/charts$/,replacement:fileURLToPath(new URL('./components/neo-demo/charts-entry.tsx',import.meta.url))},{find:/^\.\/today-briefing$/,replacement:fileURLToPath(new URL('./components/neo-demo/briefing-entry.tsx',import.meta.url))},{find:/^\.\.\/\.\.\/components\/neo-demo\/prototype$/,replacement:fileURLToPath(new URL('./components/neo-demo/people-entry.tsx',import.meta.url))}]},
    define: { __NEO_LOCAL_CONFIG__: JSON.stringify(command === "serve" && process.env.NEO_LOCAL_AUTH === "true" ? { enabled: true, development: true, userId: process.env.NEO_LOCAL_USER_ID || "local-owner" } : null) },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      {name:'neo-operating-goods-layout',enforce:'pre',transform(code:string,id:string){
        if(id.endsWith('/components/neo-demo/prototype.tsx?operating-home'))return {code:operatingHomeLayout(code),map:null};
        if(id.endsWith('/components/neo-demo/prototype.tsx?operating-goods'))return {code:operatingGoodsLayout(code),map:null};
      }},
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
