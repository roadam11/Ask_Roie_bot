/**
 * Model Router — Select AI model based on conversation context.
 *
 * NOTE: This is NOT wired into production yet.
 * To activate, change DEFAULT_MODEL logic in claude.service.ts.
 * First, run eval with Haiku to verify quality:
 *   AI_MODEL=claude-haiku-4-5-20251001 npm run ai-eval
 */

const SONNET = 'claude-sonnet-4-20250514';
const HAIKU = 'claude-haiku-4-5-20251001';

/**
 * Select model based on message complexity and conversation length.
 * Uses Sonnet for complex objection-handling scenarios, Haiku for simple ones.
 */
export function selectModel(userMessage: string, conversationLength: number): string {
  const complexKeywords = ['יקר', 'יותר זול', 'מתלונן', 'לא מרוצה', 'הנחה', 'בודק מחירים'];
  const isComplex = complexKeywords.some(kw => userMessage.includes(kw));
  const isLongConversation = conversationLength > 6;

  if (isComplex || isLongConversation) {
    return SONNET;
  }
  return HAIKU;
}

export { SONNET, HAIKU };
