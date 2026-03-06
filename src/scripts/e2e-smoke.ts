/**
 * E2E Smoke Test Script
 *
 * Validates the full ConversAI system end-to-end:
 *   Phase 1: Health & Connectivity
 *   Phase 2: Authentication
 *   Phase 3: CRM Data
 *   Phase 4: Analytics
 *   Phase 5: Telemetry
 *   Phase 6: Settings Round-Trip
 *
 * Usage:
 *   npx tsx src/scripts/e2e-smoke.ts http://localhost:3000
 *   npx tsx src/scripts/e2e-smoke.ts https://your-deployment-url.up.railway.app
 *   npm run e2e -- http://localhost:3000
 *
 * Environment variables (with fallback defaults):
 *   ADMIN_EMAIL    — login email    (default: admin@conversai.com)
 *   ADMIN_PASSWORD — login password (default: Admin1234!)
 */

// ============================================================================
// Types
// ============================================================================

interface TestResult {
  name: string;
  passed: boolean;
  status: number | null;
  ms: number;
  detail: string;
  error?: string;
}

interface HealthResponse {
  status: string;
  timestamp?: string;
  uptime?: number;
}

interface ReadyResponse {
  status: string;
  postgres: string;
  redis: string;
}

interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    accountId: string;
    role: string;
  };
}

interface MeResponse {
  user: {
    id: string;
    email: string;
    accountId: string;
    role: string;
    name: string;
  };
}

interface LeadItem {
  id: string;
  phone: string;
  name: string | null;
  status: string;
}

interface LeadsResponse {
  items: LeadItem[];
  total: number;
}

interface ConversationItem {
  id: string;
  leadId: string;
  leadName: string;
  status: string;
}

interface OverviewResponse {
  revenue: unknown[];
  funnel: unknown[];
  aiPerformance: {
    totalMessagesHandled: number;
    humanTakeoverRate: number;
    hoursSaved: number;
  };
  activity: unknown[];
}

interface DashboardResponse {
  period: string;
  stats: {
    totalLeads: number;
    activeConversations: number;
    messagesInPeriod: number;
    aiResponsesInPeriod: number;
  };
  aiPerformance: {
    avgLatencyMs: number;
    avgTokens: number;
    totalCostUsd: number;
    fallbackRate: number;
  };
  funnel: unknown[];
  messagesPerDay: unknown[];
  intentDistribution?: unknown[];
  channelDistribution?: unknown[];
}

interface TelemetryResponse {
  telemetry: unknown[];
}

interface SettingsResponse {
  profile: Record<string, unknown>;
  behavior: Record<string, unknown>;
  knowledge: unknown[];
  lastSavedAt: string;
}

interface ErrorBody {
  error?: string;
  code?: string;
  message?: string;
}

// ============================================================================
// Config
// ============================================================================

const BASE_URL = process.argv[2];
if (!BASE_URL) {
  console.error('Usage: npx tsx src/scripts/e2e-smoke.ts <base-url>');
  console.error('  e.g. npx tsx src/scripts/e2e-smoke.ts http://localhost:3000');
  process.exit(1);
}

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@conversai.com';
const ADMIN_PASS  = process.env.ADMIN_PASSWORD || 'Admin1234!';

// ============================================================================
// Helpers
// ============================================================================

const results: TestResult[] = [];
let accessToken = '';

async function request(
  method: string,
  path: string,
  options?: {
    body?: Record<string, unknown>;
    auth?: boolean;
    expectStatus?: number;
  },
): Promise<{ status: number; body: unknown; ms: number }> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (options?.auth && accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const start = Date.now();
  const res = await fetch(url, {
    method,
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  const ms = Date.now() - start;

  let body: unknown;
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    body = await res.json();
  } else {
    body = await res.text();
  }

  return { status: res.status, body, ms };
}

function pass(name: string, status: number, ms: number, detail: string): void {
  results.push({ name, passed: true, status, ms, detail });
  console.log(`  \u2705 ${name} \u2192 ${status} ${detail} (${ms}ms)`);
}

function extractErrorMessage(err: unknown): string {
  const e = err as Error & { cause?: Error };
  const msg = e.message ?? String(err);
  if (e.cause) {
    const causeMsg = e.cause.message ?? String(e.cause);
    return `${msg} → ${causeMsg}`;
  }
  return msg;
}

function fail(name: string, status: number | null, ms: number, detail: string, error?: string): void {
  results.push({ name, passed: false, status, ms, detail, error });
  console.log(`  \u274c ${name} \u2192 ${status ?? 'ERR'} ${detail} (${ms}ms)`);
  if (error) console.log(`     ${error}`);
}

// ============================================================================
// Phase 1: Health & Connectivity
// ============================================================================

async function phase1(): Promise<void> {
  console.log('\nPhase 1: Health & Connectivity');

  // GET /health
  {
    const name = 'GET /health';
    try {
      const { status, body, ms } = await request('GET', '/health');
      const data = body as HealthResponse;
      if (status === 200 && data.status === 'ok') {
        pass(name, status, ms, `status=${data.status}`);
      } else {
        fail(name, status, ms, `unexpected: status=${data.status}`);
      }
    } catch (err) {
      fail(name, null, 0, 'connection failed', extractErrorMessage(err));
    }
  }

  // GET /health/ready
  {
    const name = 'GET /health/ready';
    try {
      const { status, body, ms } = await request('GET', '/health/ready');
      const data = body as ReadyResponse;
      if (status === 200 && data.status === 'ready') {
        pass(name, status, ms, `pg=${data.postgres}, redis=${data.redis}`);
      } else {
        fail(name, status, ms, `status=${data.status}, pg=${data.postgres}, redis=${data.redis}`);
      }
    } catch (err) {
      fail(name, null, 0, 'connection failed', extractErrorMessage(err));
    }
  }

  // GET / (root)
  {
    const name = 'GET / (root)';
    try {
      const { status, body, ms } = await request('GET', '/');
      const data = body as Record<string, unknown>;
      if (status === 200 && data.name) {
        pass(name, status, ms, `name=${data.name}`);
      } else {
        fail(name, status, ms, 'unexpected response');
      }
    } catch (err) {
      fail(name, null, 0, 'connection failed', extractErrorMessage(err));
    }
  }
}

// ============================================================================
// Phase 2: Authentication
// ============================================================================

async function phase2(): Promise<void> {
  console.log('\nPhase 2: Authentication');

  // POST /api/auth/login
  {
    const name = 'POST /api/auth/login';
    try {
      const { status, body, ms } = await request('POST', '/api/auth/login', {
        body: { email: ADMIN_EMAIL, password: ADMIN_PASS },
      });
      const data = body as LoginResponse;
      if (status === 200 && data.accessToken) {
        accessToken = data.accessToken;
        pass(name, status, ms, `token received, user=${data.user.email}`);
      } else {
        const errData = body as ErrorBody;
        fail(name, status, ms, `login failed: ${errData.error ?? 'unknown'}`);
      }
    } catch (err) {
      fail(name, null, 0, 'request failed', extractErrorMessage(err));
    }
  }

  // GET /api/auth/me (with valid token)
  {
    const name = 'GET /api/auth/me (authenticated)';
    try {
      const { status, body, ms } = await request('GET', '/api/auth/me', { auth: true });
      const data = body as MeResponse;
      if (status === 200 && data.user) {
        pass(name, status, ms, `user=${data.user.email}, role=${data.user.role}`);
      } else {
        fail(name, status, ms, 'unexpected response');
      }
    } catch (err) {
      fail(name, null, 0, 'request failed', extractErrorMessage(err));
    }
  }

  // GET /api/auth/me (no token — expect 401)
  {
    const name = 'GET /api/auth/me (no token)';
    try {
      const { status, ms } = await request('GET', '/api/auth/me');
      if (status === 401) {
        pass(name, status, ms, 'correctly rejected');
      } else {
        fail(name, status, ms, `expected 401, got ${status}`);
      }
    } catch (err) {
      fail(name, null, 0, 'request failed', extractErrorMessage(err));
    }
  }

  // GET /api/auth/me (invalid token — expect 401)
  {
    const name = 'GET /api/auth/me (invalid token)';
    try {
      const savedToken = accessToken;
      accessToken = 'invalid.jwt.token';
      const { status, ms } = await request('GET', '/api/auth/me', { auth: true });
      accessToken = savedToken;
      if (status === 401) {
        pass(name, status, ms, 'correctly rejected');
      } else {
        fail(name, status, ms, `expected 401, got ${status}`);
      }
    } catch (err) {
      fail(name, null, 0, 'request failed', extractErrorMessage(err));
    }
  }
}

// ============================================================================
// Phase 3: CRM Data
// ============================================================================

let firstLeadId = '';
let firstConversationId = '';

async function phase3(): Promise<void> {
  console.log('\nPhase 3: CRM Data');

  if (!accessToken) {
    console.log('  \u26a0\ufe0f  Skipped — no auth token (login failed)');
    return;
  }

  // GET /api/leads
  {
    const name = 'GET /api/leads';
    try {
      const { status, body, ms } = await request('GET', '/api/leads', { auth: true });
      const data = body as LeadsResponse;
      if (status === 200 && Array.isArray(data.items)) {
        firstLeadId = data.items[0]?.id ?? '';
        pass(name, status, ms, `count=${data.items.length}, total=${data.total}`);
      } else {
        fail(name, status, ms, 'unexpected response shape');
      }
    } catch (err) {
      fail(name, null, 0, 'request failed', extractErrorMessage(err));
    }
  }

  // GET /api/leads/cursor
  {
    const name = 'GET /api/leads/cursor';
    try {
      const { status, body, ms } = await request('GET', '/api/leads/cursor?limit=5', { auth: true });
      const data = body as { items: unknown[]; nextCursor: string | null };
      if (status === 200 && Array.isArray(data.items)) {
        pass(name, status, ms, `items=${data.items.length}, hasMore=${data.nextCursor !== null}`);
      } else {
        fail(name, status, ms, 'unexpected response shape');
      }
    } catch (err) {
      fail(name, null, 0, 'request failed', extractErrorMessage(err));
    }
  }

  // GET /api/conversations
  {
    const name = 'GET /api/conversations';
    try {
      const { status, body, ms } = await request('GET', '/api/conversations', { auth: true });
      const data = body as ConversationItem[];
      if (status === 200 && Array.isArray(data)) {
        firstConversationId = data[0]?.id ?? '';
        pass(name, status, ms, `count=${data.length}`);
      } else {
        fail(name, status, ms, 'unexpected response shape');
      }
    } catch (err) {
      fail(name, null, 0, 'request failed', extractErrorMessage(err));
    }
  }

  // GET /api/conversations/:id/messages (if we have a conversation)
  if (firstConversationId) {
    const name = `GET /api/conversations/:id/messages`;
    try {
      const { status, body, ms } = await request(
        'GET',
        `/api/conversations/${firstConversationId}/messages`,
        { auth: true },
      );
      const data = body as unknown[];
      if (status === 200 && Array.isArray(data)) {
        pass(name, status, ms, `messages=${data.length}`);
      } else {
        fail(name, status, ms, 'unexpected response shape');
      }
    } catch (err) {
      fail(name, null, 0, 'request failed', extractErrorMessage(err));
    }
  }

  // GET /api/analytics/overview
  {
    const name = 'GET /api/analytics/overview';
    try {
      const { status, body, ms } = await request('GET', '/api/analytics/overview', { auth: true });
      const data = body as OverviewResponse;
      if (
        status === 200 &&
        Array.isArray(data.revenue) &&
        Array.isArray(data.funnel) &&
        data.aiPerformance
      ) {
        pass(name, status, ms, `revenue=${data.revenue.length}pts, funnel=${data.funnel.length}stages`);
      } else {
        fail(name, status, ms, 'unexpected response shape');
      }
    } catch (err) {
      fail(name, null, 0, 'request failed', extractErrorMessage(err));
    }
  }

  // GET /api/settings
  {
    const name = 'GET /api/settings';
    try {
      const { status, body, ms } = await request('GET', '/api/settings', { auth: true });
      const data = body as SettingsResponse;
      if (status === 200 && data.profile && data.behavior) {
        pass(name, status, ms, `profile=\u2713, behavior=\u2713, knowledge=${data.knowledge.length}docs`);
      } else {
        fail(name, status, ms, 'unexpected response shape');
      }
    } catch (err) {
      fail(name, null, 0, 'request failed', extractErrorMessage(err));
    }
  }
}

// ============================================================================
// Phase 4: Analytics Dashboard
// ============================================================================

async function phase4(): Promise<void> {
  console.log('\nPhase 4: Analytics Dashboard');

  if (!accessToken) {
    console.log('  \u26a0\ufe0f  Skipped — no auth token');
    return;
  }

  // GET /api/analytics/dashboard?period=7d
  {
    const name = 'GET /api/analytics/dashboard?period=7d';
    try {
      const { status, body, ms } = await request('GET', '/api/analytics/dashboard?period=7d', { auth: true });
      const data = body as DashboardResponse;
      if (
        status === 200 &&
        data.stats &&
        data.aiPerformance &&
        Array.isArray(data.funnel) &&
        Array.isArray(data.messagesPerDay)
      ) {
        pass(name, status, ms,
          `leads=${data.stats.totalLeads}, msgs=${data.stats.messagesInPeriod}, funnel=${data.funnel.length}stages`,
        );
      } else {
        fail(name, status, ms, 'missing expected fields');
      }
    } catch (err) {
      fail(name, null, 0, 'request failed', extractErrorMessage(err));
    }
  }

  // Verify structure includes intent + channel distributions
  {
    const name = 'Analytics dashboard structure validation';
    try {
      const { status, body, ms } = await request('GET', '/api/analytics/dashboard?period=30d', { auth: true });
      const data = body as DashboardResponse;
      const hasIntents  = Array.isArray(data.intentDistribution);
      const hasChannels = Array.isArray(data.channelDistribution);
      if (status === 200 && hasIntents && hasChannels) {
        pass(name, status, ms, 'intentDistribution=\u2713, channelDistribution=\u2713');
      } else {
        fail(name, status, ms, `intents=${hasIntents}, channels=${hasChannels}`);
      }
    } catch (err) {
      fail(name, null, 0, 'request failed', extractErrorMessage(err));
    }
  }
}

// ============================================================================
// Phase 5: Telemetry
// ============================================================================

async function phase5(): Promise<void> {
  console.log('\nPhase 5: Telemetry');

  if (!accessToken) {
    console.log('  \u26a0\ufe0f  Skipped — no auth token');
    return;
  }

  if (!firstLeadId) {
    console.log('  \u26a0\ufe0f  Skipped — no leads found to query telemetry');
    return;
  }

  // GET /api/telemetry/lead/:leadId
  {
    const name = `GET /api/telemetry/lead/:leadId`;
    try {
      const { status, body, ms } = await request(
        'GET',
        `/api/telemetry/lead/${firstLeadId}`,
        { auth: true },
      );
      const data = body as TelemetryResponse;
      if (status === 200 && Array.isArray(data.telemetry)) {
        pass(name, status, ms, `entries=${data.telemetry.length}`);
      } else {
        fail(name, status, ms, 'unexpected response shape');
      }
    } catch (err) {
      fail(name, null, 0, 'request failed', extractErrorMessage(err));
    }
  }

  // GET /api/telemetry/conversation/:id/timeline (if we have a conversation)
  if (firstConversationId) {
    const name = `GET /api/telemetry/conversation/:id/timeline`;
    try {
      const { status, body, ms } = await request(
        'GET',
        `/api/telemetry/conversation/${firstConversationId}/timeline`,
        { auth: true },
      );
      const data = body as { timeline: unknown[] };
      if (status === 200 && Array.isArray(data.timeline)) {
        pass(name, status, ms, `events=${data.timeline.length}`);
      } else {
        fail(name, status, ms, 'unexpected response shape');
      }
    } catch (err) {
      fail(name, null, 0, 'request failed', extractErrorMessage(err));
    }
  }
}

// ============================================================================
// Phase 6: Settings Round-Trip
// ============================================================================

async function phase6(): Promise<void> {
  console.log('\nPhase 6: Settings Round-Trip');

  if (!accessToken) {
    console.log('  \u26a0\ufe0f  Skipped — no auth token');
    return;
  }

  let originalBehavior: Record<string, unknown> = {};

  // Step 1: Save current settings
  {
    const name = 'GET /api/settings (save original)';
    try {
      const { status, body, ms } = await request('GET', '/api/settings', { auth: true });
      const data = body as SettingsResponse;
      if (status === 200 && data.behavior) {
        originalBehavior = data.behavior;
        pass(name, status, ms, 'original saved');
      } else {
        fail(name, status, ms, 'could not read settings');
        return;
      }
    } catch (err) {
      fail(name, null, 0, 'request failed', extractErrorMessage(err));
      return;
    }
  }

  // Step 2: Update with test systemPrompt
  const testPrompt = `E2E-TEST-${Date.now()}`;
  {
    const name = 'PATCH /api/settings (update prompt)';
    try {
      const { status, ms } = await request('PATCH', '/api/settings', {
        auth: true,
        body: { behavior: { systemPrompt: testPrompt } },
      });
      if (status === 200) {
        pass(name, status, ms, 'updated');
      } else {
        fail(name, status, ms, 'update failed');
      }
    } catch (err) {
      fail(name, null, 0, 'request failed', extractErrorMessage(err));
    }
  }

  // Step 3: Verify update persisted
  {
    const name = 'GET /api/settings (verify update)';
    try {
      const { status, body, ms } = await request('GET', '/api/settings', { auth: true });
      const data = body as SettingsResponse;
      const currentPrompt = (data.behavior as Record<string, unknown>).systemPrompt;
      if (status === 200 && currentPrompt === testPrompt) {
        pass(name, status, ms, 'prompt persisted correctly');
      } else {
        fail(name, status, ms, `expected "${testPrompt}", got "${currentPrompt}"`);
      }
    } catch (err) {
      fail(name, null, 0, 'request failed', extractErrorMessage(err));
    }
  }

  // Step 4: Restore original
  {
    const name = 'PATCH /api/settings (restore original)';
    try {
      const { status, ms } = await request('PATCH', '/api/settings', {
        auth: true,
        body: { behavior: originalBehavior },
      });
      if (status === 200) {
        pass(name, status, ms, 'restored');
      } else {
        fail(name, status, ms, 'restore failed');
      }
    } catch (err) {
      fail(name, null, 0, 'request failed', extractErrorMessage(err));
    }
  }
}

// ============================================================================
// Runner
// ============================================================================

async function main(): Promise<void> {
  const startTime = Date.now();
  const now = new Date().toISOString();

  console.log('\n\ud83d\udd0d ConversAI \u2014 E2E Smoke Test');
  console.log(`   Target: ${BASE_URL}`);
  console.log(`   Time:   ${now}`);
  console.log(`   Auth:   ${ADMIN_EMAIL}`);

  try {
    await phase1();
  } catch (err) {
    console.log(`\n  \u274c Phase 1 crashed: ${(err as Error).message}`);
  }

  try {
    await phase2();
  } catch (err) {
    console.log(`\n  \u274c Phase 2 crashed: ${(err as Error).message}`);
  }

  try {
    await phase3();
  } catch (err) {
    console.log(`\n  \u274c Phase 3 crashed: ${(err as Error).message}`);
  }

  try {
    await phase4();
  } catch (err) {
    console.log(`\n  \u274c Phase 4 crashed: ${(err as Error).message}`);
  }

  try {
    await phase5();
  } catch (err) {
    console.log(`\n  \u274c Phase 5 crashed: ${(err as Error).message}`);
  }

  try {
    await phase6();
  } catch (err) {
    console.log(`\n  \u274c Phase 6 crashed: ${(err as Error).message}`);
  }

  // Summary
  const totalMs = Date.now() - startTime;
  const passed  = results.filter((r) => r.passed).length;
  const failed  = results.filter((r) => !r.passed).length;
  const total   = results.length;

  console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
  console.log(`  Results: ${passed}/${total} passed, ${failed} failed`);
  console.log(`  Total time: ${(totalMs / 1000).toFixed(1)}s`);
  console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');

  if (failed > 0) {
    console.log('Failed tests:');
    for (const r of results.filter((t) => !t.passed)) {
      console.log(`  - ${r.name}: ${r.detail}${r.error ? ` (${r.error})` : ''}`);
    }
    console.log('');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  const errMsg = extractErrorMessage(err);
  console.error('\nFatal error:', errMsg);

  // Handle connection refused gracefully
  if (errMsg.includes('ECONNREFUSED') || errMsg.includes('fetch failed')) {
    console.error(`\nServer not reachable at ${BASE_URL}`);
    console.error('Make sure the server is running and the URL is correct.\n');
  }

  process.exit(1);
});
