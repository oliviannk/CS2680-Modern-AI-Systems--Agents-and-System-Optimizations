import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildClaudeArgs, parseNdjsonLines, validateWorkdir } from '../lib/claude-runner.js';
import { computeUnifiedDiff, renderMarkdownToHtml, sanitizeUrl } from '../public/lib/markdown.js';
import {
  collectChangedFiles,
  countSubtreeEvents,
  createRunState,
  ingestStreamEvent,
} from '../public/lib/trajectory-model.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ASSIGNMENT_DIR = path.resolve(__dirname, '..');
const FIXTURES_DIR = path.join(ASSIGNMENT_DIR, 'fixtures');
const DEMO_REPO = path.join(ASSIGNMENT_DIR, 'demo-repo');

function replayFixture(filename, opts = {}) {
  const raw = fs.readFileSync(path.join(FIXTURES_DIR, filename), 'utf8');
  const events = parseNdjsonLines(raw);
  const run = createRunState({
    runId: `test-${filename}`,
    prompt: opts.prompt || 'test prompt',
    cwd: opts.cwd || DEMO_REPO,
    resumedFromSessionId: opts.resumedFromSessionId || null,
    mode: 'replay',
    startedAt: 1000,
  });
  events.forEach((evt, idx) => ingestStreamEvent(run, evt, 1000 + (idx + 1) * 100));
  return run;
}

test('01-fix-bug fixture captures error tool output (>80 lines), diff, and final metrics', () => {
  const run = replayFixture('01-fix-bug.jsonl');
  assert.equal(run.status, 'finished');
  assert.equal(run.sessionId, 'fe891e8a-4c2b-4f90-9d1a-7c8e5b2a1041');
  assert.equal(run.metrics.totalCostUsd, 0.1842);
  assert.equal(run.metrics.durationMs, 18420);
  assert.equal(run.metrics.numTurns, 6);

  const failedPytest = run.toolIndex.toolu_01FixPytestFail;
  assert.equal(failedPytest.status, 'error');
  assert.equal(failedPytest.isError, true);
  assert.ok(failedPytest.lineCount > 80, `Expected >80 lines, got ${failedPytest.lineCount}`);

  const editCall = run.toolIndex.toolu_01FixEditParser;
  assert.equal(editCall.status, 'success');
  assert.ok(editCall.diffs && editCall.diffs.length === 1);
  assert.ok(editCall.diffs[0].lines.some((l) => l.type === 'add' && l.text.includes('splitlines()')));
});

test('02-resume-followup fixture preserves session continuity and changed files list', () => {
  const run = replayFixture('02-resume-followup.jsonl', {
    resumedFromSessionId: 'fe891e8a-4c2b-4f90-9d1a-7c8e5b2a1041',
  });
  assert.equal(run.status, 'finished');
  assert.equal(run.resumedFromSessionId, 'fe891e8a-4c2b-4f90-9d1a-7c8e5b2a1041');
  assert.equal(run.sessionId, 'fe891e8a-4c2b-4f90-9d1a-7c8e5b2a1041');

  const changed = collectChangedFiles(run);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].filePath, 'src/cli.py');
});

test('03-subagent-survey fixture nests subagent events via parent_tool_use_id and tracks outline depth', () => {
  const run = replayFixture('03-subagent-survey.jsonl');
  assert.equal(run.status, 'finished');

  const taskCode = run.toolIndex.toolu_03TaskCode;
  const taskDocs = run.toolIndex.toolu_03TaskDocs;
  assert.ok(taskCode.hasSubagentActivity);
  assert.ok(taskDocs.hasSubagentActivity);
  assert.equal(taskCode.depth, 0);
  assert.equal(countSubtreeEvents(taskCode), 4);
  assert.equal(countSubtreeEvents(taskDocs), 3);

  const nestedGlob = run.toolIndex.toolu_03Sub1Glob;
  assert.equal(nestedGlob.depth, 1);
  assert.equal(nestedGlob.parentToolUseId, 'toolu_03TaskCode');
  assert.equal(nestedGlob.status, 'success');

  const nestedOutline = run.outline.find((o) => o.toolUseId === 'toolu_03Sub1Glob');
  assert.equal(nestedOutline.depth, 1);
});

test('run_error resolves lingering pending tool calls to interrupted and marks run failed', () => {
  const run = createRunState({ runId: 'err-run', prompt: 'fail', cwd: '/bad/path' });
  ingestStreamEvent(run, {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_pend', name: 'Bash', input: { command: 'sleep 5' } }],
    },
  });
  assert.equal(run.toolIndex.toolu_pend.status, 'pending');

  ingestStreamEvent(run, {
    type: 'run_error',
    message: 'Error: /bad/path is not a directory (exit 1)',
    exitCode: 1,
  });
  assert.equal(run.status, 'failed');
  assert.equal(run.toolIndex.toolu_pend.status, 'interrupted');
  assert.match(run.errorMessage, /not a directory/);
});

test('validateWorkdir accepts demo-repo and rejects /bad/path', () => {
  const good = validateWorkdir(DEMO_REPO);
  assert.equal(good.ok, true);
  assert.equal(good.resolved, DEMO_REPO);

  const bad = validateWorkdir('/bad/path');
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'Error: /bad/path is not a directory (exit 1)');
});

test('buildClaudeArgs constructs headless stream-json flags with resume and permission modes', () => {
  const initial = buildClaudeArgs({ prompt: 'hello', permissionMode: 'skip' });
  assert.deepEqual(initial, [
    '-p',
    'hello',
    '--output-format',
    'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',
  ]);

  const resumed = buildClaudeArgs({
    prompt: 'follow up',
    resumeSessionId: 'sess-123',
    permissionMode: 'allowedTools',
    allowedTools: ['Read', 'Bash(pytest:*)'],
  });
  assert.deepEqual(resumed, [
    '-p',
    'follow up',
    '--output-format',
    'stream-json',
    '--verbose',
    '--resume',
    'sess-123',
    '--allowedTools',
    'Read',
    'Bash(pytest:*)',
  ]);
});

test('markdown renderer escapes XSS vectors, blocks javascript: URLs, and computes line diffs', () => {
  const html = renderMarkdownToHtml(
    '# Report\n\n<script>alert(1)</script> [bad](javascript:alert(2)) **ok** `code`'
  );
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('<strong>ok</strong>'));
  assert.equal(sanitizeUrl('javascript:alert(1)'), '#');
  assert.equal(sanitizeUrl('https://cs2680.com'), 'https://cs2680.com');

  const diff = computeUnifiedDiff('a\nb', 'a\nc\nd');
  assert.deepEqual(
    diff.map((d) => `${d.type}:${d.text}`),
    ['ctx:a', 'del:b', 'add:c', 'add:d']
  );
});
