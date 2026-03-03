/**
 * AI Quality Evaluation — Report Generator
 *
 * Generates console output and JSON report from evaluation results.
 */

import type { ScenarioResult } from './runner.js';
import type { FailureType } from './evaluator.js';
import { GROUPS } from './scenarios.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface EvaluationReport {
  timestamp: string;
  totalScenarios: number;
  pass: number;
  warn: number;
  fail: number;
  passRate: number;
  avgResponseTimeMs: number;
  avgTokens: number;
  hallucinations: number;
  missingCta: number;
  identityLeaks: number;
  groups: GroupSummary[];
  worstScenarios: WorstScenario[];
  recommendations: string[];
  results: ScenarioResult[];
}

interface GroupSummary {
  id: string;
  label: string;
  pass: number;
  warn: number;
  fail: number;
  total: number;
  failureDetails: string[];
}

interface WorstScenario {
  id: string;
  input: string;
  status: string;
  failureTypes: string[];
  failedAssertions: string[];
}

// ── Build Report ─────────────────────────────────────────────────────────────

export function buildReport(results: ScenarioResult[]): EvaluationReport {
  const totalScenarios = results.length;
  const pass = results.filter((r) => r.status === 'PASS').length;
  const warn = results.filter((r) => r.status === 'WARN').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const passRate = totalScenarios > 0 ? Math.round((pass / totalScenarios) * 100) : 0;

  const totalResponseTime = results.reduce((sum, r) => sum + r.response_time_ms, 0);
  const totalTokens = results.reduce((sum, r) => sum + r.tokens_used, 0);
  const avgResponseTimeMs = totalScenarios > 0 ? Math.round(totalResponseTime / totalScenarios) : 0;
  const avgTokens = totalScenarios > 0 ? Math.round(totalTokens / totalScenarios) : 0;

  // Count failure types
  const allFailures = results.flatMap((r) => r.failure_types);
  const hallucinations = allFailures.filter((f) => f === 'F1_HALLUCINATION').length;
  const missingCta = allFailures.filter((f) => f === 'F3_MISSING_CTA').length;
  const identityLeaks = allFailures.filter((f) => f === 'F4_IDENTITY_LEAK').length;

  // Group summaries
  const groups: GroupSummary[] = GROUPS.map((g) => {
    const groupResults = results.filter((r) => r.group === g.id);
    const gPass = groupResults.filter((r) => r.status === 'PASS').length;
    const gWarn = groupResults.filter((r) => r.status === 'WARN').length;
    const gFail = groupResults.filter((r) => r.status === 'FAIL').length;

    const failureDetails: string[] = [];
    for (const r of groupResults) {
      if (r.status !== 'PASS') {
        const failedNames = r.assertions
          .filter((a) => !a.passed)
          .map((a) => a.name);
        failureDetails.push(`${r.id}: ${r.status} — ${failedNames.join(', ')}`);
      }
    }

    return {
      id: g.id,
      label: g.label,
      pass: gPass,
      warn: gWarn,
      fail: gFail,
      total: groupResults.length,
      failureDetails,
    };
  });

  // Worst scenarios (FAIL first, then WARN)
  const worstScenarios: WorstScenario[] = results
    .filter((r) => r.status !== 'PASS')
    .sort((a, b) => {
      if (a.status === 'FAIL' && b.status !== 'FAIL') return -1;
      if (a.status !== 'FAIL' && b.status === 'FAIL') return 1;
      return a.binary_pass_rate - b.binary_pass_rate;
    })
    .slice(0, 5)
    .map((r) => ({
      id: r.id,
      input: r.input.slice(0, 60),
      status: r.status,
      failureTypes: r.failure_types,
      failedAssertions: r.assertions.filter((a) => !a.passed).map((a) => a.name),
    }));

  // Recommendations based on failure patterns
  const recommendations = generateRecommendations(results, allFailures);

  return {
    timestamp: new Date().toISOString(),
    totalScenarios,
    pass,
    warn,
    fail,
    passRate,
    avgResponseTimeMs,
    avgTokens,
    hallucinations,
    missingCta,
    identityLeaks,
    groups,
    worstScenarios,
    recommendations,
    results,
  };
}

// ── Recommendations ──────────────────────────────────────────────────────────

function generateRecommendations(
  results: ScenarioResult[],
  allFailures: FailureType[],
): string[] {
  const recs: string[] = [];

  if (allFailures.includes('F3_MISSING_CTA')) {
    recs.push('Add explicit instruction: "Always end with a call-to-action or next step"');
  }

  if (allFailures.includes('F2_OVERPROMISE')) {
    recs.push('Add constraint: "Never promise specific time slots or give unauthorized discounts"');
  }

  if (allFailures.includes('F1_HALLUCINATION')) {
    recs.push('Add constraint: "Only mention numbers that appear in the TUTOR_PROFILE"');
  }

  if (allFailures.includes('F4_IDENTITY_LEAK')) {
    recs.push('Strengthen identity guardrail: "Never reveal you are AI or a language model"');
  }

  if (allFailures.includes('F5_TONE_ISSUE')) {
    recs.push('Add instruction: "When compared to competitors, highlight unique value without disparaging"');
  }

  // Check for missing value highlight in objection scenarios
  const objectionResults = results.filter((r) => r.group === 'objection');
  const missingValue = objectionResults.some((r) =>
    r.assertions.some((a) => a.name === 'highlights_value' && !a.passed),
  );
  if (missingValue) {
    recs.push('Add instruction: "When handling price objections, always mention WhatsApp support USP"');
  }

  // Check for empty input handling
  const emptyResult = results.find((r) => r.id === 'E4');
  if (emptyResult && emptyResult.status !== 'PASS') {
    recs.push('Add fallback for empty/whitespace input: "If message is empty, ask: מה אפשר לעזור?"');
  }

  if (recs.length === 0) {
    recs.push('All categories passed — consider adding more challenging adversarial scenarios');
  }

  return recs;
}

// ── Console Output ───────────────────────────────────────────────────────────

export function printReport(report: EvaluationReport): void {
  const line = '═'.repeat(52);
  const thinLine = '─'.repeat(52);

  console.log('');
  console.log(`╔${line}╗`);
  console.log(`║         AI QUALITY EVALUATION REPORT              ║`);
  console.log(`╠${line}╣`);
  console.log(`║ Total scenarios:  ${pad(report.totalScenarios, 4)}                             ║`);
  console.log(`║ PASS:            ${pad(report.pass, 4)} (${pad(report.passRate, 3)}%)                        ║`);
  console.log(`║ WARN:            ${pad(report.warn, 4)} (${pad(Math.round((report.warn / report.totalScenarios) * 100), 3)}%)                        ║`);
  console.log(`║ FAIL:            ${pad(report.fail, 4)} (${pad(Math.round((report.fail / report.totalScenarios) * 100), 3)}%)                        ║`);
  console.log(`║ Avg response:    ${pad((report.avgResponseTimeMs / 1000).toFixed(1), 5)}s                          ║`);
  console.log(`║ Avg tokens:      ${pad(report.avgTokens, 5)}                            ║`);
  console.log(`║ Hallucinations:  ${pad(report.hallucinations, 4)}                             ║`);
  console.log(`╚${line}╝`);

  console.log('');
  console.log('GROUP BREAKDOWN:');
  for (const g of report.groups) {
    let detail = `  ${g.label} (${g.id}):`.padEnd(24);
    detail += `${g.pass}/${g.total} PASS`;
    if (g.warn > 0) detail += `, ${g.warn} WARN`;
    if (g.fail > 0) detail += `, ${g.fail} FAIL`;
    if (g.failureDetails.length > 0) {
      detail += ` — ${g.failureDetails[0]}`;
    }
    console.log(detail);
  }

  if (report.worstScenarios.length > 0) {
    console.log('');
    console.log('WORST SCENARIOS:');
    for (let i = 0; i < report.worstScenarios.length; i++) {
      const s = report.worstScenarios[i];
      console.log(
        `  ${i + 1}. ${s.id} "${s.input}" — ${s.status} — ${s.failedAssertions.join(', ')}`,
      );
    }
  }

  console.log('');
  console.log('PROMPT IMPROVEMENT RECOMMENDATIONS:');
  for (let i = 0; i < report.recommendations.length; i++) {
    console.log(`  ${i + 1}. ${report.recommendations[i]}`);
  }

  console.log('');
  console.log(thinLine);
  console.log(
    report.passRate >= 80
      ? '  RESULT: PASS (pass rate >= 80%)'
      : '  RESULT: FAIL (pass rate < 80%)',
  );
  console.log(thinLine);
  console.log('');
}

function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}
