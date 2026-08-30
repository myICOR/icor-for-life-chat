/* The shape a structured reply parses into. Pure data: the renderer decides how
 * it looks, the parser decides only what it is. */

export type Disposition = 'handled' | 'owned' | 'unowned' | 'noted';

export type CardStatus = 'COMPLETE' | 'PARTIAL' | 'BLOCKED' | 'IN FLIGHT';

export interface Row {
  disposition: Disposition | null;
  label: string;
  value: string;
  qualifier: string | null;
}

export interface Finding {
  disposition: Disposition | null;
  claim: string;
  /** Mandatory in the format. A finding without one is unowned, and says so. */
  ownership: string | null;
  evidence: string | null;
}

export type Block =
  | { kind: 'asked'; text: string }
  | { kind: 'answer'; text: string }
  | { kind: 'group'; title: string | null; rows: Row[] }
  | { kind: 'findings'; findings: Finding[] }
  | { kind: 'insight'; text: string }
  | { kind: 'why'; text: string }
  | { kind: 'notCovered'; rows: Row[] }
  | { kind: 'next'; items: string[] }
  | { kind: 'files'; paths: string[] }
  | { kind: 'links'; urls: string[] }
  | { kind: 'prose'; text: string };

export interface CardHeader {
  name: string;
  scope: string | null;
  status: CardStatus | null;
}

export type DecisionVariant = 'decision' | 'blocked' | 'cleared';

export interface DecisionBlock {
  code: string;
  title: string;
  body: string;
  variant: DecisionVariant;
}

export type Segment =
  | { kind: 'prose'; text: string }
  | { kind: 'card'; header: CardHeader; blocks: Block[] }
  | { kind: 'decision'; decision: DecisionBlock }
  | { kind: 'flag'; text: string };

export interface StructuredDoc {
  segments: Segment[];
  /** False when nothing in the text carried the format's own signals. */
  structured: boolean;
}

/** Codes are exactly five lowercase alphanumerics in chat mode. */
export const CODE_PATTERN = /^[a-z0-9]{5}$/;

export function isCode(value: string): boolean {
  return CODE_PATTERN.test(value);
}

/**
 * What the READER accepts. Strict in what we ask for, liberal in what we take:
 * a model that writes a six-character code has still raised a decision, and
 * dropping it silently loses the one thing the user has to answer. Measured on
 * a live reply that produced `vault1` under a prompt asking for five.
 */
export const READABLE_CODE_PATTERN = /^[a-z0-9]{4,8}$/;

export function isReadableCode(value: string): boolean {
  return READABLE_CODE_PATTERN.test(value);
}
