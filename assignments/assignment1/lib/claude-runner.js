/**
 * Subprocess manager for headless Claude Code CLI (`claude -p --output-format stream-json --verbose`)
 * and deterministic NDJSON replay streams.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/**
 * Expand leading `~` or `~/` to the user's home directory.
 */
export function expandHome(inputPath) {
  const raw = String(inputPath || '').trim();
  if (raw === '~') return os.homedir();
  if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

/**
 * Validate that a requested working directory exists and is a directory.
 */
export function validateWorkdir(inputPath) {
  const trimmed = String(inputPath || '').trim();
  if (!trimmed) {
    return { ok: false, resolved: '', error: 'Error: working directory is required (exit 1)' };
  }

  const resolved = path.resolve(expandHome(trimmed));
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return {
        ok: false,
        resolved,
        error: `Error: ${trimmed} is not a directory (exit 1)`,
      };
    }
    return { ok: true, resolved, error: null };
  } catch {
    return {
      ok: false,
      resolved,
      error: `Error: ${trimmed} is not a directory (exit 1)`,
    };
  }
}

/**
 * Locate the `claude` CLI binary across PATH, nvm installs, Homebrew, and ~/.local/bin.
 */
export function discoverClaudeBinary() {
  const candidates = [];

  if (process.env.CLAUDE_BIN) {
    candidates.push(expandHome(process.env.CLAUDE_BIN));
  }

  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    candidates.push(path.join(dir, 'claude'));
  }

  const nvmBase = path.join(os.homedir(), '.nvm', 'versions', 'node');
  try {
    const versions = fs.readdirSync(nvmBase).sort().reverse();
    for (const ver of versions) {
      candidates.push(path.join(nvmBase, ver, 'bin', 'claude'));
    }
  } catch {
    // No nvm directory present
  }

  candidates.push('/opt/homebrew/bin/claude');
  candidates.push('/usr/local/bin/claude');
  candidates.push(path.join(os.homedir(), '.local', 'bin', 'claude'));

  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      const stat = fs.statSync(candidate);
      if (stat.isFile() || stat.isSymbolicLink()) {
        return {
          available: true,
          path: candidate,
          binDir: path.dirname(candidate),
        };
      }
    } catch {
      // Candidate missing or not executable
    }
  }

  return { available: false, path: null, binDir: null };
}

/**
 * Construct CLI arguments for headless Claude Code streaming mode.
 */
export function buildClaudeArgs({
  prompt,
  resumeSessionId = null,
  permissionMode = 'skip',
  allowedTools = ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash(pytest:*)', 'Bash(python3:*)'],
}) {
  const args = ['-p', String(prompt || ''), '--output-format', 'stream-json', '--verbose'];

  if (resumeSessionId) {
    args.push('--resume', String(resumeSessionId));
  }

  if (permissionMode === 'skip') {
    args.push('--dangerously-skip-permissions');
  } else if (permissionMode === 'allowedTools' && Array.isArray(allowedTools) && allowedTools.length > 0) {
    args.push('--allowedTools', ...allowedTools.map(String));
  }

  return args;
}

function buildSpawnEnv(claudeBinDir) {
  const extraDirs = [claudeBinDir, path.dirname(process.execPath), '/opt/homebrew/bin', '/usr/local/bin'].filter(Boolean);
  const existingPath = process.env.PATH ? process.env.PATH.split(path.delimiter) : [];
  const mergedPath = [...new Set([...extraDirs, ...existingPath])].join(path.delimiter);
  return { ...process.env, PATH: mergedPath };
}

/**
 * Spawn `claude` CLI in headless stream-json mode and stream parsed events line by line.
 */
export function startLiveRun({
  prompt,
  cwd,
  resumeSessionId = null,
  permissionMode = 'skip',
  allowedTools,
  onEvent,
  onClose,
}) {
  const check = validateWorkdir(cwd);
  if (!check.ok) {
    onEvent({ type: 'run_error', message: check.error, exitCode: 1 });
    onClose(1);
    return { abort() {} };
  }

  const claude = discoverClaudeBinary();
  if (!claude.available) {
    onEvent({
      type: 'run_error',
      message: 'Error: claude CLI binary not found in PATH or ~/.nvm (exit 127)',
      exitCode: 127,
    });
    onClose(127);
    return { abort() {} };
  }

  const args = buildClaudeArgs({ prompt, resumeSessionId, permissionMode, allowedTools });
  const child = spawn(claude.path, args, {
    cwd: check.resolved,
    env: buildSpawnEnv(claude.binDir),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdoutBuffer = '';
  let stderrBuffer = '';
  let sawResultEvent = false;
  let aborted = false;

  const processLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed?.type === 'result') sawResultEvent = true;
      onEvent(parsed);
    } catch {
      onEvent({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: trimmed }] },
      });
    }
  };

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) {
      processLine(line);
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderrBuffer += chunk;
  });

  child.on('error', (err) => {
    onEvent({
      type: 'run_error',
      message: `Error: failed to launch claude (${err.message})`,
      exitCode: 1,
    });
    onClose(1);
  });

  child.on('close', (code) => {
    if (stdoutBuffer.trim()) processLine(stdoutBuffer);

    if (aborted) {
      onEvent({ type: 'run_stopped', exitCode: code ?? 143 });
      onClose(code ?? 143);
      return;
    }

    if (code !== 0 && !sawResultEvent) {
      const detail = stderrBuffer.trim() || `claude exited with code ${code}`;
      onEvent({ type: 'run_error', message: `Error: ${detail} (exit ${code ?? 1})`, exitCode: code ?? 1 });
    }
    onClose(code ?? 0);
  });

  return {
    abort() {
      if (aborted) return;
      aborted = true;
      child.kill('SIGTERM');
      const forceTimer = setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 2000);
      forceTimer.unref?.();
    },
  };
}

/**
 * Parse raw NDJSON text into an array of event objects.
 */
export function parseNdjsonLines(rawText) {
  return String(rawText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function getReplayDelayMs(event, speed) {
  if (speed === 'instant') return 12;
  const factor = speed === '4x' ? 0.25 : 1;

  if (event.type === 'system') return Math.round(110 * factor);
  if (event.type === 'user') return Math.round(420 * factor);
  if (event.type === 'result') return Math.round(240 * factor);
  if (event.parent_tool_use_id) return Math.round(200 * factor);
  return Math.round(300 * factor);
}

/**
 * Replay a recorded `.jsonl` stream progressively so rendering & subagent nesting
 * can be verified deterministically without spending live API quota.
 */
export function startReplayRun({ fixturePath, jsonlText, cwd, speed = '1x', onEvent, onClose }) {
  const check = validateWorkdir(cwd);
  if (!check.ok) {
    onEvent({ type: 'run_error', message: check.error, exitCode: 1 });
    onClose(1);
    return { abort() {} };
  }

  let events;
  try {
    const raw = jsonlText != null ? jsonlText : fs.readFileSync(fixturePath, 'utf8');
    events = parseNdjsonLines(raw);
  } catch (err) {
    onEvent({
      type: 'run_error',
      message: `Error: failed to read replay stream (${err.message})`,
      exitCode: 1,
    });
    onClose(1);
    return { abort() {} };
  }

  if (events.length === 0) {
    onEvent({ type: 'run_error', message: 'Error: replay stream contains no JSON events', exitCode: 1 });
    onClose(1);
    return { abort() {} };
  }

  let timer = null;
  let aborted = false;
  let index = 0;

  const scheduleNext = () => {
    if (aborted) return;
    if (index >= events.length) {
      onClose(0);
      return;
    }

    const evt = events[index];
    index += 1;
    const delay = index === 1 ? 30 : getReplayDelayMs(evt, speed);
    timer = setTimeout(() => {
      if (aborted) return;
      onEvent(evt);
      scheduleNext();
    }, delay);
  };

  scheduleNext();

  return {
    abort() {
      if (aborted) return;
      aborted = true;
      if (timer) clearTimeout(timer);
      onEvent({ type: 'run_stopped', exitCode: 143 });
      onClose(143);
    },
  };
}
