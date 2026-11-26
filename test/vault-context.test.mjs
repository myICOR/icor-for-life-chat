/* WHAT THE VAULT SAYS ABOUT ITSELF (0.17.0): AGENTS.md, the skills in
 * `_System/Skills/<name>/SKILL.md` and `_System/schema.json`, with the hidden
 * copies older vaults keep (`.agents/skills/`, `.icor-for-life/schema.json`)
 * as fallbacks, all read through the adapter because Obsidian does not index
 * dot folders. The schema fixture is the ICOR for Life vault's own (19 types),
 * copied verbatim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  parseSkill, schemaSummary, schemaTypeCount, schemaFolders, vaultContextParts, vaultSystemPrompt, readVaultContext,
  isReadableVaultFile, runReadNote, AGENTS_CAP, SCHEMA_PATH, LEGACY_SCHEMA_PATH, EMPTY_VAULT_CONTEXT,
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
  assert.equal(schemaTypeCount(SCHEMA), 19);
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

/* THE 3.0 SCHEMA (the stages contract, 2026-11-23): `rooms` is `folders`,
   with a `stages` map beside it, and the folders carry their new names. Built
   from the 2.x fixture the way the contract maps it, so the two cannot drift
   apart; the wording the vault itself changes ("room" to "folder") goes with
   it. */
const RENAMED = [
  ['00 Daily Scratchpad', '00 Daily Notes'], ['04 Inner World', '02 Inner World'], ['06 Outer World', '03 Outer World'],
  ['05 Assets', '04 Assets'], ['07 Databases', '05 Databases'], ['02 Planner', '06 Planner'],
];
const STAGES = {
  input: { label: 'Input', color: '#5271FC', folders: ['00 Daily Notes', '01 Inbox'] },
  control: { label: 'Control', color: '#52F49A', folders: ['02 Inner World', '03 Outer World', '04 Assets', '05 Databases'] },
  output: { label: 'Output', color: '#FD63FF', folders: ['06 Planner'] },
  refine: { label: 'Refine', folders: [], about: 'no folder: the plugins (AI Chat, Connect, Focus) and the weekly review' },
};
function schema30() {
  let text = SCHEMA;
  for (const [from, to] of RENAMED) text = text.split(from).join(to);
  const parsed = JSON.parse(text.replace(/\brooms?\b/g, (w) => (w === 'rooms' ? 'folders' : 'folder')));
  delete parsed.folders['03 WiP'];
  parsed.stages = STAGES;
  return JSON.stringify(parsed, null, 2);
}

test('a 3.0 schema: the folders by stage, under their new names, read from `folders`', () => {
  const text = schema30();
  assert.ok('folders' in JSON.parse(text) && !('rooms' in JSON.parse(text)));
  assert.equal(schemaTypeCount(text), 19);
  const summary = schemaSummary(text);
  assert.match(summary, /^Folders, grouped by stage:\nInput:\n- 00 Daily Notes: your raw writing[^\n]*\n- 01 Inbox: [^\n]+\nControl:\n- 02 Inner World: [^\n]+\n- 03 Outer World: [^\n]+\n- 04 Assets: [^\n]+\n- 05 Databases: [^\n]+\nOutput:\n- 06 Planner: [^\n]+\nRefine: no folder: the plugins/m);
  assert.match(summary, /^- journal: 02 Inner World\/Journal\//m);
  assert.doesNotMatch(summary, /Other folders:/, 'a staged folder was listed again');
  const loose = JSON.parse(text);
  loose.folders['99 Extra'] = 'not in a stage';
  assert.match(schemaSummary(JSON.stringify(loose)), /^Other folders:\n- 99 Extra: not in a stage$/m, 'a folder no stage names went missing');
});

test('a schema written before 3.0 is read from `rooms` and still shown as folders', () => {
  assert.deepEqual(Object.keys(schemaFolders(JSON.parse(SCHEMA))), Object.keys(JSON.parse(SCHEMA).rooms));
  assert.deepEqual(Object.keys(schemaFolders(JSON.parse(schema30()))), Object.keys(JSON.parse(schema30()).folders));
  assert.equal(schemaFolders({ folders: { a: 'new' }, rooms: { b: 'old' } }).a, 'new', '`folders` wins over `rooms`');
  assert.equal(schemaFolders({ types: {} }), null);
  const summary = schemaSummary(SCHEMA);
  assert.match(summary, /^Folders:\n- 00 Daily Scratchpad: your raw writing/m);
  for (const name of Object.keys(JSON.parse(SCHEMA).rooms)) assert.ok(summary.includes(`- ${name}: `), `${name} is missing`);
  assert.doesNotMatch(summary, /^Rooms?\b/m, 'the summary heads the list with "Rooms"');
});

test('no "room" reaches the model from the plugin: a 3.0 vault\'s prompt says folders and stages only', async () => {
  const ctx = await readVaultContext(adapterOf({ 'AGENTS.md': 'Be kind.\n', [SCHEMA_PATH]: schema30() }));
  const prompt = vaultSystemPrompt(ctx, ['read_note', 'list_folder']);
  assert.doesNotMatch(prompt, /\brooms?\b/i);
  assert.match(prompt, /Folders, grouped by stage:/);
  for (const old of ['00 Daily Scratchpad', '04 Inner World', '06 Outer World', '05 Assets', '07 Databases', '02 Planner', '03 WiP']) {
    assert.ok(!prompt.includes(old), `the prompt names the old folder ${old}`);
  }
});

test('the vault is read through the adapter: AGENTS.md, _System first, the skill copies deduplicated', async () => {
  const adapter = adapterOf({
    'AGENTS.md': '# AGENTS.md: how this folder works\n',
    'CLAUDE.md': '@AGENTS.md\n',
    '_System/Skills/capture/SKILL.md': SKILL('capture', 'Save this.'),
    '_System/Skills/weekly-review/SKILL.md': SKILL('weekly-review', 'Plan my week.'),
    '.agents/skills/capture/SKILL.md': SKILL('capture', 'The hidden copy.'),
    '.agents/skills/only-agents/SKILL.md': SKILL('only-agents', 'Not in _System yet.'),
    '.claude/skills/capture/SKILL.md': SKILL('capture', 'The Claude copy.'),
    '.claude/skills/only-here/SKILL.md': SKILL('only-here', 'A Claude-only skill.'),
    '_System/Skills/empty-folder/README.md': 'not a skill',
    [SCHEMA_PATH]: SCHEMA,
    [LEGACY_SCHEMA_PATH]: '{"types": {"old": {}}}',
  });
  const ctx = await readVaultContext(adapter);
  assert.equal(ctx.instructions.path, 'AGENTS.md');
  assert.deepEqual(ctx.skills.map((s) => s.name), ['capture', 'weekly-review', 'only-agents', 'only-here']);
  assert.equal(ctx.skills[0].description, 'Save this.', 'a hidden copy outranked _System');
  assert.equal(ctx.skills[0].path, '_System/Skills/capture/SKILL.md');
  assert.equal(ctx.schema.path, SCHEMA_PATH, 'the old hidden schema outranked _System');
  assert.equal(ctx.schema.types, 19);
  assert.deepEqual(vaultContextParts(ctx), ['AGENTS.md', '4 skills', 'schema, 19 types']);
});

test('a vault built before _System is read from its hidden folders', async () => {
  const ctx = await readVaultContext(adapterOf({
    'AGENTS.md': '# old layout\n',
    '.agents/skills/capture/SKILL.md': SKILL('capture', 'Save this.'),
    [LEGACY_SCHEMA_PATH]: SCHEMA,
  }));
  assert.deepEqual(ctx.skills.map((s) => s.path), ['.agents/skills/capture/SKILL.md']);
  assert.equal(ctx.schema.path, LEGACY_SCHEMA_PATH);
  const broken = await readVaultContext(adapterOf({ [SCHEMA_PATH]: '{ half a file', [LEGACY_SCHEMA_PATH]: SCHEMA }));
  assert.equal(broken.schema.path, LEGACY_SCHEMA_PATH, 'a broken _System schema hid the readable fallback');
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
    '_System/Skills/capture/SKILL.md': SKILL('capture', 'Save this.'),
    [SCHEMA_PATH]: SCHEMA,
  }));
  const prompt = vaultSystemPrompt(ctx, ['read_note', 'search_notes']);
  assert.match(prompt, /read_note, search_notes/);
  assert.match(prompt, /The person's words are sacred\./);
  assert.match(prompt, /- capture \(_System\/Skills\/capture\/SKILL\.md\): Save this\./);
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

test('read_note reaches the hidden skill copies and the old schema and templates, and never an env file', async () => {
  for (const ok of ['.agents/skills/capture/SKILL.md', '.claude/skills/x/SKILL.md', LEGACY_SCHEMA_PATH, '.icor-for-life/templates/journal.md']) {
    assert.equal(isReadableVaultFile(ok), true, ok);
  }
  for (const no of ['.icor-for-life/.env', '.agents/skills/x/.env', '.agents/skills/../../.ssh/id', '.obsidian/plugins/x/data.json',
    '.icor-for-life/tools/check-quality.py', '06 AI Team/AI Team Knowledge/.env', '.agents/skills//SKILL.md', '',
    /* _System is a visible folder: the Vault API reads it, never this door. */
    SCHEMA_PATH, '_System/Skills/capture/SKILL.md']) {
    assert.equal(isReadableVaultFile(no), false, no);
  }
  const hidden = { [LEGACY_SCHEMA_PATH]: SCHEMA };
  const ctx = {
    vault: { getFileByPath: () => null },
    readHidden: async (p) => (isReadableVaultFile(p) && p in hidden ? hidden[p] : null),
  };
  const read = await runReadNote(ctx, { path: LEGACY_SCHEMA_PATH });
  assert.equal(read.ok, true);
  assert.ok(read.output.startsWith('{'));
  const refused = await runReadNote(ctx, { path: '.icor-for-life/.env' });
  assert.equal(refused.ok, false);
  const missing = await runReadNote({ vault: { getFileByPath: () => null } }, { path: LEGACY_SCHEMA_PATH });
  assert.equal(missing.ok, false, 'a context without readHidden answered for a hidden file');
});
