import { createGeminiProvider } from './gemini.mjs';
import { createOllamaProvider } from './ollama.mjs';

export function createAIProvider(options = {}) {
  const env = options.env || process.env;
  if (env.AI_PROVIDER === 'ollama') return createOllamaProvider(options);
  if (env.AI_PROVIDER === 'vertex') return createGeminiProvider({ ...options, transport: 'vertex' });
  if (!env.AI_PROVIDER || env.AI_PROVIDER === 'gemini') return createGeminiProvider({ ...options, transport: 'gemini' });
  // Unknown provider configuration must not silently route private inputs.
  return { configured: false, model: null, method: 'gemini_youtube_video', reason: 'provider_not_configured' };
}
