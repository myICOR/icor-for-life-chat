/* Which picture an agent gets in the team strip. The lookup is pure: the test
 * says which vault paths exist and asserts the one picture chosen. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickAvatar } from './build/pure.mjs';

const AVATARS = '06 AI Team/AI Team Knowledge/Avatars';
const folder = (name) => `06 AI Team/Agents/${name}`;
const existing = (...paths) => (path) => paths.includes(path);

test('the agent own avatar.png wins over both other pictures', () => {
  const pick = pickAvatar(folder('Felix'), 'felix', AVATARS,
    existing(`${folder('Felix')}/avatar.png`, `${AVATARS}/felix.png`, `${folder('Felix')}/felix.png`));
  assert.equal(pick, `${folder('Felix')}/avatar.png`);
});

test('the shared Avatars copy wins over the picture in the agent folder', () => {
  const pick = pickAvatar(folder('Pixel'), 'pixel', AVATARS,
    existing(`${AVATARS}/pixel.png`, `${folder('Pixel')}/pixel.png`));
  assert.equal(pick, `${AVATARS}/pixel.png`);
});

test('with the Avatars copy missing, the picture named after the slug in the agent folder is used', () => {
  const pick = pickAvatar(folder('Pixel'), 'pixel', AVATARS, existing(`${folder('Pixel')}/pixel.png`));
  assert.equal(pick, `${folder('Pixel')}/pixel.png`);
});

test('no picture anywhere means null, never a guessed path', () => {
  assert.equal(pickAvatar(folder('Vera'), 'vera', AVATARS, existing()), null);
  // A picture named after another agent is not this agent's picture.
  assert.equal(pickAvatar(folder('Vera'), 'vera', AVATARS, existing(`${folder('Vex')}/vex.png`)), null);
});
