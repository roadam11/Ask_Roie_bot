/**
 * ConversAI — TypeScript Type Definitions
 * Multi-tenant WhatsApp AI Sales Agent
 */

// ============================================================================
// Enums
// ============================================================================

/**
 * Message direction
 */
export enum MessageDirection {
  INBOUND = 'inbound',
  OUTBOUND = 'outbound'
}

/**
 * Message status for delivery tracking
 */
export enum MessageStatus {
  PENDING = 'pending',
  SENT = 'sent',
  DELIVERED = 'delivered',
  READ = 'read',
  FAILED = 'failed'
}

/**
 * Follow-up status (matches database schema)
 */
export type FollowUpStatus = 'pending' | 'sent' | 'cancelled';

/**
 * Follow-up type/timing - Legacy types (matches database schema)
 */
export type LegacyFollowUpType = '24h' | '72h' | '7d';

/**
 * Follow-up type - New automation types
 */
export type AutomationFollowUpType =
  | 'thinking_24h'        // 24h after "אחשוב על זה"
  | 'trial_reminder_2h'   // 2h before trial lesson
  | 'trial_followup_24h'  // 24h after trial lesson
  | 'idle_48h';           // 48h no response

/**
 * All follow-up types (legacy + automation)
 */
export type FollowUpType = LegacyFollowUpType | AutomationFollowUpType;

/**
 * Lead state for follow-up automation (separate from sales pipeline status)
 */
export type LeadState =
  | 'new'              // First contact, no conversation yet
  | 'engaged'          // Active conversation in progress
  | 'thinking'         // User said "אחשוב על זה" or similar
  | 'trial_scheduled'  // Trial lesson booked
  | 'converted'        // Became paying student
  | 'closed';          // Not relevant / opted out

/**
 * Analytics event types
 */
export enum AnalyticsEventType {
  CONVERSATION_STARTED = 'conversation_started',
  MESSAGE_RECEIVED = 'message_received',
  MESSAGE_SENT = 'message_sent',
  LEAD_QUALIFIED = 'lead_qualified',
  BOOKING_LINK_SENT = 'booking_link_sent',
  BOOKING_COMPLETED = 'booking_completed',
  FOLLOW_UP_SENT = 'follow_up_sent',
  LEAD_CONVERTED = 'lead_converted',
  LEAD_LOST = 'lead_lost',
  ERROR_OCCURRED = 'error_occurred'
}

// ============================================================================
// Lead Interface
// ============================================================================

/** Education level options */
export type EducationLevel = 'elementary' | 'middle_school' | 'high_school' | 'college';

/** Tutoring format preference */
export type FormatPreference = 'zoom' | 'frontal' | 'undecided';

/** Lead status in the sales pipeline */
export type LeadStatusType = 'new' | 'qualified' | 'considering' | 'hesitant' | 'ready_to_book' | 'booked' | 'lost';

/** Whether the contact is a parent or student */
export type ParentOrStudent = 'parent' | 'student' | 'unknown';

/** Urgency level */
export type UrgencyLevel = 'high' | 'medium' | 'low';

/** Type of objection raised by lead */
export type ObjectionType = 'price' | 'time' | 'format' | 'trust' | 'other' | 'none';

/**
 * Represents a lead/prospect in the system
 */
export interface Lead {
  /** Unique identifier for the lead */
  id: string;

  /** WhatsApp phone number (with country code) */
  phone: string;

  /** Lead's display name */
  name?: string;

  /** Subjects the lead is interested in */
  subjects?: string[];

  /** Education level */
  level?: EducationLevel;

  /** Specific grade or year details */
  grade_details?: string;

  /** Preferred tutoring format */
  format_preference?: FormatPreference;

  /** Current status in the sales pipeline */
  status: LeadStatusType;

  /** Whether contact is parent or student */
  parent_or_student?: ParentOrStudent;

  /** Whether student has an upcoming exam */
  has_exam?: boolean;

  /** Urgency level of the lead */
  urgency?: UrgencyLevel;

  /** Type of objection raised (if any) */
  objection_type?: ObjectionType;

  /** Whether a trial lesson was offered */
  trial_offered?: boolean;

  /** Whether booking has been completed */
  booking_completed?: boolean;

  /** Timestamp when booking was made */
  booked_at?: Date;

  /** Calendly event URI if booked */
  calendly_event_uri?: string;

  /** Agent ID linking to account for multi-tenant filtering */
  agent_id?: string;

  /** Whether this is a demo/simulated lead */
  is_demo?: boolean;

  /** Whether the lead has opted out of communications */
  opted_out?: boolean;

  /** Whether this lead needs human follow-up */
  needs_human_followup?: boolean;

  // ============================================================================
  // Follow-up Automation Fields
  // ============================================================================

  /** Lead state for follow-up automation (separate from sales status) */
  lead_state?: LeadState;

  /** When the next follow-up is scheduled */
  follow_up_scheduled_at?: Date;

  /** Type of the scheduled follow-up */
  follow_up_type?: AutomationFollowUpType;

  /** Number of follow-ups sent (max 3) */
  follow_up_count?: number;

  /** Priority of current follow-up (0-100) */
  follow_up_priority?: number;

  /** When trial lesson is scheduled */
  trial_scheduled_at?: Date;

  /** When trial lesson was completed */
  trial_completed_at?: Date;

  /** When Roie last manually contacted (blocks automation for 48h) */
  human_contacted_at?: Date;

  // ============================================================================
  // Lead Profile (structured data extracted from conversation)
  // ============================================================================

  /** Structured profile data extracted from conversation history */
  lead_profile?: Record<string, unknown>;

  // ============================================================================
  // Message Tracking Fields
  // ============================================================================

  /** Timestamp of last message received from user */
  last_user_message_at?: Date;

  /** Timestamp of last message sent by bot */
  last_bot_message_at?: Date;

  /** Timestamp of last follow-up message sent */
  last_followup_sent_at?: Date;

  /** Record creation timestamp */
  created_at: Date;

  /** Record last update timestamp */
  updated_at: Date;
}

/**
 * Data required to create a new lead
 */
export interface CreateLeadInput {
  phone: string;
  name?: string;
  status?: LeadStatusType;
}

/**
 * Data for updating an existing lead
 */
export interface UpdateLeadInput {
  name?: string;
  subjects?: string[];
  level?: EducationLevel;
  grade_details?: string;
  format_preference?: FormatPreference;
  status?: LeadStatusType;
  parent_or_student?: ParentOrStudent;
  has_exam?: boolean;
  urgency?: UrgencyLevel;
  objection_type?: ObjectionType;
  trial_offered?: boolean;
  booking_completed?: boolean;
  booked_at?: Date;
  calendly_event_uri?: string;
  opted_out?: boolean;
  needs_human_followup?: boolean;
  last_user_message_at?: Date;
  last_bot_message_at?: Date;
  last_followup_sent_at?: Date;
  // Follow-up automation fields
  lead_state?: LeadState;
  follow_up_scheduled_at?: Date;
  follow_up_type?: AutomationFollowUpType;
  follow_up_count?: number;
  follow_up_priority?: number;
  trial_scheduled_at?: Date;
  trial_completed_at?: Date;
  human_contacted_at?: Date;
}

// ============================================================================
// Message Interface
// ============================================================================

/**
 * Represents a conversation message
 */
export interface Message {
  /** Unique identifier for the message */
  id: string;

  /** Reference to the lead */
  leadId: string;

  /** WhatsApp message ID */
  whatsappMessageId: string | null;

  /** Message direction (inbound/outbound) */
  direction: MessageDirection;

  /** Message content/body */
  content: string;

  /** Message type (text, image, document, etc.) */
  messageType: WhatsAppMessageType;

  /** Media URL if applicable */
  mediaUrl: string | null;

  /** Delivery status */
  status: MessageStatus;

  /** Claude conversation role */
  claudeRole: 'user' | 'assistant';

  /** Tool calls made during this message (for assistant messages) */
  toolCalls: ClaudeToolCall[] | null;

  /** Error message if sending failed */
  errorMessage: string | null;

  /** Message sent/received timestamp */
  timestamp: Date;

  /** Record creation timestamp */
  createdAt: Date;
}

/**
 * Data required to create a new message
 */
export interface CreateMessageInput {
  leadId: string;
  whatsappMessageId?: string;
  direction: MessageDirection;
  content: string;
  messageType?: WhatsAppMessageType;
  mediaUrl?: string;
  claudeRole: 'user' | 'assistant';
  toolCalls?: ClaudeToolCall[];
}

// ============================================================================
// Follow-Up Interface
// ============================================================================

/**
 * Represents a scheduled follow-up message
 */
export interface FollowUp {
  /** Unique identifier for the follow-up */
  id: string;

  /** Reference to the lead */
  lead_id: string;

  /** Scheduled send time */
  scheduled_for: Date;

  /** Type of follow-up timing */
  type: FollowUpType;

  /** Current status */
  status: FollowUpStatus;

  /** Message template identifier */
  message_template?: string;

  /** Template name */
  template_name?: string;

  /** Priority (0-100, higher = more important) */
  priority?: number;

  /** BullMQ job ID for cancellation */
  job_id?: string;

  /** Record creation timestamp */
  created_at: Date;

  /** Actual send time */
  sent_at?: Date;
}

/**
 * Data required to create a new follow-up
 */
export interface CreateFollowUpInput {
  lead_id: string;
  type: FollowUpType;
  scheduled_for: Date;
  template_name?: string;
  priority?: number;
  job_id?: string;
}

// ============================================================================
// Analytics Interface
// ============================================================================

/**
 * Represents an analytics event
 */
export interface Analytics {
  /** Unique identifier for the event */
  id: string;

  /** Event type */
  eventType: AnalyticsEventType;

  /** Reference to the lead (if applicable) */
  leadId: string | null;

  /** Reference to the message (if applicable) */
  messageId: string | null;

  /** Event-specific data */
  eventData: Record<string, unknown>;

  /** Session identifier for grouping events */
  sessionId: string | null;

  /** Event timestamp */
  timestamp: Date;

  /** Record creation timestamp */
  createdAt: Date;
}

/**
 * Data required to create a new analytics event
 */
export interface CreateAnalyticsInput {
  eventType: AnalyticsEventType;
  leadId?: string;
  messageId?: string;
  eventData?: Record<string, unknown>;
  sessionId?: string;
}

/**
 * Analytics summary for dashboard
 */
export interface AnalyticsSummary {
  /** Total number of leads */
  totalLeads: number;

  /** Leads by status */
  leadsByStatus: Record<LeadStatusType, number>;

  /** Total messages sent */
  messagesSent: number;

  /** Total messages received */
  messagesReceived: number;

  /** Total bookings */
  totalBookings: number;

  /** Conversion rate (booked/total leads) */
  conversionRate: number;

  /** Average response time in seconds */
  avgResponseTime: number;

  /** Time period for the summary */
  period: {
    start: Date;
    end: Date;
  };
}

// ============================================================================
// Claude API Interfaces
// ============================================================================

/**
 * Represents a tool call made by Claude
 */
export interface ClaudeToolCall {
  /** Tool call unique identifier */
  id: string;

  /** Name of the tool being called */
  name: string;

  /** Input parameters for the tool */
  input: Record<string, unknown>;

  /** Result of the tool execution */
  result?: unknown;

  /** Whether the tool call was successful */
  success?: boolean;

  /** Error message if the tool call failed */
  error?: string;
}

/**
 * Tool definition for Claude
 */
export interface ClaudeTool {
  /** Tool name */
  name: string;

  /** Tool description */
  description: string;

  /** JSON Schema for input parameters */
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Claude API message format
 */
export interface ClaudeMessage {
  /** Role of the message sender */
  role: 'user' | 'assistant';

  /** Message content */
  content: string | ClaudeContentBlock[];
}

/**
 * Claude content block types
 */
export type ClaudeContentBlock =
  | ClaudeTextBlock
  | ClaudeToolUseBlock
  | ClaudeToolResultBlock;

/**
 * Text content block
 */
export interface ClaudeTextBlock {
  type: 'text';
  text: string;
}

/**
 * Tool use content block
 */
export interface ClaudeToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Tool result content block
 */
export interface ClaudeToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/**
 * Claude API response
 */
export interface ClaudeResponse {
  /** Response unique identifier */
  id: string;

  /** Object type (always 'message') */
  type: 'message';

  /** Role (always 'assistant') */
  role: 'assistant';

  /** Response content blocks */
  content: ClaudeContentBlock[];

  /** Model used for generation */
  model: string;

  /** Stop reason */
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';

  /** Stop sequence if applicable */
  stop_sequence: string | null;

  /** Token usage statistics */
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Claude API request configuration
 */
export interface ClaudeRequestConfig {
  /** Model to use */
  model: string;

  /** Maximum tokens to generate */
  max_tokens: number;

  /** System prompt */
  system?: string;

  /** Conversation messages */
  messages: ClaudeMessage[];

  /** Available tools */
  tools?: ClaudeTool[];

  /** Temperature for generation */
  temperature?: number;

  /** Top-p sampling */
  top_p?: number;
}

// ============================================================================
// WhatsApp Webhook Interfaces
// ============================================================================

/**
 * WhatsApp message types
 */
export type WhatsAppMessageType =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contacts'
  | 'interactive'
  | 'button'
  | 'reaction'
  | 'unknown';

/**
 * WhatsApp webhook payload (top-level)
 */
export interface WhatsAppWebhookPayload {
  /** Object type (always 'whatsapp_business_account') */
  object: 'whatsapp_business_account';

  /** Array of entry objects */
  entry: WhatsAppWebhookEntry[];
}

/**
 * WhatsApp webhook entry
 */
export interface WhatsAppWebhookEntry {
  /** WhatsApp Business Account ID */
  id: string;

  /** Array of changes */
  changes: WhatsAppWebhookChange[];
}

/**
 * WhatsApp webhook change object
 */
export interface WhatsAppWebhookChange {
  /** Value containing the actual data */
  value: WhatsAppWebhookValue;

  /** Field that changed (messages, statuses, etc.) */
  field: string;
}

/**
 * WhatsApp webhook value object
 */
export interface WhatsAppWebhookValue {
  /** Messaging product (always 'whatsapp') */
  messaging_product: 'whatsapp';

  /** Metadata about the business */
  metadata: WhatsAppMetadata;

  /** Contact information */
  contacts?: WhatsAppContact[];

  /** Array of messages */
  messages?: WhatsAppIncomingMessage[];

  /** Array of status updates */
  statuses?: WhatsAppStatusUpdate[];

  /** Errors if any */
  errors?: WhatsAppError[];
}

/**
 * WhatsApp metadata
 */
export interface WhatsAppMetadata {
  /** Display phone number */
  display_phone_number: string;

  /** Phone number ID */
  phone_number_id: string;
}

/**
 * WhatsApp contact info
 */
export interface WhatsAppContact {
  /** Contact's WhatsApp profile */
  profile: {
    name: string;
  };

  /** Contact's WhatsApp ID (phone number) */
  wa_id: string;
}

/**
 * WhatsApp incoming message
 */
export interface WhatsAppIncomingMessage {
  /** Sender's WhatsApp ID */
  from: string;

  /** Message ID */
  id: string;

  /** Message timestamp (Unix epoch) */
  timestamp: string;

  /** Message type */
  type: WhatsAppMessageType;

  /** Text message content */
  text?: {
    body: string;
  };

  /** Image message content */
  image?: WhatsAppMediaObject;

  /** Audio message content */
  audio?: WhatsAppMediaObject;

  /** Video message content */
  video?: WhatsAppMediaObject;

  /** Document message content */
  document?: WhatsAppMediaObject & {
    filename?: string;
  };

  /** Location message content */
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };

  /** Interactive message response */
  interactive?: {
    type: 'button_reply' | 'list_reply';
    button_reply?: {
      id: string;
      title: string;
    };
    list_reply?: {
      id: string;
      title: string;
      description?: string;
    };
  };

  /** Button response */
  button?: {
    payload: string;
    text: string;
  };

  /** Message context (for replies) */
  context?: {
    from: string;
    id: string;
  };

  /** Reaction to a message */
  reaction?: {
    message_id: string;
    emoji: string;
  };
}

/**
 * WhatsApp media object
 */
export interface WhatsAppMediaObject {
  /** Media caption */
  caption?: string;

  /** MIME type */
  mime_type: string;

  /** SHA256 hash */
  sha256: string;

  /** Media ID for downloading */
  id: string;
}

/**
 * WhatsApp message status update
 */
export interface WhatsAppStatusUpdate {
  /** Message ID */
  id: string;

  /** Status */
  status: 'sent' | 'delivered' | 'read' | 'failed';

  /** Timestamp */
  timestamp: string;

  /** Recipient ID */
  recipient_id: string;

  /** Conversation info */
  conversation?: {
    id: string;
    origin: {
      type: 'user_initiated' | 'business_initiated' | 'referral_conversion';
    };
    expiration_timestamp?: string;
  };

  /** Pricing info */
  pricing?: {
    billable: boolean;
    pricing_model: string;
    category: string;
  };

  /** Error info if status is 'failed' */
  errors?: WhatsAppError[];
}

/**
 * WhatsApp error object
 */
export interface WhatsAppError {
  /** Error code */
  code: number;

  /** Error title */
  title: string;

  /** Error message */
  message?: string;

  /** Error details */
  error_data?: {
    details: string;
  };
}

// ============================================================================
// WhatsApp Outgoing Message Interfaces
// ============================================================================

/**
 * WhatsApp outgoing text message
 */
export interface WhatsAppOutgoingTextMessage {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'text';
  text: {
    preview_url?: boolean;
    body: string;
  };
}

/**
 * WhatsApp outgoing interactive message
 */
export interface WhatsAppOutgoingInteractiveMessage {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'interactive';
  interactive: {
    type: 'button' | 'list';
    header?: {
      type: 'text' | 'image' | 'video' | 'document';
      text?: string;
    };
    body: {
      text: string;
    };
    footer?: {
      text: string;
    };
    action: WhatsAppInteractiveAction;
  };
}

/**
 * WhatsApp interactive action
 */
export type WhatsAppInteractiveAction =
  | {
      buttons: Array<{
        type: 'reply';
        reply: {
          id: string;
          title: string;
        };
      }>;
    }
  | {
      button: string;
      sections: Array<{
        title?: string;
        rows: Array<{
          id: string;
          title: string;
          description?: string;
        }>;
      }>;
    };

/**
 * WhatsApp send message response
 */
export interface WhatsAppSendMessageResponse {
  messaging_product: 'whatsapp';
  contacts: Array<{
    input: string;
    wa_id: string;
  }>;
  messages: Array<{
    id: string;
  }>;
}

// ============================================================================
// Calendly Interfaces
// ============================================================================

/**
 * Calendly event data
 */
export interface CalendlyEvent {
  /** Event URI */
  uri: string;

  /** Event name */
  name: string;

  /** Event status */
  status: 'active' | 'canceled';

  /** Start time */
  start_time: string;

  /** End time */
  end_time: string;

  /** Event type URI */
  event_type: string;

  /** Location info */
  location: {
    type: string;
    location?: string;
    join_url?: string;
  };

  /** Invitees counter */
  invitees_counter: {
    total: number;
    active: number;
    limit: number;
  };

  /** Created at timestamp */
  created_at: string;

  /** Updated at timestamp */
  updated_at: string;
}

/**
 * Calendly invitee data
 */
export interface CalendlyInvitee {
  /** Invitee URI */
  uri: string;

  /** Email address */
  email: string;

  /** Name */
  name: string;

  /** Status */
  status: 'active' | 'canceled';

  /** Timezone */
  timezone: string;

  /** Event URI */
  event: string;

  /** Created at timestamp */
  created_at: string;

  /** Updated at timestamp */
  updated_at: string;

  /** Custom questions and answers */
  questions_and_answers?: Array<{
    question: string;
    answer: string;
  }>;
}

/**
 * Calendly webhook payload
 */
export interface CalendlyWebhookPayload {
  /** Event type */
  event: 'invitee.created' | 'invitee.canceled';

  /** Created at timestamp */
  created_at: string;

  /** Payload data */
  payload: {
    event: CalendlyEvent;
    invitee: CalendlyInvitee;
    questions_and_answers?: Array<{
      question: string;
      answer: string;
    }>;
    tracking?: {
      utm_campaign?: string;
      utm_source?: string;
      utm_medium?: string;
      utm_content?: string;
      utm_term?: string;
    };
  };
}

// ============================================================================
// API Response Interfaces
// ============================================================================

/**
 * Standard API response wrapper
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    timestamp: string;
    requestId?: string;
  };
}

/**
 * Paginated API response
 */
export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// ============================================================================
// Configuration Interfaces
// ============================================================================

/**
 * Application configuration
 */
export interface AppConfig {
  /** Server configuration */
  server: {
    port: number;
    nodeEnv: 'development' | 'production' | 'test';
  };

  /** Database configuration */
  database: {
    url: string;
    poolSize?: number;
  };

  /** Redis configuration */
  redis: {
    url: string;
  };

  /** WhatsApp configuration */
  whatsapp: {
    phoneNumberId: string;
    businessAccountId: string;
    accessToken: string;
    webhookVerifyToken: string;
  };

  /** Claude/Anthropic configuration */
  anthropic: {
    apiKey: string;
    model?: string;
    maxTokens?: number;
  };

  /** Calendly configuration */
  calendly: {
    accessToken: string;
    organizationUri: string;
    eventTypeUri: string;
  };

  /** Admin configuration */
  admin: {
    username: string;
    password: string;
  };

  /** Logging configuration */
  logging: {
    level: 'error' | 'warn' | 'info' | 'debug';
  };
}

