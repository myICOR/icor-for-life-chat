/* THE REAL WIRE. `chat-mobile-engine-spec-v1.md` section 5: "`fetch` with
 * streaming where the WebView allows it ... `requestUrl` non-streaming as the
 * fallback." This is the only file in `src/engine/` that touches either: the
 * adapters take a `Transports` object as a parameter (see `types.ts`) and
 * never import `obsidian` or reach for the global `fetch` themselves, so
 * their tests replay a fixture through a fake `Transports` instead - no live
 * call, no Obsidian runtime, and this file carries the one place a real
 * network attempt is made.
 *
 * DETECTION IS THE ATTEMPT, not a platform check: `resolveTransports()` does
 * not ask `Platform.isMobile`. Every adapter tries `stream()` first and falls
 * back to `requestFull()` on ANY failure - a rejected fetch, a response with
 * no readable body, a network error mid-read. That is deliberate: a WebView
 * that streams today and stops after an OS update, or a member on a
 * corporate network whose proxy buffers the whole response, both get the
 * same honest fallback without a version check anywhere.
 *
 * NOT MEASURED ON A REAL IPHONE YET. Task brief: "Mack verifies both on a
 * real iPhone before the view work starts." This build could only be
 * typechecked and gated on a Mac; the transport findings below are read from
 * Obsidian's and MDN's own documented behaviour, not a device. See the
 * report back to Larry for what specifically still needs the device pass.
 *
 * KNOWN GAP: Obsidian's `RequestUrlParam` (checked against the installed
 * `obsidian` package's own `.d.ts`, 2026-09-06) carries no `signal` field, so
 * the non-streaming fallback cannot actually be cancelled once sent - Stop
 * during a `requestUrl` call stops the plugin reading its result, not the
 * provider generating one. `req.signal` is accepted here for interface
 * symmetry with `stream()` and is not read; this is named, not hidden. */

import { requestUrl } from 'obsidian';
import type { TransportRequest, Transports } from './types';

/** Carries the HTTP status a streamed response failed WITH, when it got one,
 * so a caller could in principle tell "never connected" from "connected and
 * refused" apart. Every current adapter treats both the same way (fall back
 * to `requestFull`, which is the one path that always reports a real status),
 * but the distinction is cheap to keep and expensive to reconstruct later. */
export class StreamHttpError extends Error {
  constructor(readonly status: number, readonly bodyText: string) {
    super(`HTTP ${status}`);
    this.name = 'StreamHttpError';
  }
}

async function* fetchStream(req: TransportRequest): AsyncGenerator<string> {
  // `requestUrl` cannot stream (it resolves once with the full body, per its
  // own type in obsidian.d.ts) and that is exactly what `requestFull` below
  // is for. `fetch` is exempted for this whole file in eslint.config.mjs,
  // with the reason recorded there; every other call in this file still uses
  // `requestUrl`.
  const response = await fetch(req.url, {
    method: 'POST',
    headers: req.headers,
    body: req.body,
    signal: req.signal,
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new StreamHttpError(response.status, bodyText);
  }
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    // Some WebViews resolve `fetch` but hand back a body with no reader
    // (buffered rather than streamed); this is that "attempted and could
    // not" signal the adapters catch and fall back on.
    throw new Error('This environment did not return a readable stream.');
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) yield decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

async function requestFull(req: TransportRequest): Promise<{ status: number; bodyText: string }> {
  // `throw: false` so a 4xx/5xx resolves here (status + body) instead of
  // rejecting; the adapters build their own error message from the body,
  // which `requestUrl`'s own thrown Error would have discarded.
  const response = await requestUrl({ url: req.url, method: 'POST', headers: req.headers, body: req.body, throw: false });
  return { status: response.status, bodyText: response.text };
}

export function resolveTransports(): Transports {
  return {
    stream: (req) => fetchStream(req),
    requestFull,
  };
}
