// DEV09: Structural + semantic validation of AI investigation output.
// Guarantees: claims reference evidence, no fabricated amounts, no approval/write directives,
// confidence bounded, no disallowed tool invocations.

import {StoreV2Error, v2assert} from '../contracts/errors.ts';
import type {Hypothesis, InvestigationResult} from './provider.ts';

// Money-like patterns: amounts in CNY / yuan / 元, or bare large integers that look like prices.
const MONEY_PATTERN = /(¥|￥|CNY|yuan|元|rmb)\s*\d[\d,]*(?:\.\d{1,2})?|\b\d{4,}\b/i;
// Forbidden directives: the model must not approve, write back, or issue SQL/ERP commands.
const FORBIDDEN_PATTERN = /(approve|审批|同意执行|写回|回写|execute sql|update\s+\w+|insert\s+into|delete\s+from|call erp|下推erp)/i;

export interface ValidationIssue {
  field: string;
  message: string;
}

export function validateHypothesis(h: unknown, index: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (h === null || typeof h !== 'object') {
    return [{field: `hypotheses[${index}]`, message: '须为对象'}];
  }
  const hyp = h as Record<string, unknown>;
  if (typeof hyp.claim !== 'string' || hyp.claim.trim().length === 0) {
    issues.push({field: `hypotheses[${index}].claim`, message: 'claim 须为非空字符串'});
  }
  if (typeof hyp.confidence !== 'number' || hyp.confidence < 0 || hyp.confidence > 1) {
    issues.push({field: `hypotheses[${index}].confidence`, message: 'confidence 须在 [0,1]'});
  }
  if (!Array.isArray(hyp.evidence_refs) || hyp.evidence_refs.length === 0) {
    issues.push({field: `hypotheses[${index}].evidence_refs`, message: '须至少引用一个证据'});
  } else if (!hyp.evidence_refs.every((r) => typeof r === 'string' && r.trim().length > 0)) {
    issues.push({field: `hypotheses[${index}].evidence_refs`, message: '证据引用须为非空字符串'});
  }

  const claim = String(hyp.claim ?? '');
  if (MONEY_PATTERN.test(claim)) {
    issues.push({field: `hypotheses[${index}].claim`, message: 'claim 不得包含金额或价格数字（金额由确定性分析给出）'});
  }
  if (FORBIDDEN_PATTERN.test(claim)) {
    issues.push({field: `hypotheses[${index}].claim`, message: 'claim 不得包含审批/写回/SQL/ERP 指令'});
  }
  const step = String(hyp.suggested_next_step ?? '');
  if (FORBIDDEN_PATTERN.test(step)) {
    issues.push({field: `hypotheses[${index}].suggested_next_step`, message: '下一步建议不得包含审批/写回/SQL/ERP 指令'});
  }
  return issues;
}

export function validateInvestigationResult(result: unknown): InvestigationResult {
  v2assert(result !== null && typeof result === 'object', 'INVALID_AI_OUTPUT', '调查结果须为对象');
  const r = result as Record<string, unknown>;
  v2assert(typeof r.case_id === 'string', 'INVALID_AI_OUTPUT', 'case_id 缺失');
  v2assert(typeof r.summary === 'string', 'INVALID_AI_OUTPUT', 'summary 缺失');
  v2assert(Array.isArray(r.hypotheses), 'INVALID_AI_OUTPUT', 'hypotheses 须为数组');

  const allIssues: ValidationIssue[] = [];
  (r.hypotheses as unknown[]).forEach((h, i) => {
    allIssues.push(...validateHypothesis(h, i));
  });
  v2assert(allIssues.length === 0, 'INVALID_AI_OUTPUT', 'AI 输出未通过结构与语义校验', {issues: allIssues});

  if (FORBIDDEN_PATTERN.test(String(r.summary))) {
    throw new StoreV2Error('INVALID_AI_OUTPUT', 'summary 不得包含审批/写回/SQL/ERP 指令');
  }

  return result as InvestigationResult;
}
