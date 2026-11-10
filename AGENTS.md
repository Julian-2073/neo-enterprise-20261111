# GrowthOS development guide

## Current objective

- Deliver the approved local ingestion + operating dashboard slice: four CSV templates, authorization, D1/R2, snapshots and evidence.
- Production deployment and real-merchant validation are separate milestones; the original /demo components are the single product frontend. Default routes read saved snapshots; /demo?mode=example preserves explicitly labelled mock fixtures using the same components. Preserve layout, styling and interactions; only bind data and correct data-related labels.
- Build one independently verifiable vertical slice per development round.
- The required loop is: load/import operating data -> normalize business events and map them to 5A -> calculate metrics -> produce evidence-backed diagnostics -> turn a diagnosis into an action or experiment -> save status and outcomes -> update the dashboard.

## Product boundaries

- Do not build customer-specific editions in v0.1.
- Reuse the existing dashboard visual language and project structure.
- Do not rebuild a marketing site or add multi-model orchestration, complex permissions, platform integrations, industry templates, or decorative features.
- Prefer the smallest rule-driven, explainable and testable behavior that advances the core loop.

## Architecture and implementation

- This is a Sites project; preserve `.openai/hosting.json` and follow the Sites workflow.
- Use Cloudflare D1 for durable structured product state and Drizzle for schema migrations.
- Keep shared event mapping and metric logic independent of UI components so it can be tested directly.
- PostHog may inform event/person/properties and funnel modeling only.
- GrowthBook may inform hypothesis/metric/experiment/result modeling only.
- Do not copy AGPL code from Twenty CRM or Metabase and do not clone large platforms into this repository.
- Add focused, permissively licensed React dependencies only when they directly serve the current slice. Possible choices include PapaParse for CSV, shadcn/ui for forms and interactions, TanStack Table for data tables, and Tremor or Recharts for charts. Do not install a full suite speculatively.

## Definition of done for each slice

- The slice has one clear user-visible or server-verifiable outcome.
- Schema changes include generated and inspected Drizzle migrations.
- Mapping and calculations have focused tests; UI or route behavior has proportionate coverage.
- Run the full build and relevant tests before reporting completion.
- Report the operable result, verification, changed files, remaining risk, and the next best slice.
