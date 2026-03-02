/**
 * Settings Service + System Prompt — Integration Tests
 *
 * Validates loadSettingsForLead DB lookups and buildPromptWithContext
 * prompt selection, placeholder replacement, and TUTOR_PROFILE injection.
 * All DB access is mocked.
 */

import type { AccountSettings } from '../../services/settings.service.js';

// ============================================================================
// Mocks — jest.mock() is hoisted above imports by the transform
// ============================================================================

jest.mock('../../database/connection.js', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
}));

jest.mock('../../utils/logger.js', () => ({
  __esModule: true,
  default: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { loadSettingsForLead } from '../../services/settings.service.js';
import { buildPromptWithContext } from '../../prompts/system-prompt.js';
import { queryOne } from '../../database/connection.js';

const mockQueryOne = queryOne as jest.Mock;

// ============================================================================
// Helpers
// ============================================================================

function makeSettings(overrides: Partial<AccountSettings> = {}): AccountSettings {
  return {
    profile: {
      companyName: 'Ask ROIE',
      ownerName: 'Roie Adam',
      phone: '+972501234567',
      email: 'roie@askroie.com',
      subjects: ['math', 'physics'],
      pricing: '150₪/hr',
    },
    behavior: {
      systemPrompt: 'Custom prompt. {{LEAD_STATE}} {{CONVERSATION_HISTORY}}',
      tone: 'friendly',
      strictness: 5,
    },
    ...overrides,
  };
}

// ============================================================================
// loadSettingsForLead
// ============================================================================

describe('loadSettingsForLead()', () => {
  it('should return AccountSettings when row exists', async () => {
    mockQueryOne.mockResolvedValueOnce({
      profile: { companyName: 'ACME' },
      behavior: { tone: 'formal' },
    });

    const result = await loadSettingsForLead('lead-1');

    expect(result).toEqual({
      profile: { companyName: 'ACME' },
      behavior: { tone: 'formal' },
    });
  });

  it('should return null when no settings row exists', async () => {
    mockQueryOne.mockResolvedValueOnce(null);

    const result = await loadSettingsForLead('lead-missing');
    expect(result).toBeNull();
  });

  it('should return null profile when profile column is SQL NULL', async () => {
    mockQueryOne.mockResolvedValueOnce({ profile: null, behavior: { tone: 'warm' } });

    const result = await loadSettingsForLead('lead-2');
    expect(result).not.toBeNull();
    expect(result!.profile).toBeNull();
    expect(result!.behavior).toEqual({ tone: 'warm' });
  });

  it('should return null behavior when behavior column is SQL NULL', async () => {
    mockQueryOne.mockResolvedValueOnce({ profile: { companyName: 'X' }, behavior: null });

    const result = await loadSettingsForLead('lead-3');
    expect(result!.behavior).toBeNull();
  });

  it('should propagate DB errors', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('timeout'));

    await expect(loadSettingsForLead('lead-err')).rejects.toThrow('timeout');
  });
});

// ============================================================================
// buildPromptWithContext — base prompt selection
// ============================================================================

describe('buildPromptWithContext()', () => {
  describe('base prompt selection', () => {
    it('should use hardcoded SYSTEM_PROMPT when settings is undefined', () => {
      const result = buildPromptWithContext([], null, undefined);
      expect(result).toContain('Ask ROIE Bot');
    });

    it('should use hardcoded SYSTEM_PROMPT when settings is null', () => {
      const result = buildPromptWithContext([], null, null);
      expect(result).toContain('Ask ROIE Bot');
    });

    it('should use hardcoded SYSTEM_PROMPT when behavior is null', () => {
      const settings = makeSettings({ behavior: null });
      const result = buildPromptWithContext([], null, settings);
      expect(result).toContain('Ask ROIE Bot');
    });

    it('should use hardcoded SYSTEM_PROMPT when behavior.systemPrompt is undefined', () => {
      const settings = makeSettings({ behavior: { systemPrompt: undefined } });
      const result = buildPromptWithContext([], null, settings);
      expect(result).toContain('Ask ROIE Bot');
    });

    it('should use hardcoded SYSTEM_PROMPT when behavior.systemPrompt is empty string', () => {
      const settings = makeSettings({ behavior: { systemPrompt: '' } });
      const result = buildPromptWithContext([], null, settings);
      expect(result).toContain('Ask ROIE Bot');
    });

    it('should use hardcoded SYSTEM_PROMPT when behavior.systemPrompt is whitespace-only', () => {
      const settings = makeSettings({ behavior: { systemPrompt: '   ' } });
      const result = buildPromptWithContext([], null, settings);
      expect(result).toContain('Ask ROIE Bot');
    });

    it('should use custom prompt when behavior.systemPrompt is a non-empty string', () => {
      const settings = makeSettings({
        behavior: { systemPrompt: 'My custom prompt here. {{LEAD_STATE}} {{CONVERSATION_HISTORY}}' },
      });
      const result = buildPromptWithContext([], null, settings);
      expect(result).toContain('My custom prompt here.');
      expect(result).not.toContain('Ask ROIE Bot');
    });
  });

  // --------------------------------------------------------------------------
  // Placeholder replacement
  // --------------------------------------------------------------------------

  describe('placeholder replacement', () => {
    it('should replace {{LEAD_STATE}} in hardcoded prompt', () => {
      const result = buildPromptWithContext([], { name: 'Yossi', status: 'qualified' });
      expect(result).toContain('Yossi');
      expect(result).toContain('qualified');
      expect(result).not.toContain('{{LEAD_STATE}}');
    });

    it('should replace {{CONVERSATION_HISTORY}} in hardcoded prompt', () => {
      const history = [{ role: 'user' as const, content: 'שלום' }];
      const result = buildPromptWithContext(history, null);
      expect(result).toContain('שלום');
      expect(result).not.toContain('{{CONVERSATION_HISTORY}}');
    });

    it('should replace both placeholders in a custom prompt', () => {
      const settings = makeSettings({
        behavior: { systemPrompt: 'State: {{LEAD_STATE}} | History: {{CONVERSATION_HISTORY}}' },
      });
      const history = [{ role: 'user' as const, content: 'Hello' }];
      const result = buildPromptWithContext(history, { name: 'Dan' }, settings);

      expect(result).toContain('Dan');
      expect(result).toContain('Hello');
      expect(result).not.toContain('{{LEAD_STATE}}');
      expect(result).not.toContain('{{CONVERSATION_HISTORY}}');
    });
  });

  // --------------------------------------------------------------------------
  // TUTOR_PROFILE block
  // --------------------------------------------------------------------------

  describe('TUTOR_PROFILE block', () => {
    it('should append <TUTOR_PROFILE> when profile exists with data', () => {
      const settings = makeSettings();
      const result = buildPromptWithContext([], null, settings);
      expect(result).toContain('<TUTOR_PROFILE>');
      expect(result).toContain('Roie Adam');
      expect(result).toContain('</TUTOR_PROFILE>');
    });

    it('should include tone from behavior in TUTOR_PROFILE', () => {
      const settings = makeSettings({ behavior: { tone: 'warm' } });
      const result = buildPromptWithContext([], null, settings);
      expect(result).toContain('טון: warm');
    });

    it('should NOT append TUTOR_PROFILE when profile is null', () => {
      const settings = makeSettings({ profile: null });
      const result = buildPromptWithContext([], null, settings);
      expect(result).not.toContain('<TUTOR_PROFILE>');
    });

    it('should NOT append TUTOR_PROFILE when settings is null', () => {
      const result = buildPromptWithContext([], null, null);
      expect(result).not.toContain('<TUTOR_PROFILE>');
    });

    it('should NOT append TUTOR_PROFILE when profile has only empty/whitespace fields', () => {
      const settings = makeSettings({
        profile: {
          companyName: '',
          ownerName: '  ',
          phone: '',
          email: '',
          subjects: [],
          pricing: '',
        },
        behavior: { tone: '' },
      });
      const result = buildPromptWithContext([], null, settings);
      expect(result).not.toContain('<TUTOR_PROFILE>');
    });
  });
});
