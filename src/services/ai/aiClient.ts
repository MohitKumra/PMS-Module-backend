// backend/src/services/ai/aiClient.ts
// Unified AI client that supports Groq, OpenAI, and custom OpenAI-compatible
// endpoints while allowing provider/model switches without stale singleton state.

import OpenAI from 'openai';
import { env } from '../../config/env';

interface ProviderConfig {
  baseURL: string;
  defaultModel: string;
}

type ProviderName = 'groq' | 'openai' | 'custom';

interface ResolvedAIConfig {
  provider: ProviderName;
  baseURL: string;
  model: string;
  apiKey: string;
  cacheKey: string;
}

const PROVIDER_MAP: Record<'groq' | 'openai', ProviderConfig> = {
  groq: {
    baseURL: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.1-8b-instant',
  },
  openai: {
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
  },
};

/**
 * Models that natively support vision (image_url content blocks).
 * Requests with imageUrls will be automatically routed to the vision model
 * when the configured default model is text-only.
 */
const VISION_CAPABLE_MODELS = new Set([
  // Groq vision
  'qwen/qwen3.6-27b',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'llama-3.2-90b-vision-preview',
  'llama-3.2-11b-vision-preview',
  // OpenAI vision
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4-turbo',
  'gpt-4-vision-preview',
]);

/**
 * Fallback vision model per provider when the default model is text-only.
 * Override with AI_VISION_MODEL env var.
 */
const DEFAULT_VISION_MODEL: Record<'groq' | 'openai' | 'custom', string> = {
  groq: 'qwen/qwen3.6-27b',
  openai: 'gpt-4o-mini',
  custom: 'gpt-4o-mini',
};

function normalizeProvider(provider: string): ProviderName | null {
  if (provider === 'groq' || provider === 'openai') return provider;
  if (env.AI_BASE_URL) return 'custom';
  return null;
}

function resolveAIConfig(): ResolvedAIConfig | null {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const provider = normalizeProvider(env.AI_PROVIDER);
  if (!provider) return null;

  const providerConfig = provider === 'custom' ? undefined : PROVIDER_MAP[provider];
  const baseURL = env.AI_BASE_URL?.trim() || providerConfig?.baseURL || '';
  const model = env.AI_MODEL?.trim() || providerConfig?.defaultModel || 'gpt-4o-mini';

  if (!baseURL) return null;

  return {
    provider,
    baseURL,
    model,
    apiKey,
    cacheKey: [provider, baseURL, model, apiKey].join('|'),
  };
}

type CachedClient = {
  config: ResolvedAIConfig;

  client: OpenAI;
};

let cachedClient: CachedClient | null = null;

function getClient(): CachedClient | null {
  const config = resolveAIConfig();
  if (!config) return null;

  if (cachedClient && cachedClient.config.cacheKey === config.cacheKey) {
    return cachedClient;
  }

  cachedClient = {
    config,
    client: new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      timeout: 30_000,
      maxRetries: 2,
    }),
  };

  console.log(
    `[AI] Initialized with provider="${config.provider}" model="${config.model}" baseURL="${config.baseURL}"`
  );

  return cachedClient;
}

export interface AIRequestOptions {
  systemPrompt: string;
  userPrompt: string;
  /** Optional image URLs to include as vision content blocks alongside the user prompt */
  imageUrls?: string[];
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

export function isAIAvailable(): boolean {
  return resolveAIConfig() !== null;
}

export function getAIProvider(): string {
  return resolveAIConfig()?.provider || 'none';
}

export function getAIModel(): string {
  return resolveAIConfig()?.model || 'unknown';
}

/**
 * Extract usable text from a Chat Completions choice.
 * Handles three sources:
 *   • `message.content`  — the normal assistant reply (string or null).
 *   • `message.reasoning_content` — some reasoning models put the visible
 *     answer here while leaving `content` empty.
 *   • (deprecated `message.content` array) — not expected by the SDK but
 *     tolerated as flattened text.
 * Returns the trimmed text, or null if the model truly returned nothing.
 */
export function extractChatContent(
  message: {
    content?: string | Array<{ text?: string }> | null;
    reasoning_content?: string | null;
    refusal?: string | null;
  } | null
): string | null {
  if (!message) return null;

  let text = '';
  const content = message.content;
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content))
    text = content
      .map((part) => (part && typeof part === 'object' && typeof part.text === 'string' ? part.text : ''))
      .join('');

  // Secondary source: some models return reasoning in a separate field with
  // an empty `content`.
  if (!text && typeof message.reasoning_content === 'string') text = message.reasoning_content;

  return text.trim() || null;
}

/**
 * Extract the final assistant text from an OpenAI Responses API `Response`.
 * Prefers the SDK's `output_text` convenience field, then flattens any
 * `output` content blocks of type `output_text` (covers tool-call outputs).
 */
export function extractResponseText(response: {
  output_text?: string | null;
  output?: Array<{
    type?: string;
    text?: string | null;
    content?: Array<{ type?: string; text?: string | null }> | null;
  }>;
}): string | null {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const chunks: string[] = [];
  for (const item of response.output ?? []) {
    if (!item) continue;
    if (item.type === 'output_text' && typeof item.text === 'string' && item.text) {
      chunks.push(item.text);
      continue;
    }
    // Nested content array (e.g. message.output_text items).
    if (Array.isArray(item.content)) {
      for (const part of item.content) {
        if (part?.type === 'output_text' && typeof part.text === 'string' && part.text) {
          chunks.push(part.text);
        }
      }
    }
  }
  const text = chunks.join('');
  return text.trim() || null;
}

/** Strip any <think>...</think> block that some models wrap around their output. */
export function stripThinkBlock(text: string): string {
  return text
    .replace(/<\/think>\s*/i, '')
    .replace(/<think>[\s\S]*?$/i, '')
    .trim();
}

export async function complete(options: AIRequestOptions): Promise<AIResponse | null> {
  const cached = getClient();
  if (!cached) {
    console.warn('[AI] Not configured - set OPENAI_API_KEY and AI_PROVIDER (or AI_BASE_URL)');
    return null;
  }

  const maxTokens = options.maxTokens ?? parseInt(env.AI_max_completion_tokens || '1024', 10);
  const temperature = options.temperature ?? parseFloat(env.AI_TEMPERATURE || '1');
  const hasImages = Boolean(options.imageUrls && options.imageUrls.length > 0);

  // When the request includes images, automatically switch to a vision-capable
  // model if the configured default model is text-only. The override can be
  // pinned via the AI_VISION_MODEL env var.
  let modelToUse = cached.config.model;
  if (hasImages && !VISION_CAPABLE_MODELS.has(modelToUse)) {
    const visionOverride = env.AI_VISION_MODEL?.trim();
    modelToUse = visionOverride || DEFAULT_VISION_MODEL[cached.config.provider];
    console.log(`[AI] Vision request — switching model from "${cached.config.model}" to "${modelToUse}"`);
  }

  try {
    // Build the user message — plain text or vision content array when images are present
    const userMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam = hasImages
      ? {
          role: 'user',
          content: [
            { type: 'text', text: options.userPrompt },
            ...options.imageUrls!.map((url): OpenAI.Chat.Completions.ChatCompletionContentPartImage => ({
              type: 'image_url',
              image_url: { url, detail: 'auto' },
            })),
          ],
        }
      : { role: 'user', content: options.userPrompt };

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: options.systemPrompt },
      userMessage,
    ];

    const completion = await cached.client.chat.completions.create({
      model: modelToUse,
      messages,
      max_completion_tokens: maxTokens,
      temperature,
      ...(options.responseFormat === 'json_object' ? { response_format: { type: 'json_object' as const } } : {}),
      // Disable thinking mode on Qwen models — thinking wraps output in
      // <think>...</think> tags which breaks JSON.parse downstream.
      ...(modelToUse.startsWith('qwen/') ? { reasoning_effort: 'none' } : {}),
    });

    const choice = completion.choices[0];
    let content = extractChatContent(choice?.message ?? null);

    // If chat completions returned no usable text and this provider serves
    // Responses-API models (OpenAI), fall back to client.responses. Some
    // models (e.g. gpt-5.* reasoning models) return model output on the
    // Responses API while the Chat Completions `message.content` is empty.
    if (!content && cached.config.provider === 'openai') {
      const response = await cached.client.responses.create({
        model: modelToUse,
        input: `System: ${options.systemPrompt}\n\nUser: ${options.userPrompt}`,
        max_output_tokens: maxTokens,
        ...(options.responseFormat === 'json_object' ? { text: { format: { type: 'json_object' as const } } } : {}),
      });
      content = extractResponseText(response);

      if (content) {
        console.log(
          `[AI] Chat completions returned empty content; got reply via Responses API (model=${completion.model}).`
        );
      }
    }

    if (!content) {
      console.warn(
        `[AI] Empty response from provider (provider=${cached.config.provider}, model=${completion.model}, finish_reason=${choice?.finish_reason ?? 'unknown'}, usage=${JSON.stringify(completion.usage ?? null)})`
      );
      return null;
    }

    // Strip any <think>...</think> block that some models emit before the JSON
    const finalContent = stripThinkBlock(content);

    return {
      content: finalContent,
      model: completion.model,
      provider: cached.config.provider,
      usage: completion.usage
        ? {
            promptTokens: completion.usage.prompt_tokens,
            completionTokens: completion.usage.completion_tokens,
            totalTokens: completion.usage.total_tokens,
          }
        : null,
    };
  } catch (error: any) {
    console.error(`[AI] Request failed (provider=${cached.config.provider}):`, error.message);
    return null;
  }
}

export function resetClient(): void {
  cachedClient = null;
}
