import { safeSetMarkdownHtml } from './lib/markdown.js';
import {
  collectChangedFiles,
  countSubtreeEvents,
  createRunState,
  ingestStreamEvent,
} from './lib/trajectory-model.js';

const OUTPUT_PREVIEW_LINES = 8;

const state = {
  env: {
    claudeAvailable: false,
    claudePath: null,
    hasAnthropicApiKey: false,
    demoWorkdir: '',
    fixtures: [],
  },
  sessions: [],
  activeSessionId: null,
  theme: 'auto', // 'auto' | 'light' | 'dark'
  ui: {
    expandedOutputs: new Set(),
    expandedInputs: new Set(),
    collapsedSubagents: new Set(),
    expandedThinking: new Set(),
  },
  accessToken: new URLSearchParams(window.location.search).get('token') || '',
};

let sessionSeq = 0;

// DOM refs
const el = {
  sessionTabs: document.getElementById('session-tabs'),
  btnNewSession: document.getElementById('btn-new-session'),
  sessionIdDisplay: document.getElementById('session-id-display'),
  envStatusBadge: document.getElementById('env-status-badge'),
  sessionTotalsDisplay: document.getElementById('session-totals-display'),
  apiKeyWarning: document.getElementById('api-key-warning'),
  trajectoryFeed: document.getElementById('trajectory-feed'),
  emptyState: document.getElementById('empty-state'),
  composer: document.getElementById('run-composer'),
  inputCwd: document.getElementById('input-cwd'),
  inputPrompt: document.getElementById('input-prompt'),
  btnUseDemoDir: document.getElementById('btn-use-demo-dir'),
  btnUseBadDir: document.getElementById('btn-use-bad-dir'),
  replayControls: document.getElementById('replay-controls'),
  liveControls: document.getElementById('live-controls'),
  selectFixture: document.getElementById('select-fixture'),
  selectSpeed: document.getElementById('select-speed'),
  selectPermissionMode: document.getElementById('select-permission-mode'),
  allowedToolsWrap: document.getElementById('allowed-tools-wrap'),
  inputAllowedTools: document.getElementById('input-allowed-tools'),
  resumeIndicator: document.getElementById('resume-indicator'),
  resumeSessionCode: document.getElementById('resume-session-code'),
  btnRun: document.getElementById('btn-run'),
  btnStop: document.getElementById('btn-stop'),
  outlinePanel: document.getElementById('outline-panel'),
  outlineList: document.getElementById('outline-list'),
  outlineCount: document.getElementById('outline-count'),
  inputOutlineFilter: document.getElementById('input-outline-filter'),
  btnOutlineToggle: document.getElementById('btn-outline-toggle'),
  btnChangedFiles: document.getElementById('btn-changed-files'),
  changedFilesCount: document.getElementById('changed-files-count'),
  btnImportJsonl: document.getElementById('btn-import-jsonl'),
  btnExportJsonl: document.getElementById('btn-export-jsonl'),
  btnThemeToggle: document.getElementById('btn-theme-toggle'),
  changesDialog: document.getElementById('changes-dialog'),
  changesDialogBody: document.getElementById('changes-dialog-body'),
  importDialog: document.getElementById('import-dialog'),
  importForm: document.getElementById('import-form'),
  importFileInput: document.getElementById('import-file-input'),
  importJsonlTextarea: document.getElementById('import-jsonl-textarea'),
};

function authHeaders(extra = {}) {
  const headers = { ...extra };
  if (state.accessToken) headers.Authorization = `Bearer ${state.accessToken}`;
  return headers;
}

function withTokenQuery(url) {
  if (!state.accessToken) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(state.accessToken)}`;
}

function createSession(title) {
  sessionSeq += 1;
  return {
    id: `sess-${sessionSeq}`,
    title: title || `Session ${sessionSeq}`,
    claudeSessionId: null,
    cwd: state.env.demoWorkdir || '',
    runs: [],
    activeRunId: null,
    eventSource: null,
    filter: 'all',
    searchQuery: '',
  };
}

function getActiveSession() {
  return state.sessions.find((s) => s.id === state.activeSessionId) || state.sessions[0];
}

function formatDurationMs(ms) {
  if (ms == null) return '—';
  const seconds = ms / 1000;
  return seconds >= 10 ? `${seconds.toFixed(1)} s` : `${seconds.toFixed(2)} s`;
}

function formatCostUsd(usd) {
  if (usd == null) return '—';
  return `$${usd.toFixed(usd >= 0.01 ? 2 : 4)}`;
}

function shortSessionId(id) {
  if (!id) return '';
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function getSessionStatus(session) {
  const lastRun = session.runs[session.runs.length - 1];
  if (!lastRun) return 'idle';
  return lastRun.status;
}

function computeSessionTotals(session) {
  let totalCost = 0;
  let totalDuration = 0;
  let totalTurns = 0;
  for (const run of session.runs) {
    if (typeof run.metrics.totalCostUsd === 'number') totalCost += run.metrics.totalCostUsd;
    if (typeof run.metrics.durationMs === 'number') totalDuration += run.metrics.durationMs;
    else if (run.endedAt && run.startedAt) totalDuration += run.endedAt - run.startedAt;
    if (typeof run.metrics.numTurns === 'number') totalTurns += run.metrics.numTurns;
  }
  return { totalCost, totalDuration, totalTurns };
}

function renderSessionTabs() {
  const active = getActiveSession();
  el.sessionTabs.replaceChildren();

  for (const sess of state.sessions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.role = 'tab';
    btn.className = `session-tab${sess.id === active.id ? ' is-active' : ''}`;
    btn.setAttribute('aria-selected', String(sess.id === active.id));

    const dot = document.createElement('span');
    const st = getSessionStatus(sess);
    dot.className = `tab-dot is-${st}`;
    btn.appendChild(dot);

    const label = document.createElement('span');
    label.textContent = sess.claudeSessionId ? `${sess.title} (${sess.claudeSessionId.slice(0, 6)})` : sess.title;
    btn.appendChild(label);

    btn.addEventListener('click', () => {
      state.activeSessionId = sess.id;
      el.inputCwd.value = sess.cwd || state.env.demoWorkdir || '';
      renderAll();
    });

    el.sessionTabs.appendChild(btn);
  }
}

function renderTelemetryStrip(session) {
  el.sessionIdDisplay.textContent = session.claudeSessionId || 'new (assigned on init)';
  const { totalCost, totalDuration, totalTurns } = computeSessionTotals(session);
  el.sessionTotalsDisplay.textContent = `${formatCostUsd(totalCost)} · ${formatDurationMs(totalDuration)} · ${totalTurns} turns`;

  if (session.claudeSessionId) {
    el.resumeIndicator.hidden = false;
    el.resumeSessionCode.textContent = shortSessionId(session.claudeSessionId);
  } else {
    el.resumeIndicator.hidden = true;
  }

  const lastRun = session.runs[session.runs.length - 1];
  const isRunning = Boolean(session.activeRunId);
  el.btnRun.disabled = isRunning;
  el.btnStop.hidden = !isRunning;
  el.btnExportJsonl.disabled = !lastRun;

  const changesCount = session.runs.reduce((sum, r) => sum + collectChangedFiles(r).length, 0);
  el.changedFilesCount.textContent = String(changesCount);
}

function matchesSearchAndFilter(node, filter, query) {
  const q = query.trim().toLowerCase();

  if (node.kind === 'assistant_text' || node.kind === 'thinking') {
    if (filter !== 'all' && filter !== 'subagent') return false;
    if (!q) return true;
    return node.text.toLowerCase().includes(q);
  }

  if (node.kind === 'tool_call') {
    const childMatch = (node.children || []).some((ch) => matchesSearchAndFilter(ch, filter, query));
    if (childMatch) return true;

    let filterMatch = true;
    if (filter === 'error') filterMatch = node.status === 'error';
    else if (filter === 'edit') filterMatch = ['Edit', 'MultiEdit', 'Write'].includes(node.name);
    else if (filter === 'subagent') filterMatch = node.hasSubagentActivity || node.name === 'Task' || node.name === 'Agent';

    if (!filterMatch) return false;
    if (!q) return true;
    return (
      node.name.toLowerCase().includes(q) ||
      node.summary.toLowerCase().includes(q) ||
      node.resultText.toLowerCase().includes(q)
    );
  }
  return true;
}

function buildDiffView(diffs) {
  const wrapper = document.createElement('div');
  wrapper.className = 'diff-box';

  for (const diffBlock of diffs) {
    for (const line of diffBlock.lines) {
      const row = document.createElement('div');
      row.className = `diff-line is-${line.type}`;

      const sign = document.createElement('span');
      sign.textContent = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';

      const code = document.createElement('span');
      code.textContent = line.text;

      row.append(sign, code);
      wrapper.appendChild(row);
    }
  }
  return wrapper;
}

function buildToolOutputElement(toolNode) {
  const box = document.createElement('div');
  box.className = `tool-output-box${toolNode.isError ? ' is-error' : ''}`;

  const lines = toolNode.resultText.split(/\r?\n/);
  if (lines.length <= OUTPUT_PREVIEW_LINES) {
    const pre = document.createElement('pre');
    pre.className = 'tool-output-pre';
    pre.textContent = toolNode.resultText;
    box.appendChild(pre);
    return box;
  }

  const previewText = lines.slice(0, OUTPUT_PREVIEW_LINES).join('\n');
  const restText = lines.slice(OUTPUT_PREVIEW_LINES).join('\n');
  const remaining = lines.length - OUTPUT_PREVIEW_LINES;

  const prePreview = document.createElement('pre');
  prePreview.className = 'tool-output-pre';
  prePreview.textContent = previewText;
  box.appendChild(prePreview);

  const foldDetails = document.createElement('details');
  foldDetails.className = 'fold-panel tool-output-fold';
  const isOpen = state.ui.expandedOutputs.has(toolNode.id);
  foldDetails.open = isOpen;

  const summary = document.createElement('summary');
  summary.textContent = isOpen ? `Fold ${remaining} extra lines` : `${remaining} more lines, folded`;

  foldDetails.addEventListener('toggle', () => {
    if (foldDetails.open) {
      state.ui.expandedOutputs.add(toolNode.id);
      summary.textContent = `Fold ${remaining} extra lines`;
    } else {
      state.ui.expandedOutputs.delete(toolNode.id);
      summary.textContent = `${remaining} more lines, folded`;
    }
  });

  const preRest = document.createElement('pre');
  preRest.className = 'tool-output-pre';
  preRest.textContent = restText;

  foldDetails.append(summary, preRest);
  box.appendChild(foldDetails);
  return box;
}

function buildToolCallCard(toolNode, runId, filter, query) {
  const card = document.createElement('article');
  card.className = `tool-card status-${toolNode.status}`;
  card.dataset.toolId = toolNode.id;
  card.dataset.runId = runId;

  // Header
  const header = document.createElement('div');
  header.className = 'tool-card-header';

  const left = document.createElement('div');
  left.className = 'tool-title-left';

  const nameBadge = document.createElement('span');
  nameBadge.className = 'tool-name';
  nameBadge.textContent = toolNode.name;

  const summarySpan = document.createElement('span');
  summarySpan.className = 'tool-summary';
  summarySpan.textContent = toolNode.summary;
  summarySpan.title = toolNode.summary;

  left.append(nameBadge, summarySpan);

  const statusChip = document.createElement('span');
  statusChip.className = `tool-status-chip status-${toolNode.status}`;
  if (toolNode.status === 'pending') {
    statusChip.textContent = '● pending';
  } else if (toolNode.status === 'success') {
    const dur = toolNode.durationMs != null ? ` (${formatDurationMs(toolNode.durationMs)})` : '';
    statusChip.textContent = `✓${dur}`;
  } else if (toolNode.status === 'error') {
    statusChip.textContent = '✕ error';
  } else {
    statusChip.textContent = '■ interrupted';
  }

  header.append(left, statusChip);
  card.appendChild(header);

  // Optional raw input inspector
  if (toolNode.input && Object.keys(toolNode.input).length > 0) {
    const inputDetails = document.createElement('details');
    inputDetails.className = 'fold-panel';
    inputDetails.open = state.ui.expandedInputs.has(toolNode.id);
    inputDetails.addEventListener('toggle', () => {
      if (inputDetails.open) state.ui.expandedInputs.add(toolNode.id);
      else state.ui.expandedInputs.delete(toolNode.id);
    });

    const inputSummary = document.createElement('summary');
    inputSummary.textContent = 'Input parameters';

    const inputPre = document.createElement('pre');
    inputPre.className = 'tool-output-pre';
    inputPre.textContent = JSON.stringify(toolNode.input, null, 2);

    inputDetails.append(inputSummary, inputPre);
    card.appendChild(inputDetails);
  }

  // Inline Edit / MultiEdit Diff
  if (toolNode.diffs && toolNode.diffs.length > 0) {
    card.appendChild(buildDiffView(toolNode.diffs));
  }

  // Tool Result (with 8-line fold)
  if (toolNode.resultText) {
    card.appendChild(buildToolOutputElement(toolNode));
  }

  // Nested Subagent Children (parent_tool_use_id === toolNode.id)
  if (toolNode.children && toolNode.children.length > 0) {
    const subCount = countSubtreeEvents(toolNode);
    const branch = document.createElement('details');
    branch.className = 'fold-panel subagent-branch';
    const isCollapsed = state.ui.collapsedSubagents.has(toolNode.id);
    branch.open = !isCollapsed;

    const branchSummary = document.createElement('summary');
    const updateBranchLabel = () => {
      branchSummary.textContent = branch.open
        ? `Subagent trajectory · ${subCount} events`
        : `· ${subCount} events collapsed`;
    };
    updateBranchLabel();

    branch.addEventListener('toggle', () => {
      if (branch.open) state.ui.collapsedSubagents.delete(toolNode.id);
      else state.ui.collapsedSubagents.add(toolNode.id);
      updateBranchLabel();
    });

    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'subagent-children';

    for (const child of toolNode.children) {
      if (!matchesSearchAndFilter(child, filter, query)) continue;
      childrenContainer.appendChild(renderTrajectoryNode(child, runId, filter, query));
    }

    branch.append(branchSummary, childrenContainer);
    card.appendChild(branch);
  }

  return card;
}

function renderTrajectoryNode(node, runId, filter, query) {
  if (node.kind === 'assistant_text') {
    const box = document.createElement('div');
    box.className = 'assistant-prose';
    safeSetMarkdownHtml(box, node.text);
    return box;
  }

  if (node.kind === 'thinking') {
    const details = document.createElement('details');
    details.className = 'fold-panel';
    details.open = state.ui.expandedThinking.has(node.id);
    details.addEventListener('toggle', () => {
      if (details.open) state.ui.expandedThinking.add(node.id);
      else state.ui.expandedThinking.delete(node.id);
    });
    const summary = document.createElement('summary');
    summary.textContent = 'Model reasoning (thinking)';
    const pre = document.createElement('pre');
    pre.className = 'tool-output-pre';
    pre.textContent = node.text;
    details.append(summary, pre);
    return details;
  }

  return buildToolCallCard(node, runId, filter, query);
}

function countFlatEvents(items) {
  let count = 0;
  for (const item of items) {
    count += 1;
    if (item.kind === 'tool_call') count += countSubtreeEvents(item);
  }
  return count;
}

function buildRunCard(run, session) {
  const card = document.createElement('section');
  card.className = `run-card${run.status === 'failed' ? ' is-failed' : ''}`;
  card.dataset.runId = run.runId;

  // Header
  const header = document.createElement('header');
  header.className = 'run-header';

  const promptWrap = document.createElement('div');
  promptWrap.className = 'run-prompt-wrap';

  const speakerRow = document.createElement('div');
  speakerRow.className = 'run-speaker-row';

  const youTag = document.createElement('span');
  youTag.className = 'speaker-tag';
  youTag.textContent = 'You';
  speakerRow.appendChild(youTag);

  const cwdTag = document.createElement('span');
  cwdTag.className = 'cwd-tag';
  cwdTag.textContent = run.cwd || '(no cwd)';
  speakerRow.appendChild(cwdTag);

  if (run.resumedFromSessionId) {
    const resumedTag = document.createElement('span');
    resumedTag.className = 'resumed-tag';
    resumedTag.textContent = `resumed session ${shortSessionId(run.resumedFromSessionId)}`;
    speakerRow.appendChild(resumedTag);
  }

  const promptText = document.createElement('div');
  promptText.className = 'run-prompt-text';
  promptText.textContent = run.prompt || '(Replay stream)';

  promptWrap.append(speakerRow, promptText);

  const rightHeader = document.createElement('div');
  rightHeader.className = 'run-header-right';

  const statusBadge = document.createElement('span');
  statusBadge.className = `run-status-badge status-${run.status}`;
  statusBadge.dataset.runStatusFor = run.runId;

  if (run.status === 'running') {
    const elapsedMs = Date.now() - run.startedAt;
    statusBadge.textContent = `● running · ${(elapsedMs / 1000).toFixed(1)} s`;
  } else if (run.status === 'finished') {
    statusBadge.textContent = '✓ finished';
  } else if (run.status === 'failed') {
    statusBadge.textContent = '✕ failed';
  } else {
    statusBadge.textContent = '■ stopped';
  }

  rightHeader.appendChild(statusBadge);
  header.append(promptWrap, rightHeader);
  card.appendChild(header);

  // Body
  const body = document.createElement('div');
  body.className = 'run-body';

  const visibleItems = run.items.filter((item) => matchesSearchAndFilter(item, session.filter, session.searchQuery));
  const totalEventCount = countFlatEvents(run.items);

  if (run.status !== 'running' && run.items.length > 0 && run.folded) {
    const foldWrap = document.createElement('details');
    foldWrap.className = 'fold-panel';
    foldWrap.open = false;

    const foldSummary = document.createElement('summary');
    foldSummary.className = 'run-fold-summary';
    foldSummary.textContent = `${totalEventCount} events, folded (click to expand)`;

    foldWrap.addEventListener('toggle', () => {
      run.folded = !foldWrap.open;
      foldSummary.textContent = foldWrap.open
        ? `Fold ${totalEventCount} events`
        : `${totalEventCount} events, folded (click to expand)`;
    });

    const innerList = document.createElement('div');
    innerList.className = 'run-events-list';
    for (const item of visibleItems) {
      innerList.appendChild(renderTrajectoryNode(item, run.runId, session.filter, session.searchQuery));
    }

    foldWrap.append(foldSummary, innerList);
    body.appendChild(foldWrap);
  } else {
    const list = document.createElement('div');
    list.className = 'run-events-list';
    for (const item of visibleItems) {
      list.appendChild(renderTrajectoryNode(item, run.runId, session.filter, session.searchQuery));
    }
    if (visibleItems.length > 0) body.appendChild(list);

    if (run.status === 'finished' && run.items.length > 1) {
      const foldBtn = document.createElement('button');
      foldBtn.type = 'button';
      foldBtn.className = 'btn btn-subtle';
      foldBtn.textContent = `Fold ${totalEventCount} events`;
      foldBtn.addEventListener('click', () => {
        run.folded = true;
        renderAll();
      });
      body.appendChild(foldBtn);
    }
  }

  if (run.errorMessage) {
    const errBanner = document.createElement('div');
    errBanner.className = 'run-error-banner';
    errBanner.textContent = run.errorMessage;
    body.appendChild(errBanner);
  }

  if (body.childNodes.length > 0) {
    card.appendChild(body);
  }

  // Metrics Footer (cost, wall-clock duration, turns, session_id)
  if (run.status !== 'running') {
    const footer = document.createElement('footer');
    footer.className = 'run-footer';

    const leftMetrics = document.createElement('span');
    const wallDuration = run.metrics.durationMs ?? (run.endedAt ? run.endedAt - run.startedAt : null);
    const turnsPart = run.metrics.numTurns != null ? `${run.metrics.numTurns} turns` : '0 turns';
    const costPart = formatCostUsd(run.metrics.totalCostUsd);
    leftMetrics.textContent = `${costPart} · ${formatDurationMs(wallDuration)} · ${turnsPart}`;

    const rightId = document.createElement('span');
    rightId.textContent = run.sessionId ? `session_id ${shortSessionId(run.sessionId)}` : (run.model || run.mode);

    footer.append(leftMetrics, rightId);
    card.appendChild(footer);
  }

  return card;
}

function renderTrajectoryFeed(session) {
  el.trajectoryFeed.replaceChildren();

  if (session.runs.length === 0) {
    el.trajectoryFeed.appendChild(el.emptyState);
    el.emptyState.hidden = false;
    return;
  }

  for (const run of session.runs) {
    el.trajectoryFeed.appendChild(buildRunCard(run, session));
  }
}

function scrollToCall(runId, toolUseId) {
  const runCard = el.trajectoryFeed.querySelector(`[data-run-id="${CSS.escape(runId)}"]`);
  if (!runCard) return;

  // Unfold outer run fold-panel if collapsed
  const runObj = getActiveSession().runs.find((r) => r.runId === runId);
  if (runObj && runObj.folded) {
    runObj.folded = false;
    renderAll();
  }

  const target = el.trajectoryFeed.querySelector(`[data-tool-id="${CSS.escape(toolUseId)}"]`);
  if (!target) return;

  // Open any collapsed ancestor <details> (e.g. collapsed subagent branch)
  let parent = target.parentElement;
  while (parent && parent !== el.trajectoryFeed) {
    if (parent.tagName === 'DETAILS' && !parent.open) {
      parent.open = true;
    }
    parent = parent.parentElement;
  }

  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.add('is-flash');
  setTimeout(() => target.classList.remove('is-flash'), 1200);

  // Close mobile outline drawer after jumping
  el.outlinePanel.classList.remove('is-open-mobile');
  el.btnOutlineToggle.setAttribute('aria-expanded', 'false');
}

function renderOutline(session) {
  el.outlineList.replaceChildren();
  let totalCalls = 0;

  for (let i = 0; i < session.runs.length; i += 1) {
    const run = session.runs[i];
    const turnBtn = document.createElement('button');
    turnBtn.type = 'button';
    turnBtn.className = 'outline-turn-btn';
    turnBtn.textContent = `You · Turn ${i + 1}`;
    turnBtn.addEventListener('click', () => {
      const card = el.trajectoryFeed.querySelector(`[data-run-id="${CSS.escape(run.runId)}"]`);
      card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    el.outlineList.appendChild(turnBtn);

    const q = session.searchQuery.trim().toLowerCase();
    for (const entry of run.outline) {
      if (session.filter === 'error' && entry.status !== 'error') continue;
      if (session.filter === 'edit' && !['Edit', 'MultiEdit', 'Write'].includes(entry.name)) continue;
      if (session.filter === 'subagent' && entry.depth === 0 && !entry.isSubagentRoot) continue;
      if (q && !entry.name.toLowerCase().includes(q) && !entry.summary.toLowerCase().includes(q)) continue;

      totalCalls += 1;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'outline-call-btn';
      btn.style.paddingLeft = `${7 + entry.depth * 14}px`;

      const dot = document.createElement('span');
      dot.className = `tab-dot ${
        entry.status === 'pending'
          ? 'is-running'
          : entry.status === 'success'
            ? 'is-finished'
            : entry.status === 'error'
              ? 'is-failed'
              : ''
      }`;

      const name = document.createElement('span');
      name.className = 'outline-call-name';
      name.textContent = entry.name;

      const summary = document.createElement('span');
      summary.className = 'outline-call-summary';
      summary.textContent = entry.summary;

      btn.append(dot, name, summary);
      btn.addEventListener('click', () => scrollToCall(run.runId, entry.toolUseId));
      el.outlineList.appendChild(btn);
    }
  }

  el.outlineCount.textContent = String(totalCalls);
  if (session.runs.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'outline-empty';
    empty.textContent = 'Tool calls appear here as the trajectory streams.';
    el.outlineList.appendChild(empty);
  }
}

function renderAll() {
  const session = getActiveSession();
  renderSessionTabs();
  renderTelemetryStrip(session);
  renderTrajectoryFeed(session);
  renderOutline(session);
}

/**
 * Start a live Claude CLI run or a replay run on a specific session.
 */
async function startRunOnSession(session, options) {
  if (session.activeRunId) return;

  const {
    prompt,
    cwd,
    mode,
    fixtureId,
    jsonlText = null,
    speed = el.selectSpeed.value,
    permissionMode = el.selectPermissionMode.value,
    allowedToolsRaw = el.inputAllowedTools.value,
    collapseFirstSubagentChildren = false,
  } = options;

  // Fold earlier finished runs to keep follow-up context crisp
  for (const prevRun of session.runs) {
    if (prevRun.status === 'finished') prevRun.folded = true;
  }

  session.cwd = cwd;

  const allowedTools = allowedToolsRaw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const response = await fetch('/api/runs', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      prompt,
      cwd,
      mode,
      fixtureId,
      jsonlText,
      speed,
      resumeSessionId: session.claudeSessionId,
      permissionMode,
      allowedTools,
    }),
  });

  if (!response.ok) {
    const errPayload = await response.json().catch(() => ({ error: response.statusText }));
    const failedRun = createRunState({
      runId: `err-${Date.now()}`,
      prompt,
      cwd,
      resumedFromSessionId: session.claudeSessionId,
      mode,
    });
    ingestStreamEvent(failedRun, {
      type: 'run_error',
      message: errPayload.error || 'Failed to start run',
      exitCode: 1,
    });
    session.runs.push(failedRun);
    renderAll();
    return;
  }

  const { runId } = await response.json();
  const runState = createRunState({
    runId,
    prompt,
    cwd,
    resumedFromSessionId: session.claudeSessionId,
    mode,
  });

  session.runs.push(runState);
  session.activeRunId = runId;
  renderAll();

  const streamUrl = withTokenQuery(`/api/runs/${encodeURIComponent(runId)}/stream`);
  const source = new EventSource(streamUrl);
  session.eventSource = source;

  let subagentRootsSeen = 0;

  source.onmessage = (msg) => {
    let payload;
    try {
      payload = JSON.parse(msg.data);
    } catch {
      return;
    }

    if (payload.type === 'event' && payload.event) {
      ingestStreamEvent(runState, payload.event, payload.ts || Date.now());
      if (runState.sessionId) session.claudeSessionId = runState.sessionId;

      if (collapseFirstSubagentChildren && payload.event.type === 'assistant') {
        const blocks = payload.event.message?.content || [];
        for (const blk of blocks) {
          if (blk?.type === 'tool_use' && (blk.name === 'Task' || blk.name === 'Agent')) {
            subagentRootsSeen += 1;
            if (subagentRootsSeen > 1) {
              state.ui.collapsedSubagents.add(blk.id);
            }
          }
        }
      }

      renderAll();
      if (session.id === state.activeSessionId) {
        const card = el.trajectoryFeed.querySelector(`[data-run-id="${CSS.escape(runId)}"]`);
        card?.scrollIntoView({ behavior: 'auto', block: 'end' });
      }
      return;
    }

    if (payload.type === 'done') {
      source.close();
      session.eventSource = null;
      session.activeRunId = null;
      if (runState.status === 'running') {
        ingestStreamEvent(runState, { type: 'run_stopped' }, Date.now());
      }
      renderAll();
    }
  };

  source.onerror = () => {
    if (runState.status === 'running') {
      ingestStreamEvent(
        runState,
        { type: 'run_error', message: 'Error: lost SSE connection to server stream', exitCode: 1 },
        Date.now()
      );
    }
    source.close();
    session.eventSource = null;
    session.activeRunId = null;
    renderAll();
  };
}

function getExecMode() {
  const checked = document.querySelector('input[name="execMode"]:checked');
  return checked ? checked.value : 'replay';
}

function setExecMode(mode) {
  const radio = document.querySelector(`input[name="execMode"][value="${mode}"]`);
  if (radio) radio.checked = true;
  el.replayControls.hidden = mode !== 'replay';
  el.liveControls.hidden = mode !== 'live';
}

function openChangedFilesModal() {
  const session = getActiveSession();
  const body = el.changesDialogBody;
  body.replaceChildren();

  const allChanges = [];
  for (let i = 0; i < session.runs.length; i += 1) {
    for (const ch of collectChangedFiles(session.runs[i])) {
      allChanges.push({ turn: i + 1, ...ch });
    }
  }

  if (allChanges.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'dialog-note';
    empty.textContent = 'No Edit, MultiEdit, or Write tool calls recorded in this session yet.';
    body.appendChild(empty);
  } else {
    for (const ch of allChanges) {
      const card = document.createElement('section');
      card.className = 'changed-file-card';

      const hdr = document.createElement('div');
      hdr.className = 'changed-file-header';
      hdr.innerHTML = '';
      const pathSpan = document.createElement('span');
      pathSpan.textContent = ch.filePath;
      const metaSpan = document.createElement('span');
      metaSpan.textContent = `Turn ${ch.turn} · ${ch.name} · ${ch.status}`;
      hdr.append(pathSpan, metaSpan);

      card.appendChild(hdr);
      if (ch.diffs && ch.diffs.length > 0) {
        card.appendChild(buildDiffView(ch.diffs));
      }
      body.appendChild(card);
    }
  }

  el.changesDialog.showModal();
}

function wireDialogLightDismiss(dialog) {
  // Mandatory fallback for browsers without native `closedby="any"` (Safari)
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const insideContent =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (!insideContent) dialog.close();
    });
  }
}

function applyPreset(presetKey) {
  const session = getActiveSession();

  if (presetKey === 'bad-path') {
    setExecMode('replay');
    el.inputCwd.value = '/bad/path';
    el.inputPrompt.value = 'start a run in /bad/path';
    el.selectFixture.value = '01-fix-bug';
    startRunOnSession(session, {
      prompt: el.inputPrompt.value,
      cwd: '/bad/path',
      mode: 'replay',
      fixtureId: '01-fix-bug',
    });
    return;
  }

  const fixture = state.env.fixtures.find((f) => f.id === presetKey);
  if (!fixture) return;

  setExecMode('replay');
  el.selectFixture.value = fixture.id;
  el.inputCwd.value = state.env.demoWorkdir;
  el.inputPrompt.value = fixture.prompt;

  startRunOnSession(session, {
    prompt: fixture.prompt,
    cwd: state.env.demoWorkdir,
    mode: 'replay',
    fixtureId: fixture.id,
    collapseFirstSubagentChildren: fixture.id === '03-subagent-survey',
  });
}

function wireEvents() {
  // Mode toggles
  for (const radio of document.querySelectorAll('input[name="execMode"]')) {
    radio.addEventListener('change', () => setExecMode(getExecMode()));
  }

  el.selectPermissionMode.addEventListener('change', () => {
    el.allowedToolsWrap.hidden = el.selectPermissionMode.value !== 'allowedTools';
  });

  el.selectFixture.addEventListener('change', () => {
    const fixture = state.env.fixtures.find((f) => f.id === el.selectFixture.value);
    if (fixture) el.inputPrompt.value = fixture.prompt;
  });

  el.btnUseDemoDir.addEventListener('click', () => {
    el.inputCwd.value = state.env.demoWorkdir;
  });

  el.btnUseBadDir.addEventListener('click', () => {
    el.inputCwd.value = '/bad/path';
    if (!el.inputPrompt.value.trim()) {
      el.inputPrompt.value = 'start a run in /bad/path';
    }
  });

  // Quick scenario buttons
  for (const btn of document.querySelectorAll('[data-preset]')) {
    btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
  }

  // Composer submit & Enter-to-run
  el.inputPrompt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      el.composer.requestSubmit();
    }
  });

  el.composer.addEventListener('submit', (e) => {
    e.preventDefault();
    const session = getActiveSession();
    const mode = getExecMode();
    const cwd = el.inputCwd.value.trim();
    const fixtureId = el.selectFixture.value;
    let prompt = el.inputPrompt.value.trim();

    if (!prompt && mode === 'replay') {
      const fixture = state.env.fixtures.find((f) => f.id === fixtureId);
      prompt = fixture ? fixture.prompt : 'Replay trajectory';
      el.inputPrompt.value = prompt;
    }

    if (!prompt) {
      el.inputPrompt.focus();
      return;
    }

    startRunOnSession(session, {
      prompt,
      cwd,
      mode,
      fixtureId,
      collapseFirstSubagentChildren: mode === 'replay' && fixtureId === '03-subagent-survey',
    });
  });

  el.btnStop.addEventListener('click', async () => {
    const session = getActiveSession();
    if (!session.activeRunId) return;
    await fetch(`/api/runs/${encodeURIComponent(session.activeRunId)}/stop`, {
      method: 'POST',
      headers: authHeaders(),
    });
  });

  el.btnNewSession.addEventListener('click', () => {
    const sess = createSession();
    state.sessions.push(sess);
    state.activeSessionId = sess.id;
    el.inputCwd.value = state.env.demoWorkdir;
    el.inputPrompt.value = '';
    renderAll();
  });

  // Outline search & filter
  el.inputOutlineFilter.addEventListener('input', () => {
    const sess = getActiveSession();
    sess.searchQuery = el.inputOutlineFilter.value;
    renderAll();
  });

  for (const pill of document.querySelectorAll('.filter-pill')) {
    pill.addEventListener('click', () => {
      const sess = getActiveSession();
      sess.filter = pill.dataset.filter;
      for (const p of document.querySelectorAll('.filter-pill')) {
        p.classList.toggle('is-active', p === pill);
      }
      renderAll();
    });
  }

  el.btnOutlineToggle.addEventListener('click', () => {
    const open = el.outlinePanel.classList.toggle('is-open-mobile');
    el.btnOutlineToggle.setAttribute('aria-expanded', String(open));
  });

  // Changed files & import/export dialogs
  el.btnChangedFiles.addEventListener('click', openChangedFilesModal);
  el.btnImportJsonl.addEventListener('click', () => el.importDialog.showModal());

  for (const btn of document.querySelectorAll('[data-close-dialog]')) {
    btn.addEventListener('click', () => {
      document.getElementById(btn.dataset.closeDialog)?.close();
    });
  }

  wireDialogLightDismiss(el.changesDialog);
  wireDialogLightDismiss(el.importDialog);

  el.importFileInput.addEventListener('change', async () => {
    const file = el.importFileInput.files?.[0];
    if (!file) return;
    el.importJsonlTextarea.value = await file.text();
  });

  el.importForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const jsonlText = el.importJsonlTextarea.value.trim();
    if (!jsonlText) return;
    el.importDialog.close();
    const session = getActiveSession();
    startRunOnSession(session, {
      prompt: 'Custom imported stream-json replay',
      cwd: el.inputCwd.value.trim() || state.env.demoWorkdir,
      mode: 'replay',
      jsonlText,
    });
  });

  el.btnExportJsonl.addEventListener('click', () => {
    const session = getActiveSession();
    const lastRun = session.runs[session.runs.length - 1];
    if (!lastRun) return;
    window.open(withTokenQuery(`/api/runs/${encodeURIComponent(lastRun.runId)}/export`), '_blank');
  });

  // Theme toggle: Auto -> Light -> Dark
  el.btnThemeToggle.addEventListener('click', () => {
    const order = ['auto', 'light', 'dark'];
    state.theme = order[(order.indexOf(state.theme) + 1) % order.length];
    if (state.theme === 'auto') {
      delete document.documentElement.dataset.theme;
      el.btnThemeToggle.textContent = 'Theme: Auto';
    } else {
      document.documentElement.dataset.theme = state.theme;
      el.btnThemeToggle.textContent = `Theme: ${state.theme[0].toUpperCase()}${state.theme.slice(1)}`;
    }
  });

  // Live stopwatch updater for running turns without tearing down open <details>
  setInterval(() => {
    const session = getActiveSession();
    if (!session) return;
    for (const run of session.runs) {
      if (run.status !== 'running') continue;
      const badge = el.trajectoryFeed.querySelector(`[data-run-status-for="${CSS.escape(run.runId)}"]`);
      if (badge) {
        const elapsed = ((Date.now() - run.startedAt) / 1000).toFixed(1);
        badge.textContent = `● running · ${elapsed} s`;
      }
    }
  }, 150);
}

async function init() {
  try {
    const res = await fetch('/api/env', { headers: authHeaders() });
    if (res.ok) {
      state.env = await res.json();
    }
  } catch {
    // Keep defaults if offline check fails
  }

  el.envStatusBadge.textContent = state.env.claudeAvailable
    ? `claude CLI ready`
    : 'replay ready (claude CLI missing)';
  el.apiKeyWarning.hidden = !state.env.hasAnthropicApiKey;

  const initialSession = createSession('Session 1');
  state.sessions.push(initialSession);
  state.activeSessionId = initialSession.id;

  el.inputCwd.value = state.env.demoWorkdir;
  const firstFixture = state.env.fixtures[0];
  if (firstFixture) {
    el.inputPrompt.value = firstFixture.prompt;
  }

  wireEvents();
  renderAll();
}

init();
