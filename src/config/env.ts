// backend/src/config/env.ts
// Single validated import point for all environment variables.
// Fail fast at startup if required vars are missing.
import { z } from 'zod';

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/api\/?$/i, '').replace(/\/+$/, '');
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3001'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().default('noreply@productivity.app'),

  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_EMAIL: z.string().default('mailto:admin@productivity.app'),

  COMPANY_NAME: z.string().default('Finamite Solutions LLP'),
  COMPANY_GSTIN: z.string().optional().default(''),
  COMPANY_EMAIL: z.string().email().optional().default('info@finamite.in'),
  COMPANY_PHONE: z.string().optional().default(''),
  COMPANY_ADDRESS_LINE1: z.string().default('3614, Sector 32-A, Chandigarh Road, Urban Estate'),
  COMPANY_ADDRESS_LINE2: z.string().default('Jamalpur, Ludhiana'),
  COMPANY_CITY_STATE: z.string().default('Punjab'),
  COMPANY_PINCODE: z.string().default('141010'),
  COMPANY_PLACE_OF_SUPPLY: z.string().default('Punjab (03)'),
  COMPANY_WEBSITE: z.string().optional().default(''),
  // Service Accounting Code (SAC) for the billed service. This is a temporary
  // placeholder default — admins should set the tax-advisor-confirmed SAC via
  // Admin → Billing → Invoice Settings, which overrides this env value.
  COMPANY_SAC: z.string().optional().default('9983'),

  NOTION_CLIENT_ID: z.string().optional(),
  NOTION_CLIENT_SECRET: z.string().optional(),
  NOTION_REDIRECT_URI: z.string().default('http://localhost:3001/api/notion/oauth/callback'),

  BACKEND_URL: z.string().default('http://localhost:3001').transform(normalizeBaseUrl),
  FRONTEND_URL: z.string().default('http://localhost:5173').transform(normalizeBaseUrl),

  JWT_ADMIN_SECRET: z.string().min(32, 'JWT_ADMIN_SECRET must be at least 32 characters').default('super-secret-admin-jwt-key-minimum-32-chars-finamite'),
  JWT_ADMIN_EXPIRES_IN: z.string().default('15m'),
  ADMIN_EMAIL: z.string().email().optional().default('admin@finamite.com'),
  ADMIN_PASSWORD_HASH: z.string().optional(),

  // Razorpay Configuration
  RAZORPAY_KEY_ID: z.string().optional().default('rzp_test_dummy_key_id'),
  RAZORPAY_KEY_SECRET: z.string().optional().default('rzp_test_dummy_key_secret'),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional().default('rzp_webhook_secret_key_123'),
  RAZORPAY_MODE: z.enum(['test', 'live']).default('test'),

  // AI Provider Configuration
  // The env var is named OPENAI_API_KEY for familiarity, but it works with any OpenAI-compatible provider.
  // Set AI_PROVIDER to 'groq' for Groq, 'openai' for OpenAI, or leave blank to disable AI features.
  OPENAI_API_KEY: z.string().optional(),
  AI_PROVIDER: z.enum(['groq', 'openai', '']).default(''),
  AI_MODEL: z.string().optional(),
  // Vision model to use when the default AI_MODEL does not support images.
  // Defaults: groq → qwen/qwen3.6-27b, openai → gpt-4o-mini
  AI_VISION_MODEL: z.string().optional(),
  AI_BASE_URL: z.string().optional(),
  AI_max_completion_tokens: z.string().default('1024'),
  AI_TEMPERATURE: z.string().default('1'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌  Invalid environment variables:');
  parsed.error.issues.forEach((issue) => {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  });
  process.exit(1);
}

export const env = parsed.data;
