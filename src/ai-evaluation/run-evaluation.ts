#!/usr/bin/env node
/**
 * AI Quality Evaluation — CLI Entry Point
 *
 * Usage:
 *   npm run ai-eval                 # Single run (default)
 *   npm run ai-eval -- --runs 3     # Multi-run stability test
 *
 * Runs all scenarios sequentially, evaluates responses,
 * generates console + JSON report, and cleans up test data.
 *
 * Exit code 0 if pass rate >= 80%, exit code 1 otherwise.
 */

import { connectDatabase, disconnectDatabase } from '../database/connection.js';
import { SCENARIOS } from './scenarios.js';
import { setupTestTenant, runScenario, cleanupTestData } from './runner.js';
import type { ScenarioResult } from './runner.js';
import { buildReport, printReport } from './report.js';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPORT_PATH = resolve(
  import.meta.dirname ?? new URL('.', import.meta.url).pathname,
  'evaluation-report.json',
);

// Parse --runs flag
function parseRuns(): number {
  const idx = process.argv.indexOf('--runs');
  if (idx !== -1 && process.argv[idx + 1]) {
    return Math.max(1, parseInt(process.argv[idx + 1], 10) || 1);
  }
  const eqFlag = process.argv.find((a) => a.startsWith('--runs='));
  if (eqFlag) {
    return Math.max(1, parseInt(eqFlag.split('=')[1], 10) || 1);
  }
  return 1;
}

async function runSinglePass(
  tenant: { accountId: string; agentId: string },
  runNumber: number,
  totalRuns: number,
): Promise<ScenarioResult[]> {
  const label = totalRuns > 1 ? ` (Run ${runNumber}/${totalRuns})` : '';
  console.log(`\nRunning ${SCENARIOS.length} scenarios${label}...`);

  const results: ScenarioResult[] = [];

  for (let i = 0; i < SCENARIOS.length; i++) {
    const scenario = SCENARIOS[i];
    const progress = `[${String(i + 1).padStart(2)}/${SCENARIOS.length}]`;
    const inputPreview = scenario.input.slice(0, 40) || '(empty)';
    process.stdout.write(`  ${progress} ${scenario.id} "${inputPreview}"...`);

    const result = await runScenario(scenario, tenant);
    results.push(result);

    const statusColor =
      result.status === 'PASS'
        ? '\x1b[32m'
        : result.status === 'WARN'
          ? '\x1b[33m'
          : '\x1b[31m';
    const reset = '\x1b[0m';

    console.log(
      ` ${statusColor}${result.status}${reset}` +
        ` (${(result.response_time_ms / 1000).toFixed(1)}s, ${result.tokens_used} tok)` +
        (result.error ? ` ERROR: ${result.error}` : ''),
    );

    // Small delay between scenarios to be respectful to API rate limits
    if (i < SCENARIOS.length - 1) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  return results;
}

function printStabilityReport(allRuns: ScenarioResult[][], totalRuns: number): void {
  const line = '═'.repeat(60);

  console.log('');
  console.log(line);
  console.log(`STABILITY REPORT (${totalRuns} runs × ${SCENARIOS.length} scenarios = ${totalRuns * SCENARIOS.length} executions)`);
  console.log(line);

  // Per-run summary
  for (let r = 0; r < totalRuns; r++) {
    const run = allRuns[r];
    const pass = run.filter((s) => s.status === 'PASS').length;
    const fail = run.filter((s) => s.status === 'FAIL').length;
    const warn = run.filter((s) => s.status === 'WARN').length;
    const pct = Math.round((pass / run.length) * 100);
    console.log(`Run ${r + 1}: ${pct}% PASS | ${fail} FAIL | ${warn} WARN`);
  }

  // Variance by scenario
  console.log('');
  console.log('VARIANCE BY SCENARIO:');

  const scenarioIds = SCENARIOS.map((s) => s.id);
  const stable: string[] = [];
  const flaky: string[] = [];
  const unstable: string[] = [];
  const consistentFail: string[] = [];

  for (const id of scenarioIds) {
    let passes = 0;
    for (let r = 0; r < totalRuns; r++) {
      const result = allRuns[r].find((s) => s.id === id);
      if (result && result.status === 'PASS') passes++;
    }

    if (passes === totalRuns) stable.push(id);
    else if (passes === totalRuns - 1) flaky.push(id);
    else if (passes === 0) consistentFail.push(id);
    else unstable.push(id);
  }

  console.log(`  Stable (${totalRuns}/${totalRuns} PASS):     ${stable.length} scenarios`);
  console.log(
    `  Flaky (${totalRuns - 1}/${totalRuns} PASS):      ${flaky.length} scenarios${flaky.length > 0 ? ' — ' + flaky.join(', ') : ''}`,
  );
  console.log(
    `  Unstable (1/${totalRuns} PASS):   ${unstable.length} scenarios${unstable.length > 0 ? ' — ' + unstable.join(', ') : ''}`,
  );
  console.log(
    `  Consistent FAIL (0/${totalRuns}): ${consistentFail.length} scenarios${consistentFail.length > 0 ? ' — ' + consistentFail.join(', ') : ''}`,
  );

  const stabilityRate = Math.round((stable.length / scenarioIds.length) * 100);
  console.log('');
  console.log(`OVERALL STABILITY: ${stabilityRate}% (${stable.length}/${scenarioIds.length} scenarios passed all ${totalRuns} runs)`);
  console.log(`Target ≥ 95%: ${stabilityRate >= 95 ? 'YES ✓' : 'NO ✗'}`);
  console.log(`Zero unstable (0/${totalRuns}) scenarios: ${consistentFail.length === 0 ? 'YES ✓' : 'NO ✗'}`);
  console.log(line);

  // Log flaky details
  if (flaky.length > 0) {
    console.log('');
    console.log('FLAKY SCENARIO DETAILS:');
    for (const id of flaky) {
      for (let r = 0; r < totalRuns; r++) {
        const result = allRuns[r].find((s) => s.id === id);
        if (result && result.status !== 'PASS') {
          const failedAssertions = result.assertions
            .filter((a) => !a.passed)
            .map((a) => a.name)
            .join(', ');
          console.log(`  ${id} — Run ${r + 1}: ${result.status} — failed: ${failedAssertions}`);
          console.log(`    Response: ${result.response.slice(0, 120)}...`);
        }
      }
    }
  }
}

async function main(): Promise<void> {
  const RUNS = parseRuns();

  console.log('AI Quality Evaluation Harness');
  console.log('============================');
  console.log(`Scenarios: ${SCENARIOS.length}`);
  console.log(`Runs: ${RUNS}`);
  console.log('');

  // 1. Connect to database
  console.log('[1/6] Connecting to database...');
  await connectDatabase();
  console.log('      Connected.');

  // 2. Set up test tenant
  console.log('[2/6] Setting up test tenant...');
  const tenant = await setupTestTenant();
  console.log(`      Account: ${tenant.accountId}`);
  console.log(`      Agent:   ${tenant.agentId}`);

  // 3. Clean up any leftover test data
  console.log('[3/6] Cleaning up leftover test data...');
  const cleaned = await cleanupTestData();
  if (cleaned > 0) {
    console.log(`      Cleaned ${cleaned} leftover test leads.`);
  }

  // 4. Run all scenarios (potentially multiple runs)
  console.log('[4/6] Running scenarios...');
  const allRuns: ScenarioResult[][] = [];

  for (let run = 1; run <= RUNS; run++) {
    const results = await runSinglePass(tenant, run, RUNS);
    allRuns.push(results);
  }

  // Use last run for the main report (or single run)
  const lastRunResults = allRuns[allRuns.length - 1];

  // 5. Generate report
  console.log('[5/6] Generating report...');
  const report = buildReport(lastRunResults);

  // Print console report
  printReport(report);

  // Print stability report if multi-run
  if (RUNS > 1) {
    printStabilityReport(allRuns, RUNS);
  }

  // Save JSON report (include all runs if multi-run)
  const fullReport = RUNS > 1
    ? { ...report, stabilityRuns: allRuns.map((run, i) => ({ run: i + 1, results: run })) }
    : report;
  writeFileSync(REPORT_PATH, JSON.stringify(fullReport, null, 2), 'utf-8');
  console.log(`JSON report saved to: ${REPORT_PATH}`);

  // 6. Final cleanup (safety net)
  console.log('[6/6] Final cleanup...');
  const finalCleaned = await cleanupTestData();
  if (finalCleaned > 0) {
    console.log(`      Cleaned ${finalCleaned} remaining test leads.`);
  }

  // Disconnect
  await disconnectDatabase();
  console.log('      Done.');

  // Exit code based on pass rate
  const exitCode = report.passRate >= 80 ? 0 : 1;
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('Evaluation failed:', err);
  disconnectDatabase().catch(() => {});
  process.exit(2);
});
