/**
 * Calendly Service
 *
 * Handles Calendly API interactions for polling bookings
 * and extracting invitee information.
 *
 * @example
 * import * as CalendlyService from './services/calendly.service.js';
 *
 * const events = await CalendlyService.getRecentEvents(since);
 * const invitee = await CalendlyService.getEventInvitee(eventUri);
 */

import axios, { AxiosError } from 'axios';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import { normalizePhoneSafe } from '../utils/phone-normalizer.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Calendly event from API
 */
export interface CalendlyEvent {
  uri: string;
  name: string;
  status: 'active' | 'canceled';
  start_time: string;
  end_time: string;
  event_type: string;
  location: {
    type: string;
    location?: string;
    join_url?: string;
  };
  invitees_counter: {
    total: number;
    active: number;
    limit: number;
  };
  created_at: string;
  updated_at: string;
  event_memberships: Array<{
    user: string;
  }>;
  event_guests: Array<{
    email: string;
    created_at: string;
    updated_at: string;
  }>;
}

/**
 * Calendly invitee from API
 */
export interface CalendlyInvitee {
  uri: string;
  email: string;
  name: string;
  status: 'active' | 'canceled';
  questions_and_answers: Array<{
    question: string;
    answer: string;
    position: number;
  }>;
  timezone: string;
  event: string;
  created_at: string;
  updated_at: string;
  tracking?: {
    utm_campaign?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_content?: string;
    utm_term?: string;
    salesforce_uuid?: string;
  };
  text_reminder_number?: string;
  rescheduled: boolean;
  old_invitee?: string;
  new_invitee?: string;
  cancel_url: string;
  reschedule_url: string;
  routing_form_submission?: string;
  payment?: {
    external_id: string;
    provider: string;
    amount: number;
    currency: string;
    terms: string;
    successful: boolean;
  };
  no_show?: {
    uri: string;
    created_at: string;
  };
  reconfirmation?: {
    created_at: string;
    confirmed_at?: string;
  };
}

/**
 * Calendly API response for events list
 */
interface CalendlyEventsResponse {
  collection: CalendlyEvent[];
  pagination: {
    count: number;
    next_page?: string;
    previous_page?: string;
    next_page_token?: string;
    previous_page_token?: string;
  };
}

/**
 * Calendly API response for invitees list
 */
interface CalendlyInviteesResponse {
  collection: CalendlyInvitee[];
  pagination: {
    count: number;
    next_page?: string;
    previous_page?: string;
  };
}

/**
 * Calendly API error response
 */
interface CalendlyApiError {
  title: string;
  message: string;
  details?: Array<{
    parameter: string;
    message: string;
  }>;
}

// ============================================================================
// API Client Setup
// ============================================================================

/**
 * Calendly API client
 */
const calendlyApi = axios.create({
  baseURL: config.calendly.apiBaseUrl,
  headers: {
    'Authorization': `Bearer ${config.calendly.accessToken}`,
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// ============================================================================
// Event Fetching
// ============================================================================

/**
 * Get recent scheduled events
 *
 * @param since - Fetch events created/updated since this date
 * @param status - Filter by event status (default: 'active')
 * @returns Array of Calendly events
 */
export async function getRecentEvents(
  since: Date,
  status: 'active' | 'canceled' = 'active'
): Promise<CalendlyEvent[]> {
  const allEvents: CalendlyEvent[] = [];
  let nextPageToken: string | undefined;

  try {
    do {
      const params: Record<string, string> = {
        organization: config.calendly.organizationUri,
        min_start_time: since.toISOString(),
        status,
        count: '100',
      };

      if (nextPageToken) {
        params.page_token = nextPageToken;
      }

      const response = await calendlyApi.get<CalendlyEventsResponse>(
        '/scheduled_events',
        { params }
      );

      allEvents.push(...response.data.collection);
      nextPageToken = response.data.pagination.next_page_token;

      logger.debug('Fetched Calendly events page', {
        count: response.data.collection.length,
        total: allEvents.length,
        hasMore: !!nextPageToken,
      });
    } while (nextPageToken);

    // Filter by event type if configured
    const filteredEvents = config.calendly.eventTypeUri
      ? allEvents.filter((event) => event.event_type === config.calendly.eventTypeUri)
      : allEvents;

    logger.info('Fetched Calendly events', {
      totalFetched: allEvents.length,
      afterFilter: filteredEvents.length,
      since: since.toISOString(),
    });

    return filteredEvents;
  } catch (error) {
    handleCalendlyError(error, 'getRecentEvents');
    throw error;
  }
}

/**
 * Get invitees for a specific event
 *
 * @param eventUri - Calendly event URI
 * @returns Array of invitees
 */
export async function getEventInvitees(eventUri: string): Promise<CalendlyInvitee[]> {
  const allInvitees: CalendlyInvitee[] = [];
  let nextPageToken: string | undefined;

  try {
    // Extract event UUID from URI
    const eventUuid = eventUri.split('/').pop();

    do {
      const params: Record<string, string> = {
        count: '100',
        status: 'active',
      };

      if (nextPageToken) {
        params.page_token = nextPageToken;
      }

      const response = await calendlyApi.get<CalendlyInviteesResponse>(
        `/scheduled_events/${eventUuid}/invitees`,
        { params }
      );

      allInvitees.push(...response.data.collection);
      nextPageToken = undefined; // Invitees endpoint might not have pagination token

    } while (nextPageToken);

    logger.debug('Fetched event invitees', {
      eventUri,
      count: allInvitees.length,
    });

    return allInvitees;
  } catch (error) {
    handleCalendlyError(error, 'getEventInvitees');
    throw error;
  }
}

/**
 * Get single invitee details
 *
 * @param inviteeUri - Calendly invitee URI
 * @returns Invitee details
 */
export async function getInvitee(inviteeUri: string): Promise<CalendlyInvitee> {
  try {
    const response = await calendlyApi.get<{ resource: CalendlyInvitee }>(inviteeUri);
    return response.data.resource;
  } catch (error) {
    handleCalendlyError(error, 'getInvitee');
    throw error;
  }
}

// ============================================================================
// Phone Extraction
// ============================================================================

/**
 * Extract phone number from event invitee
 *
 * Checks multiple sources:
 * 1. text_reminder_number field
 * 2. Questions and answers (looks for phone-related questions)
 * 3. Tracking metadata
 *
 * @param invitee - Calendly invitee
 * @returns Normalized phone number or null
 */
export function extractPhoneFromInvitee(invitee: CalendlyInvitee): string | null {
  // Check text reminder number first (most reliable)
  if (invitee.text_reminder_number) {
    const normalized = normalizePhoneSafe(invitee.text_reminder_number);
    if (normalized) {
      logger.debug('Found phone in text_reminder_number', {
        inviteeUri: invitee.uri,
      });
      return normalized;
    }
  }

  // Check questions and answers
  const phoneQuestionPatterns = [
    /phone/i,
    /טלפון/i,
    /נייד/i,
    /מספר/i,
    /cell/i,
    /mobile/i,
    /whatsapp/i,
  ];

  for (const qa of invitee.questions_and_answers || []) {
    const isPhoneQuestion = phoneQuestionPatterns.some((pattern) =>
      pattern.test(qa.question)
    );

    if (isPhoneQuestion && qa.answer) {
      const normalized = normalizePhoneSafe(qa.answer);
      if (normalized) {
        logger.debug('Found phone in Q&A', {
          inviteeUri: invitee.uri,
          question: qa.question,
        });
        return normalized;
      }
    }
  }

  // Check tracking metadata (less common but possible)
  if (invitee.tracking?.salesforce_uuid) {
    // Some integrations store phone in salesforce_uuid
    const normalized = normalizePhoneSafe(invitee.tracking.salesforce_uuid);
    if (normalized) {
      return normalized;
    }
  }

  logger.debug('No phone found for invitee', {
    inviteeUri: invitee.uri,
    email: invitee.email,
  });

  return null;
}

/**
 * Extract phone from event (fetches invitees if needed)
 *
 * @param event - Calendly event
 * @returns Normalized phone number or null
 */
export async function extractPhoneFromEvent(event: CalendlyEvent): Promise<string | null> {
  try {
    // Get invitees for this event
    const invitees = await getEventInvitees(event.uri);

    if (invitees.length === 0) {
      logger.debug('No invitees found for event', { eventUri: event.uri });
      return null;
    }

    // Try to find phone from first active invitee
    for (const invitee of invitees) {
      const phone = extractPhoneFromInvitee(invitee);
      if (phone) {
        return phone;
      }
    }

    return null;
  } catch (error) {
    logger.error('Error extracting phone from event', {
      eventUri: event.uri,
      error: (error as Error).message,
    });
    return null;
  }
}

// ============================================================================
// Event Details
// ============================================================================

/**
 * Get full event details with invitees
 */
export async function getEventWithInvitees(eventUri: string): Promise<{
  event: CalendlyEvent;
  invitees: CalendlyInvitee[];
}> {
  try {
    const [eventResponse, invitees] = await Promise.all([
      calendlyApi.get<{ resource: CalendlyEvent }>(eventUri),
      getEventInvitees(eventUri),
    ]);

    return {
      event: eventResponse.data.resource,
      invitees,
    };
  } catch (error) {
    handleCalendlyError(error, 'getEventWithInvitees');
    throw error;
  }
}

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Handle Calendly API errors
 */
function handleCalendlyError(error: unknown, operation: string): void {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<CalendlyApiError>;
    const apiError = axiosError.response?.data;

    logger.error('Calendly API error', {
      operation,
      status: axiosError.response?.status,
      title: apiError?.title,
      message: apiError?.message,
      details: apiError?.details,
    });

    // Check for rate limiting
    if (axiosError.response?.status === 429) {
      logger.warn('Calendly rate limit exceeded');
    }

    // Check for auth errors
    if (axiosError.response?.status === 401) {
      logger.error('Calendly authentication failed - check access token');
    }
  } else {
    logger.error('Calendly service error', {
      operation,
      error: (error as Error).message,
    });
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if Calendly is properly configured
 */
export function isConfigured(): boolean {
  return !!(
    config.calendly.accessToken &&
    config.calendly.organizationUri &&
    config.calendly.eventTypeUri
  );
}

/**
 * Test Calendly connection
 */
export async function testConnection(): Promise<boolean> {
  try {
    const response = await calendlyApi.get('/users/me');
    logger.info('Calendly connection test successful', {
      user: response.data.resource?.name,
    });
    return true;
  } catch (error) {
    handleCalendlyError(error, 'testConnection');
    return false;
  }
}

// ============================================================================
// Exports
// ============================================================================

export default {
  getRecentEvents,
  getEventInvitees,
  getInvitee,
  extractPhoneFromInvitee,
  extractPhoneFromEvent,
  getEventWithInvitees,
  isConfigured,
  testConnection,
};
