/* Server-Sent-Events framing, the one piece both adapters share: Anthropic's
 * Messages API and OpenRouter's chat-completions API both stream `data: ...`
 * lines (Anthropic also sends a named `event: ...` line first; OpenRouter
 * does not, and OpenAI-compatible clients don't need it since every frame's
 * own JSON carries its shape). Pure and stream-shaped: a caller feeds it
 * chunks as they arrive over the wire and keeps the returned `remainder` to
 * feed back in with the next chunk, so a frame split across two network reads
 * is never dropped or read short. */

export interface SseFrame {
  /** The named event, when the wire sent one. Null for OpenRouter's frames. */
  event: string | null;
  data: string;
}

/**
 * Split a buffer of SSE text into complete frames. A frame ends at a blank
 * line (`\n\n` or `\r\n\r\n`) per the SSE spec; whatever comes after the last
 * blank line is an incomplete frame and is returned as `remainder`, not
 * dropped.
 */
export function parseSseBuffer(buffer: string): { frames: SseFrame[]; remainder: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n\n');
  // The last part is either '' (the buffer ended exactly on a frame boundary)
  // or an incomplete frame; either way it is not a frame yet.
  const remainder = parts.pop() ?? '';
  const frames: SseFrame[] = [];
  for (const part of parts) {
    const frame = parseOneFrame(part);
    if (frame) frames.push(frame);
  }
  return { frames, remainder };
}

function parseOneFrame(raw: string): SseFrame | null {
  let event: string | null = null;
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trimStart());
    // Comments (`:`) and other fields (`id:`, `retry:`) carry nothing either
    // adapter reads; ignored rather than mis-parsed as data.
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}

/** `data: [DONE]` is OpenAI's own end-of-stream sentinel, not JSON. */
export function isDoneSentinel(data: string): boolean {
  return data.trim() === '[DONE]';
}
