/* SECRETS NEVER REACH THE ARCHIVE (plugin review, 2026-11-21).
 *
 * The archive keeps every tool result verbatim, in a folder that syncs. A
 * tool that printed an env file, a config or a request header would leave a
 * live key in the vault for good. Before any archive file is written, strings
 * shaped like secrets are masked: the first few characters stay so a person
 * can tell which key it was, the rest becomes "…[masked]".
 *
 * Shapes, not names: a key is recognised by what it looks like (sk-…, ghp_…,
 * xox…-, AKIA…, a JWT, `Bearer …`) or by sitting after NAME= / "name": where
 * the name says key, token, secret or password. Conservative on purpose: an
 * ordinary word is never masked, and masking twice changes nothing.
 *
 * No Obsidian import, on purpose: pure, so node:test measures it.
 */

const MASK = '…[masked]';
const keep = (s: string, n = 4) => s.slice(0, n) + MASK;

const TOKEN_SHAPES: RegExp[] = [
  /\bsk-(?:ant-|proj-|or-v1-)?[A-Za-z0-9_-]{16,}/g,          // Anthropic, OpenAI, OpenRouter
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,                            // GitHub
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,                          // Slack
  /\bAKIA[0-9A-Z]{16}\b/g,                                    // AWS access key id
  /\bAIza[0-9A-Za-z_-]{30,}/g,                                // Google API key
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
];

const SECRET_NAME = '[A-Za-z0-9_.-]*(?:key|token|secret|password|passwd|pwd|auth|credential)[A-Za-z0-9_.-]*';
/* NAME=value (env files, shell) */
const ASSIGNMENT = new RegExp(`\\b(${SECRET_NAME})(\\s*[=:]\\s*)(["']?)([^\\s"'\\\\]{8,})\\3`, 'gi');
/* "name": "value" (JSON) */
const JSON_PAIR = new RegExp(`("${SECRET_NAME}"\\s*:\\s*")([^"\\\\]{8,})(")`, 'gi');
/* Authorization: Bearer xyz */
const BEARER = /\b(Bearer|Basic)\s+([A-Za-z0-9._~+/=-]{12,})/g;

export function maskSecrets(text: string): string {
  if (!text) return text;
  let out = text;
  for (const shape of TOKEN_SHAPES) out = out.replace(shape, (m) => (m.includes(MASK) ? m : keep(m, 6)));
  out = out.replace(BEARER, (_m, kind: string, value: string) => (value.includes(MASK) ? _m : `${kind} ${keep(value)}`));
  out = out.replace(JSON_PAIR, (m, head: string, value: string, tail: string) => (value.includes(MASK) ? m : head + keep(value) + tail));
  out = out.replace(ASSIGNMENT, (m, name: string, eq: string, q: string, value: string) => (value.includes(MASK) ? m : `${name}${eq}${q}${keep(value)}${q}`));
  return out;
}

/** Mask every string inside a JSON-able value (the transcript's events). */
export function maskSecretsDeep<T>(value: T): T {
  if (typeof value === 'string') return maskSecrets(value) as unknown as T;
  if (Array.isArray(value)) return (value as unknown[]).map((v): unknown => maskSecretsDeep(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = maskSecretsDeep(v);
    return out as T;
  }
  return value;
}

/* The files and folders no assistant reads without asking: keys files
 * (wherever they sit, `.icor-for-life/.env` and the older `06 AI Team` one
 * included) and the vault's config folder, whose plugins' data.json files
 * hold tokens. The rest of `.icor-for-life/` stays readable: older vaults keep
 * their schema there and their AGENTS.md points the agent at it. Claude
 * Code permission rules, handed to the session as disallowed tools. The
 * config folder comes from Vault#configDir: it is not always `.obsidian`. */
export function secretReadDeny(configDir?: string): string[] {
  const paths = ['**/.env', '**/.env.*'];
  const dir = (configDir ?? '').replace(/^\.\//, '').replace(/\/+$/, '');
  if (dir && !dir.includes('..')) paths.unshift(`./${dir}/**`);
  const rules: string[] = [];
  for (const tool of ['Read', 'Grep', 'Glob']) for (const p of paths) rules.push(`${tool}(${p})`);
  return rules;
}
