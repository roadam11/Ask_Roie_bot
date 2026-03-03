#!/usr/bin/env node
/**
 * AI Quality Evaluation — CLI Entry Point
 *
 * Usage:
 *   npx ts-node src/ai-evaluation/run-evaluation.ts
 *   npm run ai-eval
 *
 * Runs all 25 scenarios sequentially, evaluates responses,
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

async function main(): Promise<void> {
  console.log('AI Quality Evaluation Harness');
  console.log('============================');
  console.log(`Scenarios: ${SCENARIOS.length}`);
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

  // 4. Run all scenarios sequentially
  console.log('[4/6] Running scenarios...');
  const results: ScenarioResult[] = [];

  for (let i = 0; i < SCENARIOS.length; i++) {
    const scenario = SCENARIOS[i];
    const progress = `[${String(i + 1).padStart(2)}/${SCENARIOS.length}]`;
    const inputPreview = scenario.input.slice(0, 40) || '(empty)';
    process.stdout.write(`  ${progress} ${scenario.id} "${inputPreview}"...`);

    const result = await runScenario(scenario, tenant);
    results.push(result);

    const statusColor =
      result.status === 'PASS' ? '\x1b[32m' :
      result.status === 'WARN' ? '\x1b[33m' :
      '\x1b[31m';
    const reset = '\x1b[0m';

    console.log(
      ` ${statusColor}${result.status}${reset}` +
      ` (${(result.response_time_ms / 1000).toFixed(1)}s, ${result.tokens_used} tok)` +
      (result.error ? ` ERROR: ${result.error}` : ''),
    );

    // Small delay between scenarios to be respectful to API rate limits
    if (i < SCENARIOS.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // 5. Generate report
  console.log('[5/6] Generating report...');
  const report = buildReport(results);

  // Print console report
  printReport(report);

  // Save JSON report
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');
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
