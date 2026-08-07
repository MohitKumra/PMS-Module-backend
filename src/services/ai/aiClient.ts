// backend/src/services/ai/aiClient.ts
// Unified AI client that works with any OpenAI-compatible provider (OpenAI, Groq, etc.)
// Switch providers by changing AI_PROVIDER env var — no code changes needed.

import OpenAI from 'openai';
import { env } from '../../config/env';

// ─── Provider Configuration ───────────────────────────────────────────────────

interface ProviderConfig {
  baseURL: string;
  defaultModel: string;
}

const PROVIDER_MAP: Record<string, ProviderConfig> = {
  groq: {
    baseURL: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.1-8b-instant' //Fast, free-tier model on Groq
  },
  openai: {
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini', // Cheap, fast model for production
  },
};

function getProviderConfig(): ProviderConfig | null {
  const provider = env.AI_PROVIDER;
  if (!provider) return null;

  // If a custom base URL is set, use that with the specified provider's model
  if (env.AI_BASE_URL) {
    return {
      baseURL: env.AI_BASE_URL,
      defaultModel: env.AI_MODEL || PROVIDER_MAP[provider]?.defaultModel || 'gpt-4o-mini',
    };
  }

  return PROVIDER_MAP[provider] || null;
}

// ─── AI Client Singleton ──────────────────────────────────────────────────────

let client: OpenAI | null = null;
let currentModel: string = 'gpt-4o-mini';

function getClient(): OpenAI | null {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) return null;

  if (client) return client;

  const config = getProviderConfig();
  if (!config) return null;

  currentModel = env.AI_MODEL || config.defaultModel;

  client = new OpenAI({
    apiKey,
    baseURL: config.baseURL,
    timeout: 30_000, // 30 second timeout
    maxRetries: 2,
  });

  console.log(`[AI] Initialized with provider="${env.AI_PROVIDER}" model="${currentModel}"`);
  return client;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface AIRequestOptions {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
  responseFormat?: 'text' | 'json_object';
}

export interface AIResponse {
  content: string;
  model: string;
  provider: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
}

/**
 * Check if AI is configured and available.
 */
export function isAIAvailable(): boolean {
  return !!env.OPENAI_API_KEY && !!env.AI_PROVIDER;
}

/**
 * Get the current provider name for display/debugging.
 */
export function getAIProvider(): string {
  return env.AI_PROVIDER || 'none';
}

/**
 * Get the current model name for display/debugging.
 */
export function getAIModel(): string {
  if (env.AI_MODEL) return env.AI_MODEL;
  const config = getProviderConfig();
  return config?.defaultModel || 'unknown';
}

/**
 * Send a completion request to the configured AI provider.
 * Returns null if AI is not configured or if the request fails.
 * The caller is responsible for fallback logic.
 */
export async function complete(options: AIRequestOptions): Promise<AIResponse | null> {
  const aiClient = getClient();
  if (!aiClient) {
    console.warn('[AI] Not configured — set OPENAI_API_KEY and AI_PROVIDER');
    return null;
  }

  const maxTokens = options.maxTokens ?? parseInt(env.AI_max_completion_tokens || '1024', 10);
  const temperature = options.temperature ?? parseFloat(env.AI_TEMPERATURE || '0.7');

  try {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: options.systemPrompt },
      { role: 'user', content: options.userPrompt },
    ];

    const completion = await aiClient.chat.completions.create({
      model: currentModel,
      messages,
      max_completion_tokens: maxTokens,
      temperature,
      ...(options.responseFormat === 'json_object'
        ? { response_format: { type: 'json_object' as const } }
        : {}),
    });

    const choice = completion.choices[0];
    if (!choice?.message?.content) {
      console.warn('[AI] Empty response from provider');
      return null;
    }

    return {
      content: choice.message.content,
      model: completion.model,
      provider: env.AI_PROVIDER || 'unknown',
      usage: completion.usage
        ? {
            promptTokens: completion.usage.prompt_tokens,
            completionTokens: completion.usage.completion_tokens,
            totalTokens: completion.usage.total_tokens,
          }
        : null,
    };
  } catch (error: any) {
    console.error(`[AI] Request failed (provider=${env.AI_PROVIDER}):`, error.message);
    return null;
  }
}

/**
 * Reset the client (useful for testing or reconfiguration).
 */
export function resetClient(): void {
  client = null;
}