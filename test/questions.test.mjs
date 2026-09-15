/* AskUserQuestion: the normaliser and the answer shape.
 *
 * Both halves are measured facts about the real CLI, not preferences, so both
 * are pinned here. The measurement that produced them is the header of
 * src/provider/questions.ts and the harness tools/question-entry.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseQuestions, joinChoices, answeredInput, isAnswered, approvalEvent, QUESTION_TOOL, ANSWER_CAP,
} from './build/pure.mjs';

/* The input exactly as the CLI sent it on 2026-09-15 (CLI 2.1.272, SDK
   0.3.226), second question added to cover multi-select. */
const INPUT = {
  questions: [
    {
      question: 'Which colour do you prefer?',
      header: 'Colour',
      options: [
        { label: 'Red', description: 'The colour red' },
        { label: 'Blue', description: 'The colour blue' },
      ],
      multiSelect: false,
    },
    {
      question: 'Which fruits do you like?',
      header: 'Fruit',
      options: [
        { label: 'Apple', description: 'A pome' },
        { label: 'Pear', description: 'Also a pome' },
      ],
      multiSelect: true,
    },
  ],
};

test('an AskUserQuestion call parses into the questions the card draws', () => {
  const questions = parseQuestions(QUESTION_TOOL, INPUT);
  assert.ok(questions, 'the call did not parse as a question');
  assert.equal(questions.length, 2);
  assert.deepEqual(questions[0], {
    question: 'Which colour do you prefer?',
    header: 'Colour',
    multiSelect: false,
    options: [
      { label: 'Red', description: 'The colour red' },
      { label: 'Blue', description: 'The colour blue' },
    ],
  });
  assert.equal(questions[1].multiSelect, true, 'multi-select was dropped, so the card would take one answer');
});

test('any other tool, and any shape that is not a question, parses to null', () => {
  assert.equal(parseQuestions('Bash', { command: 'ls' }), null);
  assert.equal(parseQuestions(QUESTION_TOOL, null), null);
  assert.equal(parseQuestions(QUESTION_TOOL, 'questions'), null);
  assert.equal(parseQuestions(QUESTION_TOOL, {}), null);
  assert.equal(parseQuestions(QUESTION_TOOL, { questions: [] }), null);
  assert.equal(parseQuestions(QUESTION_TOOL, { questions: [{ header: 'no text' }] }), null,
    'a question with no text drew a card with nothing on it');
});

test('a malformed question is read down, never thrown on', () => {
  const questions = parseQuestions(QUESTION_TOOL, {
    questions: [
      { question: '  spaced  ', options: [{ label: 'A' }, 'not an option', { description: 'no label' }, null] },
    ],
  });
  assert.ok(questions);
  assert.equal(questions[0].question, 'spaced');
  assert.equal(questions[0].header, '');
  assert.equal(questions[0].multiSelect, false);
  assert.deepEqual(questions[0].options, [{ label: 'A', description: '' }]);
});

test('a request carrying questions becomes tool-question, and one without stays tool-approval', () => {
  const base = { toolUseId: 't1', toolName: QUESTION_TOOL, target: '', purpose: 'Asked a question', title: 't', resolve: () => {} };
  const asked = approvalEvent({ ...base, questions: parseQuestions(QUESTION_TOOL, INPUT) });
  assert.equal(asked.kind, 'tool-question');
  assert.equal(asked.toolUseId, 't1');
  assert.equal(asked.questions.length, 2);

  const perm = approvalEvent({ ...base, toolName: 'Bash', target: 'ls', purpose: 'Ran ls' });
  assert.equal(perm.kind, 'tool-approval');
  assert.equal(perm.name, 'Bash');
  assert.equal(perm.target, 'ls');
  assert.equal(perm.purpose, 'Ran ls');

  const empty = approvalEvent({ ...base, questions: [] });
  assert.equal(empty.kind, 'tool-approval', 'a request with no question at all drew an empty card');
});

test('a multi-select answer is one string, comma-space joined, and a label that looks like the separator is quoted', () => {
  assert.equal(joinChoices(['Apple', 'Pear']), 'Apple, Pear');
  assert.equal(joinChoices(['Apple']), 'Apple');
  assert.equal(joinChoices([]), '');
  assert.equal(joinChoices(['Apple, the fruit', 'Pear']), '"Apple, the fruit", Pear');
  assert.equal(joinChoices(['He said "no"']), '"He said \\"no\\""');
});

test('the answer goes back as the shown input plus answers, and nothing else', () => {
  const answer = { answers: { 'Which colour do you prefer?': 'Red' } };
  const out = answeredInput(INPUT, answer);
  // Every shown field comes back deep-equal: the CLI refuses an answer that
  // changed the call, and admits only answers/annotations/response/followUp.
  assert.deepEqual(out.questions, INPUT.questions);
  assert.deepEqual(out.answers, { 'Which colour do you prefer?': 'Red' });
  assert.deepEqual(Object.keys(out).sort(), ['answers', 'questions']);
  assert.equal('response' in out, false, 'an empty free text was sent as an answer the member never gave');
  assert.equal('afkTimeoutMs' in out, false, 'a host-only field would be refused outright');
  assert.deepEqual(INPUT.answers, undefined, 'the shown input was mutated');
});

test('free text rides as response, trimmed, and an empty one does not ride at all', () => {
  const withText = answeredInput(INPUT, { answers: {}, response: '  something else  ' });
  assert.equal(withText.response, 'something else');
  assert.deepEqual(withText.answers, {});
  assert.equal('response' in answeredInput(INPUT, { answers: {}, response: '   ' }), false);
  assert.equal('response' in answeredInput(INPUT, { answers: {} }), false);
});

test('an empty answer is dropped rather than sent as an answered question', () => {
  const out = answeredInput(INPUT, { answers: { 'Which colour do you prefer?': '', 'Which fruits do you like?': 'Apple, Pear' } });
  assert.deepEqual(out.answers, { 'Which fruits do you like?': 'Apple, Pear' });
});

test('every answer string is bounded by the cap the CLI itself enforces', () => {
  const long = 'x'.repeat(ANSWER_CAP + 500);
  const out = answeredInput(INPUT, { answers: { 'Which colour do you prefer?': long }, response: long });
  assert.equal(out.answers['Which colour do you prefer?'].length, ANSWER_CAP);
  assert.equal(out.response.length, ANSWER_CAP);
});

test('nothing chosen and nothing typed is not an answer', () => {
  assert.equal(isAnswered({ answers: {} }), false);
  assert.equal(isAnswered({ answers: {}, response: '  ' }), false);
  assert.equal(isAnswered({ answers: { q: '' } }), false);
  assert.equal(isAnswered({ answers: { q: 'Red' } }), true);
  assert.equal(isAnswered({ answers: {}, response: 'something' }), true);
});
