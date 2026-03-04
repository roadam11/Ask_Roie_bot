#!/usr/bin/env node
/**
 * Quick 3-scenario test for frontal pricing, availability, and emoji policy.
 */

import { connectDatabase, disconnectDatabase, query, queryOne } from '../database/connection.js';
import { sendMessageWithToolLoop } from '../services/claude.service.js';
import type { ToolExecutor } from '../services/claude.service.js';
import type { Lead } from '../types/index.js';

const TEST_PHONE = '0500000099';

async function main() {
  await connectDatabase();

  const agent = await queryOne<{ id: string; account_id: string }>(
    'SELECT id, account_id FROM agents LIMIT 1'
  );
  if (!agent) { console.error('No agent found'); process.exit(1); }

  const scenarios = [
    { id: 'A', input: 'כמה עולה שיעור פרונטלי?', check: 'FRONTAL_PRICING' },
    { id: 'B', input: 'מתי אפשר להתחיל?', check: 'AVAILABILITY' },
    { id: 'C', input: 'היי', check: 'EMOJI_COUNT' },
  ];

  const noopExecutor: ToolExecutor = async (_toolCall) => ({
    result: JSON.stringify({ success: true }),
    isError: false,
  });

  for (const scenario of scenarios) {
    const leadRes = await queryOne<{ id: string }>(
      `INSERT INTO leads (phone, name, is_demo, agent_id, status, lead_state)
       VALUES ($1, $2, true, $3, 'new', 'new') RETURNING id`,
      [TEST_PHONE, `TEST_FIX_${scenario.id}`, agent.id]
    );
    if (!leadRes) { console.error(`Failed to create lead for ${scenario.id}`); continue; }

    const lead: Lead = {
      id: leadRes.id,
      phone: TEST_PHONE,
      name: `TEST_FIX_${scenario.id}`,
      status: 'new',
      is_demo: true,
      created_at: new Date(),
      updated_at: new Date(),
    };

    try {
      const result = await sendMessageWithToolLoop(
        lead,
        [{ role: 'user', content: scenario.input }],
        noopExecutor,
      );

      console.log(`\n=== Test ${scenario.id}: "${scenario.input}" ===`);
      console.log(`Response: ${result.content}`);

      if (scenario.check === 'FRONTAL_PRICING') {
        const hasMinimum = result.content.includes('מינימום') || result.content.includes('שעתיים');
        const has170 = result.content.includes('170');
        console.log(`✓ Contains 170: ${has170}`);
        console.log(`✓ Contains מינימום/שעתיים: ${hasMinimum}`);
        console.log(has170 && hasMinimum ? '→ PASS' : '→ FAIL');
      }

      if (scenario.check === 'AVAILABILITY') {
        const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
        const suggestsDay = days.some(d => result.content.includes(`יום ${d}`));
        const suggestsHour = /\d{1,2}:\d{2}/.test(result.content);
        console.log(`✓ Suggests specific day: ${suggestsDay} (should be false)`);
        console.log(`✓ Suggests specific hour: ${suggestsHour} (should be false)`);
        console.log(!suggestsDay && !suggestsHour ? '→ PASS' : '→ FAIL');
      }

      if (scenario.check === 'EMOJI_COUNT') {
        const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{231A}-\u{231B}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{25AA}-\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}\u{2614}-\u{2615}\u{2648}-\u{2653}\u{267F}\u{2693}\u{26A1}\u{26AA}-\u{26AB}\u{26BD}-\u{26BE}\u{26C4}-\u{26C5}\u{26CE}\u{26D4}\u{26EA}\u{26F2}-\u{26F3}\u{26F5}\u{26FA}\u{26FD}\u{2702}\u{2705}\u{2708}-\u{270D}\u{270F}]/gu;
        const emojis = result.content.match(emojiRegex) || [];
        console.log(`✓ Emoji count: ${emojis.length} (should be ≤1)`);
        console.log(`  Emojis found: ${emojis.join(' ') || '(none)'}`);
        console.log(emojis.length <= 1 ? '→ PASS' : '→ FAIL');
      }
    } catch (err) {
      console.log(`\n=== Test ${scenario.id}: "${scenario.input}" ===`);
      console.log(`ERROR: ${(err as Error).message}`);
    } finally {
      await query('DELETE FROM messages WHERE lead_id = $1', [leadRes.id]);
      await query('DELETE FROM leads WHERE id = $1', [leadRes.id]);
    }
  }

  await disconnectDatabase();
}

main().catch(e => { console.error(e); process.exit(1); });
