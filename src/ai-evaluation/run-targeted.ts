#!/usr/bin/env node
/**
 * Targeted eval runner — runs only specified scenario IDs.
 * Usage: npx tsx src/ai-evaluation/run-targeted.ts A1 A2 H1
 */

import { connectDatabase, disconnectDatabase } from '../database/connection.js';
import { SCENARIOS } from './scenarios.js';
import { setupTestTenant, runScenario, cleanupTestData } from './runner.js';

const targetIds = process.argv.slice(2);
if (targetIds.length === 0) {
  console.error('Usage: npx tsx src/ai-evaluation/run-targeted.ts A1 A2 H1');
  process.exit(1);
}

async function main() {
  await connectDatabase();
  const tenant = await setupTestTenant();
  await cleanupTestData();

  let allPass = true;

  for (const id of targetIds) {
    const scenario = SCENARIOS.find(s => s.id === id);
    if (!scenario) {
      console.log(`${id}: NOT FOUND`);
      continue;
    }

    process.stdout.write(`${id} "${scenario.input.slice(0, 40)}"... `);
    const result = await runScenario(scenario, tenant);
    const failed = result.assertions.filter(a => !a.passed).map(a => a.name);

    const color = result.status === 'PASS' ? '\x1b[32m' : result.status === 'WARN' ? '\x1b[33m' : '\x1b[31m';
    console.log(
      `${color}${result.status}\x1b[0m` +
      (result.error ? ` ERROR: ${result.error}` : '') +
      (failed.length ? ` FAILED: ${failed.join(', ')}` : '') +
      ` (${(result.response_time_ms / 1000).toFixed(1)}s, ${result.tokens_used} tok)`
    );
    if (result.response) {
      console.log(`  Response: ${result.response.slice(0, 200)}`);
    }
    console.log();

    if (result.status === 'FAIL') allPass = false;

    // Small delay between scenarios
    await new Promise(r => setTimeout(r, 1000));
  }

  await cleanupTestData();
  await disconnectDatabase();
  process.exit(allPass ? 0 : 1);
}

main().catch(err => {
  console.error('Failed:', err);
  disconnectDatabase().catch(() => {});
  process.exit(2);
});
