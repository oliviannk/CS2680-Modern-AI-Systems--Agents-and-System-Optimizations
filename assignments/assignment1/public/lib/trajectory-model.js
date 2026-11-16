/**
 * Shared trajectory state reducer for Claude Code headless `stream-json` NDJSON events.
 * Used identically by the browser UI and Node.js unit tests.
 */

import { computeUnifiedDiff } from './markdown.js';

/**
 * Create an initial run state object for a single prompt execution.
 */
export function createRunState({
  runId,
  prompt,
  cwd,
  resumedFromSessionId = null,
  mode = 'live',
  startedAt = Date.now(),
}) {
  return {
    runId,
    prompt,
    cwd,
    mode,
    resumedFromSessionId,
    sessionId: resumedFromSessionId || null,
    model: null,
    tools: [],
    status: 'running', // 'running' | 'finished' | 'failed' | 'stopped'
    startedAt,
    endedAt: null,
    items: [],
    toolIndex: {},
    outline: [],
    metrics: {
      totalCostUsd: null,
      durationMs: null,
      durationApiMs: null,
      numTurns: null,
    },
    errorMessage: null,
    exitCode: null,
    rawEventCount: 0,
    folded: false,
  };
}

/**
 * Produce a concise one-line human summary for a Claude Code tool call input.
 */
export function summarizeToolInput(name, input) {
  if (!input || typeof input !== 'object') {
    return typeof input === 'string' ? truncateText(input, 96) : '';
  }

  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return String(input.file_path || input.path || '');
    case 'Bash':
      return truncateText(String(input.command || '').replace(/\s+/g, ' ').trim(), 110);
    case 'Grep': {
      const pattern = input.pattern ? `"${input.pattern}"` : '';
      const target = input.path ? ` in ${input.path}` : '';
      return `${pattern}${target}`.trim();
    }
    case 'Glob': {
      const pattern = input.pattern ? String(input.pattern) : '';
      const target = input.path ? ` in ${input.path}` : '';
      return `${pattern}${target}`.trim();
    }
    case 'Task':
    case 'Agent':
      return truncateText(String(input.description || input.prompt || ''), 100);
    case 'WebSearch':
      return truncateText(String(input.query || ''), 96);
    case 'WebFetch':
      return truncateText(String(input.url || ''), 96);
    default: {
      const firstVal = Object.values(input).find((v) => typeof v === 'string' && v.trim());
      if (firstVal) return truncateText(firstVal.replace(/\s+/g, ' ').trim(), 96);
      const serialized = JSON.stringify(input);
      return serialized === '{}' ? '' : truncateText(serialized, 96);
    }
  }
}

/**
 * Normalize a tool_result `content` payload (string, content-block array, or object) to plain text.
 */
export function normalizeToolResultContent(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          if (typeof part.text === 'string') return part.text;
          if (typeof part.content === 'string') return part.content;
          return JSON.stringify(part, null, 2);
        }
        return String(part);
      })
      .filter(Boolean)
      .join('\n');
  }
  if (typeof content === 'object') {
    if (typeof content.text === 'string') return content.text;
    return JSON.stringify(content, null, 2);
  }
  return String(content);
}

function truncateText(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? `${str.slice(0, maxLen - 1)}…` : str;
}

function buildEditDiff(name, input) {
  if (!input || typeof input !== 'object') return null;
  if (name === 'Edit' && typeof input.old_string === 'string' && typeof input.new_string === 'string') {
    return [
      {
        filePath: input.file_path || input.path || 'unknown',
        lines: computeUnifiedDiff(input.old_string, input.new_string),
      },
    ];
  }
  if (name === 'MultiEdit' && Array.isArray(input.edits)) {
    return input.edits
      .filter((e) => typeof e?.old_string === 'string' && typeof e?.new_string === 'string')
      .map((e) => ({
        filePath: input.file_path || input.path || 'unknown',
        lines: computeUnifiedDiff(e.old_string, e.new_string),
      }));
  }
  return null;
}

function resolveOrphanPendingCalls(runState, targetStatus) {
  for (const call of Object.values(runState.toolIndex)) {
    if (call.status === 'pending') {
      call.status = targetStatus;
      if (call.finishedAt == null) call.finishedAt = runState.endedAt;
    }
  }
  for (const entry of runState.outline) {
    if (entry.status === 'pending') {
      entry.status = targetStatus;
    }
  }
}

function getTargetContainer(runState, parentToolUseId) {
  if (parentToolUseId && runState.toolIndex[parentToolUseId]) {
    const parentNode = runState.toolIndex[parentToolUseId];
    parentNode.hasSubagentActivity = true;
    const outlineEntry = runState.outline.find((item) => item.toolUseId === parentToolUseId);
    if (outlineEntry) outlineEntry.isSubagentRoot = true;
    return { list: parentNode.children, depth: parentNode.depth + 1 };
  }
  return { list: runState.items, depth: 0 };
}

/**
 * Ingest a single parsed NDJSON event from `claude -p --output-format stream-json --verbose`
 * or a synthetic lifecycle event (`run_error`, `run_stopped`) into `runState`.
 */
export function ingestStreamEvent(runState, rawEvent, timestampMs = Date.now()) {
  if (!rawEvent || typeof rawEvent !== 'object') return runState;
  runState.rawEventCount += 1;

  if (rawEvent.session_id && !runState.sessionId) {
    runState.sessionId = rawEvent.session_id;
  }

  if (rawEvent.type === 'system' && rawEvent.subtype === 'init') {
    if (rawEvent.session_id) runState.sessionId = rawEvent.session_id;
    if (rawEvent.model) runState.model = rawEvent.model;
    if (Array.isArray(rawEvent.tools)) runState.tools = rawEvent.tools;
    return runState;
  }

  if (rawEvent.type === 'assistant') {
    const blocks = rawEvent.message?.content;
    if (!Array.isArray(blocks)) return runState;

    const parentToolUseId = rawEvent.parent_tool_use_id || null;
    const { list, depth } = getTargetContainer(runState, parentToolUseId);

    for (let idx = 0; idx < blocks.length; idx += 1) {
      const block = blocks[idx];
      if (!block || typeof block !== 'object') continue;

      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        list.push({
          kind: 'assistant_text',
          id: `${runState.runId}-txt-${runState.rawEventCount}-${idx}`,
          text: block.text,
          parentToolUseId,
          depth,
          timestampMs,
        });
      } else if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim()) {
        list.push({
          kind: 'thinking',
          id: `${runState.runId}-thk-${runState.rawEventCount}-${idx}`,
          text: block.thinking,
          parentToolUseId,
          depth,
          timestampMs,
        });
      } else if (block.type === 'tool_use') {
        const toolId = block.id || `${runState.runId}-tool-${runState.rawEventCount}-${idx}`;
        const name = block.name || 'Tool';
        const input = block.input ?? {};
        const summary = summarizeToolInput(name, input);
        const toolNode = {
          kind: 'tool_call',
          id: toolId,
          name,
          input,
          summary,
          status: 'pending',
          resultText: '',
          lineCount: 0,
          isError: false,
          children: [],
          hasSubagentActivity: false,
          parentToolUseId,
          depth,
          startedAt: timestampMs,
          finishedAt: null,
          durationMs: null,
          diffs: buildEditDiff(name, input),
        };
        list.push(toolNode);
        runState.toolIndex[toolId] = toolNode;
        runState.outline.push({
          id: `outline-${toolId}`,
          toolUseId: toolId,
          name,
          summary,
          depth,
          parentToolUseId,
          status: 'pending',
          isSubagentRoot: name === 'Task' || name === 'Agent',
        });
      }
    }
    return runState;
  }

  if (rawEvent.type === 'user') {
    const blocks = rawEvent.message?.content;
    if (!Array.isArray(blocks)) return runState;

    for (const block of blocks) {
      if (!block || block.type !== 'tool_result') continue;
      const toolNode = runState.toolIndex[block.tool_use_id];
      if (!toolNode) continue;

      const resultText = normalizeToolResultContent(block.content);
      const isError = Boolean(block.is_error);
      toolNode.resultText = resultText;
      toolNode.lineCount = resultText ? resultText.split(/\r?\n/).length : 0;
      toolNode.isError = isError;
      toolNode.status = isError ? 'error' : 'success';
      toolNode.finishedAt = timestampMs;
      toolNode.durationMs = Math.max(0, timestampMs - toolNode.startedAt);

      const outlineEntry = runState.outline.find((item) => item.toolUseId === toolNode.id);
      if (outlineEntry) outlineEntry.status = toolNode.status;
    }
    return runState;
  }

  if (rawEvent.type === 'result') {
    if (rawEvent.session_id) runState.sessionId = rawEvent.session_id;
    runState.endedAt = timestampMs;
    runState.metrics = {
      totalCostUsd: typeof rawEvent.total_cost_usd === 'number' ? rawEvent.total_cost_usd : null,
      durationMs: typeof rawEvent.duration_ms === 'number' ? rawEvent.duration_ms : null,
      durationApiMs: typeof rawEvent.duration_api_ms === 'number' ? rawEvent.duration_api_ms : null,
      numTurns: typeof rawEvent.num_turns === 'number' ? rawEvent.num_turns : null,
    };

    const isError = Boolean(rawEvent.is_error) || (rawEvent.subtype && rawEvent.subtype !== 'success');
    runState.status = isError ? 'failed' : 'finished';
    if (isError) {
      const errArr = Array.isArray(rawEvent.errors) ? rawEvent.errors.join('; ') : '';
      runState.errorMessage = rawEvent.result || errArr || `Agent ended with subtype "${rawEvent.subtype}"`;
    }
    resolveOrphanPendingCalls(runState, 'interrupted');
    return runState;
  }

  if (rawEvent.type === 'run_error') {
    runState.endedAt = timestampMs;
    runState.status = 'failed';
    runState.errorMessage = rawEvent.message || 'Run failed';
    runState.exitCode = typeof rawEvent.exitCode === 'number' ? rawEvent.exitCode : 1;
    resolveOrphanPendingCalls(runState, 'interrupted');
    return runState;
  }

  if (rawEvent.type === 'run_stopped') {
    runState.endedAt = timestampMs;
    runState.status = 'stopped';
    resolveOrphanPendingCalls(runState, 'interrupted');
    return runState;
  }

  return runState;
}

/**
 * Count total events nested beneath a spawning tool_call node (e.g., Task subagent).
 */
export function countSubtreeEvents(toolNode) {
  if (!toolNode || !Array.isArray(toolNode.children)) return 0;
  let total = 0;
  for (const child of toolNode.children) {
    total += 1;
    if (child.kind === 'tool_call') {
      total += countSubtreeEvents(child);
    }
  }
  return total;
}

/**
 * Extract all Edit, MultiEdit, and Write operations from a run for diff inspection.
 */
export function collectChangedFiles(runState) {
  const changes = [];
  for (const tool of Object.values(runState.toolIndex)) {
    if (tool.name === 'Edit' || tool.name === 'MultiEdit') {
      changes.push({
        toolUseId: tool.id,
        name: tool.name,
        filePath: tool.input?.file_path || tool.input?.path || 'unknown',
        status: tool.status,
        diffs: tool.diffs || [],
      });
    } else if (tool.name === 'Write') {
      const content = String(tool.input?.content || '');
      const lines = content ? content.split(/\r?\n/).map((text, idx) => ({ type: 'add', oldLine: null, newLine: idx + 1, text })) : [];
      changes.push({
        toolUseId: tool.id,
        name: tool.name,
        filePath: tool.input?.file_path || tool.input?.path || 'unknown',
        status: tool.status,
        diffs: [{ filePath: tool.input?.file_path || tool.input?.path || 'unknown', lines }],
      });
    }
  }
  return changes;
}
