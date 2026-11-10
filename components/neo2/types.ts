// v2 API response types — mirrors server/v2 responses and lib/store-v2 contracts.
// Unknown data is null, never fabricated client-side.

export type AvailabilityStatus = 'available' | 'partial' | 'blocked' | 'not_supported';

export type Availability = {
    status: AvailabilityStatus;
    reason_codes: string[];
    coverage: number | null;
    missing_fields: string[];
};

export type MetricUnit = 'CNY_cents' | 'count' | 'quantity' | 'ratio_numerator';

export type MetricResult = {
    metric_result_id: string;
    metric_id: string;
    metric_contract_version: string;
    scope_hash: string;
    snapshot_id: string;
    value: number | null;
    unit: MetricUnit;
    denominator: number | null;
    availability: Availability;
    evidence_ids: string[];
    calculated_at: string;
};

export type CaseState = 'detected' | 'investigating' | 'decision_ready' | 'acting' | 'observing' | 'reviewed' | 'closed';
export type PlanState = 'draft' | 'submitted' | 'approved' | 'rejected' | 'withdrawn' | 'superseded';
export type TaskState = 'pending_confirmation' | 'ready' | 'in_progress' | 'pending_verification' | 'blocked' | 'completed' | 'cancelled';

export type CaseRow = {
    case_id: string;
    workspace_id: string;
    snapshot_id: string;
    open_key: string;
    state: string;
    version: number;
    title: string;
    created_at: string;
    updated_at: string;
    actor_id: string;
};

export type CaseSignal = {
    signal_id: string;
    kind: string;
    snapshot_id: string;
    payload: unknown;
};

export type PlanRow = {
    plan_revision_id: string;
    workspace_id: string;
    case_id: string;
    version: number;
    state: string;
    plan_hash: string;
    title: string;
    payload: string;
    created_at: string;
    updated_at: string;
    actor_id: string;
};

export type TaskRow = {
    task_id: string;
    workspace_id: string;
    case_id: string;
    plan_revision_id: string;
    state: string;
    version: number;
    previous_state: string | null;
    title: string;
    action_type: string;
    created_at: string;
    updated_at: string;
    actor_id: string;
};

export type ReviewRecord = {
    review_id: string;
    case_id: string;
    conclusion: string;
    candidate_learnings: string[];
    observed_effect: string | null;
    created_at: string;
};

export type InvestigationResult = {
    case_id: string;
    summary: string;
    hypotheses: Array<{claim: string; confidence: number; evidence_refs: string[]; suggested_next_step?: string}>;
    budget_used: {tokens: number; steps: number};
    provider: string;
    trace_id: string;
};

export type CapabilityPlan = {
    workspace_id: string;
    actor_id: string;
    role: 'admin' | 'importer' | 'reader';
    stores: {status: string; items: unknown[]; reason_codes: string[]};
    actions: Array<{action_template_id: string; allowed: boolean; reason_codes: string[]}>;
    cost_fields: {status: string; reason_codes: string[]};
    limitations: string[];
};

export type CapabilitiesResponse = {
    request_id: string;
    workspace_id: string;
    workspace_name: string;
    actor_id: string;
    role: CapabilityPlan['role'];
    role_source: string;
    generated_at: string;
    availability: Availability;
    warnings: string[];
    capabilities: CapabilityPlan;
};

export type ImportPreview = {
    import_id: string;
    status: 'ready' | 'failed';
    validation_revision: number;
    grain: string;
    counts: Record<string, number>;
    isolated_skus: string[];
    warnings: Array<{code: string; path: string; message: string}>;
    errors: Array<{code: string; path: string; message: string}>;
    capability_preview: {
        sales_amount: {status: AvailabilityStatus; reason_codes: string[]};
        order_count: {status: AvailabilityStatus; reason_codes: string[]};
        gross_margin: {status: AvailabilityStatus; reason_codes: string[]};
        campaign_attribution: {status: AvailabilityStatus; reason_codes: string[]};
    };
    reused: boolean;
};

export type ConfirmResult = {snapshot_id: string; import_id: string};

export type AnalysisResponse = {
    request_id: string;
    workspace: 'sales-change' | 'structure' | 'campaign';
    snapshot_id: string;
    results: MetricResult[];
};

export type BusinessesResponse = {
    businesses: Array<{id: string; name: string; role: string}>;
    current: {id: string; name: string; role: string};
};
