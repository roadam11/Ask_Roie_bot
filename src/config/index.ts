/**
 * Application Configuration
 *
 * Loads and validates environment variables from .env file
 * using Zod for runtime type safety.
 *
 * @example
 * import config from './config/index.js';
 * console.log(config.server.port); // 3000
 */

import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env file
dotenvConfig();

// ============================================================================
// Environment Variable Schema
// ============================================================================

const envSchema = z.object({
  // Server
  PORT: z
    .string()
    .default('3000')
    .transform((val) => parseInt(val, 10)),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),

  // Database
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required'),

  // Redis
  REDIS_URL: z
    .string()
    .min(1, 'REDIS_URL is required'),

  // WhatsApp Cloud API
  WHATSAPP_PHONE_NUMBER_ID: z
    .string()
    .min(1, 'WHATSAPP_PHONE_NUMBER_ID is required'),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z
    .string()
    .min(1, 'WHATSAPP_BUSINESS_ACCOUNT_ID is required'),
  WHATSAPP_ACCESS_TOKEN: z
    .string()
    .min(1, 'WHATSAPP_ACCESS_TOKEN is required'),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z
    .string()
    .min(1, 'WHATSAPP_WEBHOOK_VERIFY_TOKEN is required'),

  // Claude API
  ANTHROPIC_API_KEY: z
    .string()
    .min(1, 'ANTHROPIC_API_KEY is required')
    .startsWith('sk-ant-', 'ANTHROPIC_API_KEY must start with sk-ant-'),

  // Calendly
  CALENDLY_ACCESS_TOKEN: z
    .string()
    .min(1, 'CALENDLY_ACCESS_TOKEN is required'),
  CALENDLY_ORGANIZATION_URI: z
    .string()
    .url('CALENDLY_ORGANIZATION_URI must be a valid URL'),
  CALENDLY_EVENT_TYPE_URI: z
    .string()
    .url('CALENDLY_EVENT_TYPE_URI must be a valid URL'),

  // Admin
  ADMIN_USERNAME: z
    .string()
    .min(1, 'ADMIN_USERNAME is required'),
  ADMIN_PASSWORD: z
    .string()
    .min(8, 'ADMIN_PASSWORD must be at least 8 characters'),

  // Logging
  LOG_LEVEL: z
    .enum(['error', 'warn', 'info', 'debug'])
    .default('info'),
});

// ============================================================================
// Parse and Validate Environment
// ============================================================================

/**
 * Parses and validates environment variables
 * @throws {Error} If validation fails with details about missing/invalid vars
 */
function parseEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `\n❌ Environment validation failed:\n${errors}\n\n` +
      `💡 Make sure you have copied .env.example to .env and filled in all required values.\n`
    );
  }

  return result.data;
}

const env = parseEnv();

// ============================================================================
// Configuration Object
// ============================================================================

/**
 * Server configuration
 */
interface ServerConfig {
  /** Server port number */
  port: number;
  /** Environment mode */
  nodeEnv: 'development' | 'production' | 'test';
  /** Whether running in production */
  isProduction: boolean;
  /** Whether running in development */
  isDevelopment: boolean;
}

/**
 * Database configuration
 */
interface DatabaseConfig {
  /** PostgreSQL connection URL */
  url: string;
}

/**
 * Redis configuration
 */
interface RedisConfig {
  /** Redis connection URL */
  url: string;
}

/**
 * WhatsApp Cloud API configuration
 */
interface WhatsAppConfig {
  /** Phone number ID from Meta Business Suite */
  phoneNumberId: string;
  /** Business account ID */
  businessAccountId: string;
  /** Permanent access token */
  accessToken: string;
  /** Webhook verification token */
  webhookVerifyToken: string;
  /** WhatsApp API base URL */
  apiBaseUrl: string;
}

/**
 * Anthropic/Claude API configuration
 */
interface AnthropicConfig {
  /** Anthropic API key */
  apiKey: string;
  /** Default model to use */
  model: string;
  /** Maximum tokens for responses */
  maxTokens: number;
}

/**
 * Calendly API configuration
 */
interface CalendlyConfig {
  /** Personal access token */
  accessToken: string;
  /** Organization URI */
  organizationUri: string;
  /** Event type URI for trial lessons */
  eventTypeUri: string;
  /** Calendly API base URL */
  apiBaseUrl: string;
}

/**
 * Admin dashboard configuration
 */
interface AdminConfig {
  /** Admin username */
  username: string;
  /** Admin password */
  password: string;
}

/**
 * Logging configuration
 */
interface LoggingConfig {
  /** Winston log level */
  level: 'error' | 'warn' | 'info' | 'debug';
}

/**
 * Complete application configuration
 */
interface Config {
  server: ServerConfig;
  database: DatabaseConfig;
  redis: RedisConfig;
  whatsapp: WhatsAppConfig;
  anthropic: AnthropicConfig;
  calendly: CalendlyConfig;
  admin: AdminConfig;
  logging: LoggingConfig;
}

// ============================================================================
// Build Configuration Object
// ============================================================================

/**
 * Application configuration object
 * Validated and typed from environment variables
 */
const config: Config = {
  server: {
    port: env.PORT,
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    isDevelopment: env.NODE_ENV === 'development',
  },

  database: {
    url: env.DATABASE_URL,
  },

  redis: {
    url: env.REDIS_URL,
  },

  whatsapp: {
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    businessAccountId: env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    webhookVerifyToken: env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    apiBaseUrl: 'https://graph.facebook.com/v18.0',
  },

anthropic: {
    apiKey: env.ANTHROPIC_API_KEY,
    model: 'claude-3-5-sonnet-20241022',
    maxTokens: 1024,
  },

  calendly: {
    accessToken: env.CALENDLY_ACCESS_TOKEN,
    organizationUri: env.CALENDLY_ORGANIZATION_URI,
    eventTypeUri: env.CALENDLY_EVENT_TYPE_URI,
    apiBaseUrl: 'https://api.calendly.com',
  },

  admin: {
    username: env.ADMIN_USERNAME,
    password: env.ADMIN_PASSWORD,
  },

  logging: {
    level: env.LOG_LEVEL,
  },
};

// ============================================================================
// Exports
// ============================================================================

export default config;

export type {
  Config,
  ServerConfig,
  DatabaseConfig,
  RedisConfig,
  WhatsAppConfig,
  AnthropicConfig,
  CalendlyConfig,
  AdminConfig,
  LoggingConfig,
};
