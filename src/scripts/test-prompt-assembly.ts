#!/usr/bin/env node
/**
 * Test script: shows the exact assembled prompt the bot receives.
 * Proves the architecture: HARD_CONSTRAINTS → GENERIC → CUSTOM → TUTOR_PROFILE
 */

import { connectDatabase, disconnectDatabase, query, queryOne } from '../database/connection.js';
import { buildPromptWithContext } from '../prompts/system-prompt.js';
import { loadSettingsForLead } from '../services/settings.service.js';

async function main() {
  await connectDatabase();

  const agent = await queryOne<{ id: string; account_id: string }>(
    'SELECT id, account_id FROM agents LIMIT 1'
  );
  if (!agent) { console.error('No agent found'); process.exit(1); }

  const lead = await queryOne<{ id: string }>(
    `INSERT INTO leads (phone, name, is_demo, agent_id, status, lead_state)
     VALUES ('0500000099', 'PROMPT_TEST', true, $1, 'new', 'new') RETURNING id`,
    [agent.id]
  );
  if (!lead) { console.error('Failed to create lead'); process.exit(1); }

  const settings = await loadSettingsForLead(lead.id);

  console.log('=== SETTINGS LOADED ===');
  console.log('Has custom prompt:', !!settings?.behavior?.systemPrompt);
  console.log('Custom prompt:', settings?.behavior?.systemPrompt?.slice(0, 200));
  console.log('Credentials field:', JSON.stringify((settings?.profile as Record<string, unknown>)?.credentials));
  console.log('Experience field:', JSON.stringify((settings?.profile as Record<string, unknown>)?.experience));
  console.log();

  const fullPrompt = buildPromptWithContext(
    [{ role: 'user', content: 'יש לך תואר?' }],
    { id: lead.id, phone: '0500000099', name: 'PROMPT_TEST', status: 'new' as const },
    settings
  );

  console.log('=== FULL ASSEMBLED PROMPT ===');
  console.log(fullPrompt);
  console.log();
  console.log('=== PROMPT LENGTH:', fullPrompt.length, 'chars ===');
  console.log();

  const lines = fullPrompt.split('\n');
  const toarLines = lines.filter(l => l.includes('תואר'));
  console.log('=== LINES CONTAINING "תואר" ===');
  toarLines.forEach((l, i) => console.log(`  ${i + 1}: ${l.trim()}`));
  console.log();

  console.log('=== ARCHITECTURE CHECK ===');
  console.log('Part A — HARD RULES present:', fullPrompt.includes('=== HARD RULES'));
  console.log('Part B — GENERIC (# ROLE) present:', fullPrompt.includes('# ROLE'));
  console.log('Part C — ADDITIONAL TEACHER present:', fullPrompt.includes('=== ADDITIONAL TEACHER'));
  console.log('Part D — TUTOR_PROFILE present:', fullPrompt.includes('<TUTOR_PROFILE>'));

  await query('DELETE FROM leads WHERE id = $1', [lead.id]);
  await disconnectDatabase();
}

main().catch(e => { console.error(e); process.exit(1); });
