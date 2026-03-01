/**
 * Analytics Service - Lead probability and revenue calculations
 */

import { queryOne } from '../database/connection.js';

interface Lead {
  id: string;
  status: string;
  lead_state?: string;
  lead_value?: number;
  subject?: string;
  created_at: string;
}

const DEFAULT_VALUE = 3000;

export function calculateLeadProbability(lead: Lead): number {
  let prob = 0.25;

  // State bonus
  const stateBonus: Record<string, number> = {
    booking_intent: 0.45,
    ready_to_book: 0.35,
    trial_scheduled: 0.30,
    engaged: 0.15,
    thinking: 0.05,
  };
  prob += stateBonus[lead.lead_state || ''] || 0;

  // Status bonus
  const statusBonus: Record<string, number> = {
    ready_to_book: 0.25,
    considering: 0.10,
    qualified: 0.05,
    hesitant: -0.05,
  };
  prob += statusBonus[lead.status] || 0;

  // Time decay
  const days = (Date.now() - new Date(lead.created_at).getTime()) / 86400000;
  if (days > 30) prob -= 0.20;
  else if (days > 14) prob -= 0.10;
  else if (days > 7) prob -= 0.05;

  return Math.max(0.01, Math.min(0.99, prob));
}

export function calculateExpectedRevenue(leads: Lead[]): number {
  return leads.reduce((sum, lead) => {
    const prob = calculateLeadProbability(lead);
    return sum + prob * (lead.lead_value || DEFAULT_VALUE);
  }, 0);
}

export async function calculatePipelineVelocity(accountId: string | null) {
  const result = await queryOne(`
    SELECT
      AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400) as avg_days,
      PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400
      ) as median_days
    FROM leads
    WHERE status = 'booked' AND created_at > NOW() - INTERVAL '90 days'
      AND ($1::UUID IS NULL OR EXISTS (
        SELECT 1 FROM agents a WHERE a.id = agent_id AND a.account_id = $1
      ))
  `, [accountId]);

  return {
    avgDaysToClose: Math.round((Number(result?.avg_days) || 0) * 10) / 10,
    medianDaysToClose: Math.round((Number(result?.median_days) || 0) * 10) / 10,
    trend: 'stable' as const,
  };
}
