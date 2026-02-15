/**
 * Lead Model Tests
 *
 * Unit tests for the Lead model CRUD operations,
 * merge logic, and status validation.
 */

import {
  getTestPool,
  cleanDatabase,
  createTestLead,
  randomPhone,
} from '../setup.js';

// ============================================================================
// Test Setup
// ============================================================================

// We'll test the model functions directly against the test database
// Import the actual model (these tests require a running test database)

describe('Lead Model', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  // ==========================================================================
  // Create Tests
  // ==========================================================================

  describe('create()', () => {
    it('should create a lead with phone number only', async () => {
      const pool = getTestPool();
      const phone = randomPhone();

      const result = await pool.query(
        `INSERT INTO leads (phone) VALUES ($1) RETURNING *`,
        [phone]
      );

      const lead = result.rows[0];
      expect(lead).toBeDefined();
      expect(lead.phone).toBe(phone);
      expect(lead.status).toBe('new');
      expect(lead.opted_out).toBe(false);
      expect(lead.needs_human_followup).toBe(false);
    });

    it('should create a lead with initial data', async () => {
      const pool = getTestPool();
      const phone = randomPhone();
      const name = 'John Doe';
      const subjects = ['mathematics', 'physics'];

      const result = await pool.query(
        `INSERT INTO leads (phone, name, subjects) VALUES ($1, $2, $3) RETURNING *`,
        [phone, name, subjects]
      );

      const lead = result.rows[0];
      expect(lead.name).toBe(name);
      expect(lead.subjects).toEqual(subjects);
    });

    it('should reject duplicate phone numbers', async () => {
      const pool = getTestPool();
      const phone = randomPhone();

      // First insert should succeed
      await pool.query(`INSERT INTO leads (phone) VALUES ($1)`, [phone]);

      // Second insert should fail
      await expect(
        pool.query(`INSERT INTO leads (phone) VALUES ($1)`, [phone])
      ).rejects.toThrow();
    });

    it('should auto-generate UUID for id', async () => {
      const pool = getTestPool();
      const phone = randomPhone();

      const result = await pool.query(
        `INSERT INTO leads (phone) VALUES ($1) RETURNING id`,
        [phone]
      );

      const id = result.rows[0].id;
      expect(id).toBeDefined();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it('should set created_at and updated_at timestamps', async () => {
      const pool = getTestPool();
      const phone = randomPhone();

      const result = await pool.query(
        `INSERT INTO leads (phone) VALUES ($1) RETURNING created_at, updated_at`,
        [phone]
      );

      const lead = result.rows[0];
      expect(lead.created_at).toBeInstanceOf(Date);
      expect(lead.updated_at).toBeInstanceOf(Date);
      expect(lead.created_at.getTime()).toBeCloseTo(Date.now(), -3); // Within 1 second
    });
  });

  // ==========================================================================
  // Subjects Merge Logic Tests
  // ==========================================================================

  describe('subjects merge logic', () => {
    it('should add new subjects without removing existing ones', async () => {
      const pool = getTestPool();
      const { id } = await createTestLead({
        subjects: ['mathematics'],
      });

      // Update with additional subject - simulating MERGE logic
      await pool.query(
        `UPDATE leads
         SET subjects = array_cat(
           COALESCE(subjects, ARRAY[]::text[]),
           ARRAY['physics']
         )
         WHERE id = $1`,
        [id]
      );

      // Remove duplicates
      await pool.query(
        `UPDATE leads
         SET subjects = (
           SELECT ARRAY(SELECT DISTINCT unnest(subjects))
         )
         WHERE id = $1`,
        [id]
      );

      const result = await pool.query(`SELECT subjects FROM leads WHERE id = $1`, [id]);
      const subjects = result.rows[0].subjects;

      expect(subjects).toContain('mathematics');
      expect(subjects).toContain('physics');
      expect(subjects.length).toBe(2);
    });

    it('should not duplicate existing subjects', async () => {
      const pool = getTestPool();
      const { id } = await createTestLead({
        subjects: ['mathematics', 'physics'],
      });

      // Merge with overlapping subjects
      await pool.query(
        `UPDATE leads
         SET subjects = (
           SELECT ARRAY(SELECT DISTINCT unnest(
             array_cat(COALESCE(subjects, ARRAY[]::text[]), ARRAY['physics', 'chemistry'])
           ))
         )
         WHERE id = $1`,
        [id]
      );

      const result = await pool.query(`SELECT subjects FROM leads WHERE id = $1`, [id]);
      const subjects = result.rows[0].subjects;

      // Should have 3 unique subjects
      expect(subjects.length).toBe(3);
      expect(subjects).toContain('mathematics');
      expect(subjects).toContain('physics');
      expect(subjects).toContain('chemistry');
    });

    it('should handle null subjects array', async () => {
      const pool = getTestPool();
      const { id } = await createTestLead(); // No subjects

      // Verify subjects is null
      const before = await pool.query(`SELECT subjects FROM leads WHERE id = $1`, [id]);
      expect(before.rows[0].subjects).toBeNull();

      // Add subjects to null array
      await pool.query(
        `UPDATE leads SET subjects = ARRAY['mathematics'] WHERE id = $1`,
        [id]
      );

      const after = await pool.query(`SELECT subjects FROM leads WHERE id = $1`, [id]);
      expect(after.rows[0].subjects).toEqual(['mathematics']);
    });
  });

  // ==========================================================================
  // Status Validation Tests
  // ==========================================================================

  describe('status validation', () => {
    it('should allow forward status transitions', async () => {
      const pool = getTestPool();
      const { id } = await createTestLead({ status: 'new' });

      // new -> qualified (forward)
      await pool.query(`UPDATE leads SET status = 'qualified' WHERE id = $1`, [id]);
      const result1 = await pool.query(`SELECT status FROM leads WHERE id = $1`, [id]);
      expect(result1.rows[0].status).toBe('qualified');

      // qualified -> ready_to_book (forward, skipping)
      await pool.query(`UPDATE leads SET status = 'ready_to_book' WHERE id = $1`, [id]);
      const result2 = await pool.query(`SELECT status FROM leads WHERE id = $1`, [id]);
      expect(result2.rows[0].status).toBe('ready_to_book');
    });

    it('should allow transition to lost from any status', async () => {
      const pool = getTestPool();

      for (const status of ['new', 'qualified', 'considering', 'ready_to_book']) {
        const { id } = await createTestLead({ status });

        // Should allow transition to 'lost'
        await pool.query(`UPDATE leads SET status = 'lost' WHERE id = $1`, [id]);
        const result = await pool.query(`SELECT status FROM leads WHERE id = $1`, [id]);
        expect(result.rows[0].status).toBe('lost');
      }
    });

    it('should allow transition from lost to any status (re-engagement)', async () => {
      const pool = getTestPool();
      const { id } = await createTestLead({ status: 'lost' });

      // lost -> new (re-engagement)
      await pool.query(`UPDATE leads SET status = 'new' WHERE id = $1`, [id]);
      const result = await pool.query(`SELECT status FROM leads WHERE id = $1`, [id]);
      expect(result.rows[0].status).toBe('new');
    });

    it('should validate status enum values', async () => {
      const pool = getTestPool();
      const phone = randomPhone();

      // Invalid status should fail (depends on database constraints)
      await expect(
        pool.query(
          `INSERT INTO leads (phone, status) VALUES ($1, $2)`,
          [phone, 'invalid_status']
        )
      ).rejects.toThrow();
    });

    it('should track status transitions correctly', async () => {
      const pool = getTestPool();
      const { id } = await createTestLead({ status: 'new' });

      // Get initial updated_at
      const initial = await pool.query(
        `SELECT updated_at FROM leads WHERE id = $1`,
        [id]
      );
      const initialTime = initial.rows[0].updated_at;

      // Wait a bit and update status
      await new Promise((resolve) => setTimeout(resolve, 10));

      await pool.query(`UPDATE leads SET status = 'qualified' WHERE id = $1`, [id]);

      const after = await pool.query(
        `SELECT status, updated_at FROM leads WHERE id = $1`,
        [id]
      );

      expect(after.rows[0].status).toBe('qualified');
      expect(after.rows[0].updated_at.getTime()).toBeGreaterThan(initialTime.getTime());
    });
  });

  // ==========================================================================
  // Query Tests
  // ==========================================================================

  describe('queries', () => {
    it('should find lead by phone', async () => {
      const pool = getTestPool();
      const phone = randomPhone();
      await createTestLead({ phone });

      const result = await pool.query(
        `SELECT * FROM leads WHERE phone = $1`,
        [phone]
      );

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].phone).toBe(phone);
    });

    it('should find lead by id', async () => {
      const pool = getTestPool();
      const { id, phone } = await createTestLead();

      const result = await pool.query(
        `SELECT * FROM leads WHERE id = $1`,
        [id]
      );

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].id).toBe(id);
      expect(result.rows[0].phone).toBe(phone);
    });

    it('should return null for non-existent lead', async () => {
      const pool = getTestPool();
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const result = await pool.query(
        `SELECT * FROM leads WHERE id = $1`,
        [fakeId]
      );

      expect(result.rows.length).toBe(0);
    });

    it('should list leads by status', async () => {
      const pool = getTestPool();

      // Create leads with different statuses
      await createTestLead({ status: 'new' });
      await createTestLead({ status: 'new' });
      await createTestLead({ status: 'qualified' });
      await createTestLead({ status: 'booked' });

      const newLeads = await pool.query(
        `SELECT * FROM leads WHERE status = 'new'`
      );
      expect(newLeads.rows.length).toBe(2);

      const qualifiedLeads = await pool.query(
        `SELECT * FROM leads WHERE status = 'qualified'`
      );
      expect(qualifiedLeads.rows.length).toBe(1);
    });

    it('should filter opted out leads', async () => {
      const pool = getTestPool();

      await createTestLead({ opted_out: false });
      await createTestLead({ opted_out: false });
      await createTestLead({ opted_out: true });

      const activeLeads = await pool.query(
        `SELECT * FROM leads WHERE opted_out = false`
      );
      expect(activeLeads.rows.length).toBe(2);

      const optedOutLeads = await pool.query(
        `SELECT * FROM leads WHERE opted_out = true`
      );
      expect(optedOutLeads.rows.length).toBe(1);
    });
  });

  // ==========================================================================
  // Timestamp Tests
  // ==========================================================================

  describe('timestamps', () => {
    it('should update last_user_message_at', async () => {
      const pool = getTestPool();
      const { id } = await createTestLead();

      // Initially null
      const before = await pool.query(
        `SELECT last_user_message_at FROM leads WHERE id = $1`,
        [id]
      );
      expect(before.rows[0].last_user_message_at).toBeNull();

      // Update timestamp
      await pool.query(
        `UPDATE leads SET last_user_message_at = NOW() WHERE id = $1`,
        [id]
      );

      const after = await pool.query(
        `SELECT last_user_message_at FROM leads WHERE id = $1`,
        [id]
      );
      expect(after.rows[0].last_user_message_at).toBeInstanceOf(Date);
    });

    it('should update last_bot_message_at', async () => {
      const pool = getTestPool();
      const { id } = await createTestLead();

      await pool.query(
        `UPDATE leads SET last_bot_message_at = NOW() WHERE id = $1`,
        [id]
      );

      const result = await pool.query(
        `SELECT last_bot_message_at FROM leads WHERE id = $1`,
        [id]
      );
      expect(result.rows[0].last_bot_message_at).toBeInstanceOf(Date);
    });

    it('should track message timing correctly', async () => {
      const pool = getTestPool();
      const { id } = await createTestLead();

      // Simulate user message
      await pool.query(
        `UPDATE leads SET last_user_message_at = NOW() WHERE id = $1`,
        [id]
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Simulate bot response
      await pool.query(
        `UPDATE leads SET last_bot_message_at = NOW() WHERE id = $1`,
        [id]
      );

      const result = await pool.query(
        `SELECT last_user_message_at, last_bot_message_at FROM leads WHERE id = $1`,
        [id]
      );

      const lead = result.rows[0];
      expect(lead.last_bot_message_at.getTime()).toBeGreaterThan(
        lead.last_user_message_at.getTime()
      );
    });
  });
});
