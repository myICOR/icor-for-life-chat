import test from 'node:test';
import assert from 'node:assert/strict';
import { runVaultTool, isFolderLike } from './build/pure.mjs';

/** A tiny in-memory Vault: plain objects satisfy `NoteLike` / `FolderLike`
 * structurally (basename/extension/path for a note, path/name/children for a
 * folder) - no Obsidian class, no `instanceof`, matching the whole point of
 * `vaultTools.ts` staying duck-typed. */
function buildVault(files) {
  const notes = new Map();
  for (const [path, content] of Object.entries(files)) notes.set(path, content);
  const note = (path) => ({ path, basename: path.split('/').pop().replace(/\.md$/, ''), extension: 'md' });
  const folderOf = (prefix) => {
    const children = [];
    const seenFolders = new Set();
    for (const path of notes.keys()) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash === -1) children.push(note(path));
      else {
        const sub = rest.slice(0, slash);
        if (!seenFolders.has(sub)) {
          seenFolders.add(sub);
          children.push({ path: `${prefix}${sub}`, name: sub, children: [] });
        }
      }
    }
    return { path: prefix.replace(/\/$/, ''), name: prefix.split('/').filter(Boolean).pop() ?? '', children };
  };
  return {
    getFileByPath: (path) => (notes.has(path) ? note(path) : null),
    getFolderByPath: (path) => (path === '' ? folderOf('') : folderOf(`${path}/`)),
    getRoot: () => folderOf(''),
    getMarkdownFiles: () => [...notes.keys()].map(note),
    read: async (file) => notes.get(file.path) ?? '',
    create: async (path, data) => { notes.set(path, data); return note(path); },
    append: async (file, data) => notes.set(file.path, (notes.get(file.path) ?? '') + data),
    notes,
  };
}

function ctxFor(vault, opts = {}) {
  return { vault, activeNote: () => opts.activeNote ?? null, selection: () => opts.selection ?? '' };
}

test('isFolderLike distinguishes by children, never by class', () => {
  assert.equal(isFolderLike({ path: 'a.md', basename: 'a', extension: 'md' }), false);
  assert.equal(isFolderLike({ path: 'folder', name: 'folder', children: [] }), true);
});

test('read_note reads a real note and reports a missing one honestly', async () => {
  const vault = buildVault({ 'a.md': 'hello' });
  const ok = await runVaultTool('read_note', { path: 'a.md' }, ctxFor(vault));
  assert.equal(ok.ok, true);
  assert.equal(ok.output, 'hello');
  const missing = await runVaultTool('read_note', { path: 'missing.md' }, ctxFor(vault));
  assert.equal(missing.ok, false);
  assert.match(missing.detail, /No note at missing\.md/);
});

test('search_notes ranks a title match ahead of a content-only match', async () => {
  const vault = buildVault({
    'acacia clock.md': 'a project about wood',
    'other.md': 'this one mentions an acacia tree once',
  });
  const result = await runVaultTool('search_notes', { query: 'acacia' }, ctxFor(vault));
  assert.equal(result.ok, true);
  const lines = result.output.split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^acacia clock\.md - title match$/);
  assert.match(lines[1], /^other\.md - /);
});

test('search_notes with no match says so without failing', async () => {
  const vault = buildVault({ 'a.md': 'nothing relevant' });
  const result = await runVaultTool('search_notes', { query: 'xyzzy' }, ctxFor(vault));
  assert.equal(result.ok, true);
  assert.equal(result.output, '');
  assert.match(result.detail, /No notes matched/);
});

test('list_folder lists the root, and a named folder, sorted', async () => {
  const vault = buildVault({ 'b.md': '', 'a.md': '', 'Sub/c.md': '' });
  const root = await runVaultTool('list_folder', { path: '' }, ctxFor(vault));
  // Plain alphabetical (localeCompare), no folders-first grouping: 'S' sorts
  // after the lowercase names here, same as a locale-aware file browser would.
  assert.equal(root.output, 'a.md\nb.md\nSub/');
  const sub = await runVaultTool('list_folder', { path: 'Sub' }, ctxFor(vault));
  assert.equal(sub.output, 'Sub/c.md');
});

test('current_note reads the open note, and includes the selection when there is one', async () => {
  const vault = buildVault({ 'open.md': 'body text' });
  const withSelection = await runVaultTool('current_note', {}, ctxFor(vault, { activeNote: { path: 'open.md' }, selection: 'the selected bit' }));
  assert.match(withSelection.output, /body text/);
  assert.match(withSelection.output, /the selected bit/);
  const noneOpen = await runVaultTool('current_note', {}, ctxFor(vault));
  assert.equal(noneOpen.ok, true);
  assert.match(noneOpen.detail, /No note is currently open/);
});

test('append_to_note adds to an existing note and refuses a missing one', async () => {
  const vault = buildVault({ 'a.md': 'start' });
  const ok = await runVaultTool('append_to_note', { path: 'a.md', text: ' more' }, ctxFor(vault));
  assert.equal(ok.ok, true);
  assert.equal(vault.notes.get('a.md'), 'start more');
  const missing = await runVaultTool('append_to_note', { path: 'missing.md', text: 'x' }, ctxFor(vault));
  assert.equal(missing.ok, false);
  assert.match(missing.detail, /create_note/);
});

test('create_note makes a new note and refuses to overwrite an existing one', async () => {
  const vault = buildVault({});
  const ok = await runVaultTool('create_note', { path: 'new.md', content: 'hi' }, ctxFor(vault));
  assert.equal(ok.ok, true);
  assert.equal(vault.notes.get('new.md'), 'hi');
  const dup = await runVaultTool('create_note', { path: 'new.md', content: 'x' }, ctxFor(vault));
  assert.equal(dup.ok, false);
  assert.match(dup.detail, /already exists/);
});

test('an unknown tool name fails cleanly rather than throwing', async () => {
  const result = await runVaultTool('delete_everything', {}, ctxFor(buildVault({})));
  assert.equal(result.ok, false);
  assert.match(result.detail, /Unknown tool/);
});
