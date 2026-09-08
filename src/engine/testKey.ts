/* "Test key" button (section 3): "makes one tiny call and shows the result in
 * words." One `max_tokens: 1` request per provider, through the SAME
 * non-streaming `Transports.requestFull` the adapters fall back to - a test
 * call has no reply to stream, so there is nothing streaming would buy it. */

import type { ModelProviderId, Transports } from './types';
import { toAnthropicTools } from './tools/definitions';

export interface TestKeyResult {
  ok: boolean;
  /** Plain words, ready to show as-is. Never a raw status code alone. */
  message: string;
}

function excerptOf(bodyText: string): string {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
      const err = (parsed as { error?: unknown }).error;
      if (typeof err === 'object' && err !== null && 'message' in err) {
        const message = (err as { message?: unknown }).message;
        if (typeof message === 'string') return message;
      }
    }
  } catch {
    // Not JSON; fall through to the raw excerpt below.
  }
  return bodyText.slice(0, 200);
}

async function testAnthropicKey(apiKey: string, transports: Transports, signal: AbortSignal): Promise<TestKeyResult> {
  const result = await transports.requestFull({
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'Hi' }],
      // Proves the key can also see tools, without spending output tokens on
      // an actual call: an empty definition list would test less than the
      // real request shape the engine sends on every turn.
      tools: toAnthropicTools([]),
    }),
    signal,
  });
  if (result.status >= 200 && result.status < 300) return { ok: true, message: 'The key works. Anthropic answered a real request.' };
  if (result.status === 401) return { ok: false, message: 'Anthropic rejected the key (401 - not authorized). Check it was copied in full.' };
  if (result.status === 429) return { ok: true, message: 'The key works, but Anthropic is rate-limiting it right now (429).' };
  return { ok: false, message: `Anthropic returned ${result.status}. ${excerptOf(result.bodyText)}` };
}

async function testOpenRouterKey(apiKey: string, transports: Transports, signal: AbortSignal): Promise<TestKeyResult> {
  const result = await transports.requestFull({
    url: 'https://openrouter.ai/api/v1/chat/completions',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://myicor.com',
      'X-Title': 'ICOR for Life - AI Chat',
    },
    body: JSON.stringify({
      model: 'anthropic/claude-haiku-4-5',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'Hi' }],
    }),
    signal,
  });
  if (result.status >= 200 && result.status < 300) return { ok: true, message: 'The key works. OpenRouter answered a real request.' };
  if (result.status === 401) return { ok: false, message: 'OpenRouter rejected the key (401 - not authorized). Check it was copied in full.' };
  if (result.status === 402) return { ok: false, message: 'OpenRouter rejected the key: no credit on the account (402).' };
  if (result.status === 429) return { ok: true, message: 'The key works, but OpenRouter is rate-limiting it right now (429).' };
  return { ok: false, message: `OpenRouter returned ${result.status}. ${excerptOf(result.bodyText)}` };
}

export async function testProviderKey(
  provider: ModelProviderId,
  apiKey: string,
  transports: Transports,
  signal: AbortSignal,
): Promise<TestKeyResult> {
  if (!apiKey.trim()) return { ok: false, message: 'There is no key to test yet.' };
  try {
    return provider === 'anthropic'
      ? await testAnthropicKey(apiKey, transports, signal)
      : await testOpenRouterKey(apiKey, transports, signal);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not reach the provider.' };
  }
}
