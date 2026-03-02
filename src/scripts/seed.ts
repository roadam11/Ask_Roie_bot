/**
 * Database Seed Script
 *
 * Inserts realistic demo data for the admin dashboard:
 *   - 1 admin user (credentials: admin@askroie.com / Admin1234!)
 *   - 10 leads (Hebrew names, varied statuses)
 *   - 10 conversations
 *   - 30 messages (3 per conversation)
 *   - Settings row
 *   - Analytics events
 *
 * Run: npx tsx src/scripts/seed.ts
 * Or via npm: npm run seed
 */

import bcrypt from 'bcrypt';
import { connectDatabase, disconnectDatabase, query } from '../database/connection.js';
import logger from '../utils/logger.js';

const DEFAULT_ACCOUNT_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_AGENT_ID   = '00000000-0000-0000-0000-000000000001';

// ── Helper ─────────────────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function hoursAgo(n: number): Date {
  const d = new Date();
  d.setHours(d.getHours() - n);
  return d;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Data ───────────────────────────────────────────────────────────────────────

const LEADS: {
  name: string;
  phone: string;
  subjects: string[];
  level: string;
  status: string;
  lead_state: string;
  lead_value: number | null;
}[] = [
  { name: 'יעל כהן',       phone: '+972501111111', subjects: ['מתמטיקה'],          level: 'high_school',  status: 'qualified',     lead_state: 'engaged',          lead_value: 1200 },
  { name: 'דוד לוי',       phone: '+972502222222', subjects: ['פיזיקה', 'מתמטיקה'], level: 'high_school',  status: 'considering',   lead_state: 'thinking',         lead_value: 1800 },
  { name: 'שרה מזרחי',     phone: '+972503333333', subjects: ['אנגלית'],            level: 'middle_school',status: 'booked',        lead_state: 'trial_scheduled',  lead_value: 800  },
  { name: 'אברהם ישראלי',  phone: '+972504444444', subjects: ['כימיה'],             level: 'high_school',  status: 'hesitant',      lead_state: 'thinking',         lead_value: 1400 },
  { name: 'רחל פרץ',       phone: '+972505555555', subjects: ['מתמטיקה'],          level: 'elementary',   status: 'new',           lead_state: 'new',              lead_value: null },
  { name: 'משה גרינברג',   phone: '+972506666666', subjects: ['ביולוגיה'],          level: 'college',      status: 'ready_to_book', lead_state: 'engaged',          lead_value: 2000 },
  { name: 'מירי שפירא',    phone: '+972507777777', subjects: ['היסטוריה', 'ספרות'], level: 'high_school',  status: 'booked',        lead_state: 'converted',        lead_value: 1600 },
  { name: 'יוסף אדרי',     phone: '+972508888888', subjects: ['מתמטיקה', 'פיזיקה'],level: 'high_school',  status: 'lost',          lead_state: 'closed',           lead_value: 0    },
  { name: 'אסתר חיון',     phone: '+972509999999', subjects: ['אנגלית'],            level: 'middle_school',status: 'qualified',     lead_state: 'engaged',          lead_value: 900  },
  { name: 'בנימין נחמני',  phone: '+972500000000', subjects: ['מתמטיקה'],          level: 'high_school',  status: 'considering',   lead_state: 'thinking',         lead_value: 1300 },
];

const CONV_MESSAGES: Record<number, { role: 'user' | 'bot'; content: string }[]> = {
  0: [
    { role: 'user', content: 'שלום, אני מחפש מורה למתמטיקה לבת שלי בכיתה י׳' },
    { role: 'bot',  content: 'שלום! אשמח לעזור. מה הנושאים שיעל מתקשה בהם?' },
    { role: 'user', content: 'בעיקר אלגברה וגיאומטריה. יש לה בגרות בעוד 4 חודשים' },
  ],
  1: [
    { role: 'user', content: 'היי, שמעתי עליכם מחבר. כמה עולה שיעור פיזיקה?' },
    { role: 'bot',  content: 'שלום דוד! שיעורי פיזיקה הם 180 ₪ לשעה. האם תרצה לקבוע שיעור ניסיון חינמי?' },
    { role: 'user', content: 'אחשוב על זה ואחזור אליך' },
  ],
  2: [
    { role: 'user', content: 'אנחנו רוצים להתחיל שיעורי אנגלית לבן שלנו' },
    { role: 'bot',  content: 'מצוין! כמה זמן יש לבנכם עם אנגלית? נשמח לסייע' },
    { role: 'user', content: 'הוא בכיתה ח׳, הציון שלו 65. מתי אפשר להתחיל?' },
  ],
  3: [
    { role: 'user', content: 'שלום, הבת שלי מתקשה בכימיה. מה האפשרויות?' },
    { role: 'bot',  content: 'שלום! אנחנו מציעים שיעורים פרטיים בכימיה. האם זה לבגרות?' },
    { role: 'user', content: 'כן, היא לומדת 5 יחידות. המחיר קצת גבוה עבורנו' },
  ],
  4: [
    { role: 'user', content: 'שלום, אני צריכה עזרה במתמטיקה לכיתה ד׳' },
    { role: 'bot',  content: 'ברוכה הבאה! שיעורי מתמטיקה לכיתה ד׳ הם 120 ₪ לשעה. מתי נוח לך?' },
    { role: 'user', content: 'אולי בערב אחרי 18:00?' },
  ],
  5: [
    { role: 'user', content: 'אני סטודנט לביולוגיה, צריך עזרה עם גנטיקה' },
    { role: 'bot',  content: 'שלום! יש לנו מורים מעולים לביולוגיה אוניברסיטאית. מה הרמה שלך?' },
    { role: 'user', content: 'שנה ב׳ לביולוגיה בתל אביב. מתי נוכל לתאם?' },
  ],
  6: [
    { role: 'user', content: 'שלום, רוצים לקבוע שיעור ניסיון להיסטוריה' },
    { role: 'bot',  content: 'מעולה! נשמח לקבוע. מה הציון הנוכחי של מירי?' },
    { role: 'user', content: 'בסביבות 70. מתי יש זמינות השבוע?' },
  ],
  7: [
    { role: 'user', content: 'שלום, כמה עולה שיעורי פיזיקה ומתמטיקה יחד?' },
    { role: 'bot',  content: 'לשני המקצועות יחד יש לנו הנחת חבילה — 320 ₪ לשעה זוגית' },
    { role: 'user', content: 'לא מתאים לנו כרגע. תודה' },
  ],
  8: [
    { role: 'user', content: 'שלום, הבן שלי צריך עזרה באנגלית לבחינת פסיכומטרי' },
    { role: 'bot',  content: 'שלום! אנחנו מתמחים בהכנה לפסיכומטרי. מתי מתוכנן המבחן?' },
    { role: 'user', content: 'בעוד 3 חודשים. האם יש לכם תוכנית מיוחדת?' },
  ],
  9: [
    { role: 'user', content: 'היי, חבר המליץ עליכם למתמטיקה. כמה עולה?' },
    { role: 'bot',  content: 'שלום בנימין! מחיר שיעורי מתמטיקה: 160-180 ₪ לשעה תלוי ברמה' },
    { role: 'user', content: 'אוקיי, אני מתלבט. תן לי כמה ימים לחשוב' },
  ],
};

// ── Seed functions ─────────────────────────────────────────────────────────────

async function seedAdminUser(): Promise<void> {
  logger.info('Seeding admin user...');

  const passwordHash = await bcrypt.hash('Admin1234!', 12);

  await query(
    `INSERT INTO admin_users (id, account_id, email, password_hash, name, role, active)
     VALUES (
       '00000000-0000-0000-0000-000000000010',
       $1,
       'admin@askroie.com',
       $2,
       'Admin',
       'admin',
       true
     )
     ON CONFLICT (email) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       updated_at    = NOW()`,
    [DEFAULT_ACCOUNT_ID, passwordHash],
  );

  logger.info('Admin user ready: admin@askroie.com / Admin1234!');
}

async function seedLeads(): Promise<string[]> {
  logger.info('Seeding leads...');
  const ids: string[] = [];

  for (let i = 0; i < LEADS.length; i++) {
    const l = LEADS[i];
    const created = daysAgo(30 - i * 2);
    const booked  = l.status === 'booked' ? daysAgo(i + 1) : null;

    const res = await query<{ id: string }>(
      `INSERT INTO leads (
         phone, name, subjects, level, status, lead_state, lead_value,
         agent_id, created_at, updated_at,
         booking_completed, booked_at, opted_out
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $11, false)
       ON CONFLICT (phone) DO UPDATE SET
         name       = EXCLUDED.name,
         status     = EXCLUDED.status,
         lead_state = EXCLUDED.lead_state,
         lead_value = EXCLUDED.lead_value,
         updated_at = NOW()
       RETURNING id`,
      [
        l.phone,
        l.name,
        l.subjects,
        l.level,
        l.status,
        l.lead_state,
        l.lead_value,
        DEFAULT_AGENT_ID,
        created,
        l.status === 'booked',
        booked,
      ],
    );

    ids.push(res.rows[0].id);
  }

  logger.info(`${ids.length} leads seeded`);
  return ids;
}

async function seedConversations(leadIds: string[]): Promise<string[]> {
  logger.info('Seeding conversations...');
  const ids: string[] = [];

  for (let i = 0; i < leadIds.length; i++) {
    const leadId  = leadIds[i];
    const started = daysAgo(28 - i * 2);
    const status  = LEADS[i].status === 'booked' ? 'completed'
      : LEADS[i].status === 'lost' ? 'completed' : 'active';
    const outcome = LEADS[i].status === 'booked' ? 'booked'
      : LEADS[i].status === 'lost' ? 'not_interested' : null;
    const aiStage = LEADS[i].status === 'booked' ? 'booked'
      : LEADS[i].status === 'lost' ? 'lost'
      : LEADS[i].status === 'ready_to_book' ? 'negotiating' : 'qualifying';
    const msgs    = CONV_MESSAGES[i];
    const lastMsg = msgs[msgs.length - 1].content;

    const res = await query<{ id: string }>(
      `INSERT INTO conversations (
         lead_id, agent_id, started_at, status, outcome,
         channel, ai_stage, message_count,
         last_message, last_message_at, created_at
       )
       VALUES ($1, $2, $3, $4, $5, 'whatsapp', $6, $7, $8, $9, $3)
       RETURNING id`,
      [
        leadId,
        DEFAULT_AGENT_ID,
        started,
        status,
        outcome,
        aiStage,
        msgs.length,
        lastMsg.slice(0, 200),
        hoursAgo((10 - i) * 3),
      ],
    );

    ids.push(res.rows[0].id);
  }

  logger.info(`${ids.length} conversations seeded`);
  return ids;
}

async function seedMessages(leadIds: string[], convIds: string[]): Promise<void> {
  logger.info('Seeding messages...');
  let count = 0;

  for (let i = 0; i < convIds.length; i++) {
    const convId = convIds[i];
    const leadId = leadIds[i];
    const msgs   = CONV_MESSAGES[i];
    const base   = daysAgo(28 - i * 2).getTime();

    for (let j = 0; j < msgs.length; j++) {
      const m  = msgs[j];
      const ts = new Date(base + j * 5 * 60_000); // 5 min apart

      await query(
        `INSERT INTO messages (lead_id, conversation_id, role, content, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [leadId, convId, m.role, m.content, ts],
      );
      count++;
    }
  }

  logger.info(`${count} messages seeded`);
}

async function seedAnalytics(leadIds: string[]): Promise<void> {
  logger.info('Seeding analytics events...');

  const eventTypes = [
    'conversation_started',
    'message_received',
    'lead_qualified',
    'follow_up_sent',
    'booking_completed',
  ];

  for (let i = 0; i < leadIds.length; i++) {
    const leadId    = leadIds[i];
    const eventType = pick(eventTypes);

    await query(
      `INSERT INTO analytics (lead_id, event_type, metadata, created_at)
       VALUES ($1, $2, $3, $4)`,
      [
        leadId,
        eventType,
        JSON.stringify({ name: LEADS[i].name, phone: LEADS[i].phone }),
        daysAgo(Math.floor(Math.random() * 7)),
      ],
    );
  }

  // Add booking events for booked leads
  for (let i = 0; i < leadIds.length; i++) {
    if (LEADS[i].status === 'booked') {
      await query(
        `INSERT INTO analytics (lead_id, event_type, metadata, created_at)
         VALUES ($1, 'booking_completed', $2, $3)`,
        [leadIds[i], JSON.stringify({ name: LEADS[i].name }), daysAgo(i + 1)],
      );
    }
  }

  logger.info('Analytics events seeded');
}

async function seedSettings(): Promise<void> {
  logger.info('Seeding settings...');

  await query(
    `INSERT INTO settings (account_id, profile, behavior, last_saved_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (account_id) DO UPDATE SET
       profile       = EXCLUDED.profile,
       behavior      = EXCLUDED.behavior,
       last_saved_at = NOW(),
       updated_at    = NOW()`,
    [
      DEFAULT_ACCOUNT_ID,
      JSON.stringify({
        id:          DEFAULT_ACCOUNT_ID,
        companyName: 'Ask ROIE',
        ownerName:   'ROIE',
        email:       'admin@askroie.com',
        phone:       '+972-50-000-0000',
        timezone:    'Asia/Jerusalem',
      }),
      JSON.stringify({
        tone:         'friendly',
        strictness:   65,
        systemPrompt: 'אתה סוכן מכירות AI של Ask ROIE, שירות שיעורים פרטיים מוביל. תפקידך לסייע להורים ולתלמידים למצוא את המורה המתאים ולקבוע שיעור ניסיון.',
      }),
    ],
  );

  logger.info('Settings seeded');
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info('Starting database seed...');

  try {
    await connectDatabase();

    await seedAdminUser();
    const leadIds = await seedLeads();
    const convIds = await seedConversations(leadIds);
    await seedMessages(leadIds, convIds);
    await seedAnalytics(leadIds);
    await seedSettings();

    logger.info('✓ Seed complete!');
    logger.info('Login: admin@askroie.com / Admin1234!');
  } catch (err) {
    logger.error('Seed failed', { error: (err as Error).message });
    throw err;
  } finally {
    await disconnectDatabase();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
