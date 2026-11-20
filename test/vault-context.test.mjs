/* WHAT THE VAULT SAYS ABOUT ITSELF (0.17.0): AGENTS.md, the skills in
 * `.agents/skills/<name>/SKILL.md` and `.icor-for-life/schema.json`, read
 * through the adapter because Obsidian does not index dot folders. The schema
 * fixture is the ICOR for Life vault's own (18 types), copied verbatim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  parseSkill, schemaSummary, schemaTypeCount, vaultContextParts, vaultSystemPrompt, readVaultContext,
  isReadableVaultFile, runReadNote, AGENTS_CAP, SCHEMA_PATH, EMPTY_VAULT_CONTEXT,
} from './build/pure.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(resolve(here, 'fixtures/vault-schema.json'), 'utf8');

/** A map standing in for `app.vault.adapter`: files by path, folders derived. */
function adapterOf(files) {
  const folders = new Set();
  for (const path of Object.keys(files)) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i += 1) folders.add(parts.slice(0, i).join('/'));
  }
  return {
    exists: async (p) => p in files || folders.has(p),
    read: async (p) => {
      if (!(p in files)) throw new Error(`ENOENT ${p}`);
      return files[p];
    },
    list: async (p) => ({
      files: Object.keys(files).filter((f) => f.startsWith(`${p}/`) && !f.slice(p.length + 1).includes('/')),
      folders: [...folders].filter((f) => f.startsWith(`${p}/`) && !f.slice(p.length + 1).includes('/')),
    }),
  };
}

const SKILL = (name, description) => `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;

test('a skill is named by its frontmatter, and by its folder when the name is missing', () => {
  const s = parseSkill(SKILL('capture', 'Decide where something belongs.'), '.agents/skills/capture/SKILL.md');
  assert.deepEqual(s, { name: 'capture', description: 'Decide where something belongs.', path: '.agents/skills/capture/SKILL.md' });
  const bare = parseSkill('# no frontmatter\n', '.agents/skills/weekly-review/SKILL.md');
  assert.equal(bare.name, 'weekly-review');
  assert.equal(bare.description, '');
  const quoted = parseSkill('﻿---\r\nname: "x"\r\ndescription: \'y: z\'\r\n---\r\n', 'a/x/SKILL.md');
  assert.deepEqual([quoted.name, quoted.description], ['x', 'y: z'], 'a BOM, CRLF or quotes broke the frontmatter read');
});

test('the schema summary names every type with its folder, fields, values and links', () => {
  assert.equal(schemaTypeCount(SCHEMA), 18);
  const summary = schemaSummary(SCHEMA);
  for (const type of Object.keys(JSON.parse(SCHEMA).types)) {
    assert.match(summary, new RegExp(`^- ${type}: `, 'm'), `${type} is missing from the summary`);
  }
  assert.match(summary, /^- journal: 04 Inner World\/Journal\/YYYY\/MM\/YYYY-MM-DD_<slug>\.md\./m);
  assert.match(summary, /journal_type is one of: interaction, note, thought, milestone/);
  assert.match(summary, /links: .*linked_people -> person \(many\)/);
  assert.match(summary, /^Every note carries: type, created, tags\./m);
  assert.ok(summary.length < SCHEMA.length, 'the summary is longer than the schema it summarises');
  assert.equal(schemaSummary('not json'), null);
  assert.equal(schemaSummary('{"types": 3}'), null);
  assert.equal(schemaTypeCount('[]'), null);
});

test('the vault is read through the adapter: AGENTS.md, both skill folders deduplicated, the schema', async () => {
  const adapter = adapterOf({
    'AGENTS.md': '# AGENTS.md: how this folder works\n',
    'CLAUDE.md': '@AGENTS.md\n',
    '.agents/skills/capture/SKILL.md': SKILL('capture', 'Save this.'),
    '.agents/skills/weekly-review/SKILL.md': SKILL('weekly-review', 'Plan my week.'),
    '.claude/skills/capture/SKILL.md': SKILL('capture', 'The copy.'),
    '.claude/skills/only-here/SKILL.md': SKILL('only-here', 'A Claude-only skill.'),
    '.agents/skills/empty-folder/README.md': 'not a skill',
    [SCHEMA_PATH]: SCHEMA,
  });
  const ctx = await readVaultContext(adapter);
  assert.equal(ctx.instructions.path, 'AGENTS.md');
  assert.deepEqual(ctx.skills.map((s) => s.name), ['capture', 'weekly-review', 'only-here']);
  assert.equal(ctx.skills[0].description, 'Save this.', 'the .claude copy outranked .agents');
  assert.equal(ctx.schema.types, 18);
  assert.deepEqual(vaultContextParts(ctx), ['AGENTS.md', '3 skills', 'schema, 18 types']);
});

test('a bare vault reads as nothing, CLAUDE.md stands in for a missing AGENTS.md, and a broken schema is skipped', async () => {
  assert.deepEqual(await readVaultContext(adapterOf({})), EMPTY_VAULT_CONTEXT);
  assert.deepEqual(vaultContextParts(EMPTY_VAULT_CONTEXT), []);
  const ctx = await readVaultContext(adapterOf({ 'CLAUDE.md': 'Be brief.\n', [SCHEMA_PATH]: '{ broken' }));
  assert.equal(ctx.instructions.path, 'CLAUDE.md');
  assert.equal(ctx.schema, null);
  const throwing = { exists: async () => true, read: async () => { throw new Error('EACCES'); }, list: async () => { throw new Error('EACCES'); } };
  assert.deepEqual(await readVaultContext(throwing), EMPTY_VAULT_CONTEXT, 'a read error escaped the reader');
});

test('the own-key prompt carries the vault\'s words and nothing of the plugin\'s own beyond the tools', async () => {
  const ctx = await readVaultContext(adapterOf({
    'AGENTS.md': 'The person\'s words are sacred.\n',
    '.agents/skills/capture/SKILL.md': SKILL('capture', 'Save this.'),
    [SCHEMA_PATH]: SCHEMA,
  }));
  const prompt = vaultSystemPrompt(ctx, ['read_note', 'search_notes']);
  assert.match(prompt, /read_note, search_notes/);
  assert.match(prompt, /The person's words are sacred\./);
  assert.match(prompt, /- capture \(\.agents\/skills\/capture\/SKILL\.md\): Save this\./);
  assert.match(prompt, /^- journal: /m);
  for (const gone of ['06 AI Team', 'Larry', 'ICOR card', 'specialist']) {
    assert.ok(!prompt.includes(gone), `the prompt still says ${gone}`);
  }
  const bare = vaultSystemPrompt(EMPTY_VAULT_CONTEXT, ['read_note']);
  assert.equal(bare.split('\n\n').length, 1, 'a bare vault got more than the one line about the tools');
});

test('a long AGENTS.md is cut at the cap, and the cut is said', () => {
  const long = { instructions: { path: 'AGENTS.md', text: 'x'.repeat(AGENTS_CAP + 10) }, skills: [], schema: null };
  const prompt = vaultSystemPrompt(long, ['read_note']);
  assert.ok(prompt.includes('[AGENTS.md continues; read it with read_note for the rest.]'));
  assert.ok(prompt.length < AGENTS_CAP + 600);
});

test('read_note reaches the skills, the schema and the templates in the hidden folders, and never an env file', async () => {
  for (const ok of ['.agents/skills/capture/SKILL.md', '.claude/skills/x/SKILL.md', SCHEMA_PATH, '.icor-for-life/templates/journal.md']) {
    assert.equal(isReadableVaultFile(ok), true, ok);
  }
  for (const no of ['.icor-for-life/.env', '.agents/skills/x/.env', '.agents/skills/../../.ssh/id', '.obsidian/plugins/x/data.json',
    '.icor-for-life/tools/check-quality.py', '06 AI Team/AI Team Knowledge/.env', '.agents/skills//SKILL.md', '']) {
    assert.equal(isReadableVaultFile(no), false, no);
  }
  const hidden = { [SCHEMA_PATH]: SCHEMA };
  const ctx = {
    vault: { getFileByPath: () => null },
    readHidden: async (p) => (isReadableVaultFile(p) && p in hidden ? hidden[p] : null),
  };
  const read = await runReadNote(ctx, { path: SCHEMA_PATH });
  assert.equal(read.ok, true);
  assert.ok(read.output.startsWith('{'));
  const refused = await runReadNote(ctx, { path: '.icor-for-life/.env' });
  assert.equal(refused.ok, false);
  const missing = await runReadNote({ vault: { getFileByPath: () => null } }, { path: SCHEMA_PATH });
  assert.equal(missing.ok, false, 'a context without readHidden answered for a hidden file');
});
