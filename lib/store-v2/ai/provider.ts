// DEV09: AI provider abstraction. Replaceable; mock provider for tests.
// Real provider runs only when a secret is configured in the environment.

import {v2assert} from '../contracts/errors.ts';

export interface Hypothesis {
  claim: string;
  confidence: number;
  evidence_refs: string[];
  suggested_next_step?: string;
}

export interface InvestigationResult {
  case_id: string;
  hypotheses: Hypothesis[];
  summary: string;
  budget_used: {tokens: number; steps: number};
  trace_id: string;
}

export interface AIProvider {
  readonly name: string;
  investigate(input: {case_id: string; context: string; budget: {max_tokens: number; max_steps: number}}): Promise<InvestigationResult>;
}

/**
 * Deterministic mock provider used in tests and when no real provider secret is set.
 * Produces a single hypothesis from the signal context, never fabricates amounts.
 */
export class MockAIProvider implements AIProvider {
  readonly name = 'mock';
  async investigate({case_id, context, budget}: {case_id: string; context: string; budget: {max_tokens: number; max_steps: number}}): Promise<InvestigationResult> {
    v2assert(budget.max_tokens > 0 && budget.max_steps > 0, 'INVALID_COMMAND', '预算须为正');
    return {
      case_id,
      trace_id: crypto.randomUUID(),
      budget_used: {tokens: Math.min(42, budget.max_tokens), steps: 1},
      summary: context.includes('out_of_stock') ? '检测到核心码缺货，建议优先补货并核查在途库存。' : '基于当前信号的规则化分析摘要。',
      hypotheses: [
        {
          claim: '该核心码库存为 0，可能导致销售损失。',
          confidence: 0.85,
          evidence_refs: ['signal:out_of_stock'],
          suggested_next_step: '核查在途与可调拨库存，必要时下补货单。',
        },
      ],
    };
  }
}

/** Real provider requires a secret from the environment; absent here it is not_run. */
export function resolveProvider(env: Record<string, string | undefined>): AIProvider | null {
  if (env.NEO_AI_PROVIDER_SECRET) {
    // Real provider integration is intentionally not implemented in this environment.
    return null;
  }
  return new MockAIProvider();
}
