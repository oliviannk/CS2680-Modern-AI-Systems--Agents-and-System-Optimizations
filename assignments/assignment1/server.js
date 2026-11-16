/**
 * Zero-dependency HTTP + SSE server for CS2680 Assignment 1.
 * Spawns headless `claude -p --output-format stream-json --verbose` or replays `.jsonl` streams.
 * Developed with Google DeepMind Antigravity (not Claude Code).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  discoverClaudeBinary,
  startLiveRun,
  startReplayRun,
} from './lib/claude-runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, 'public');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const DEMO_WORKDIR = path.join(__dirname, 'demo-repo');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jsonl': 'application/x-ndjson; charset=utf-8',
};

const FIXTURE_CATALOG = [
  {
    id: '01-fix-bug',
    title: '1. Fix Parser Bug (Error Fold + Metrics)',
    prompt: 'find the bug that makes test_parse fail and fix it',
    file: '01-fix-bug.jsonl',
    requiresResume: false,
  },
  {
    id: '02-resume-followup',
    title: '2. Resume Session (--json Flag Follow-Up)',
    prompt: 'now add a --json flag to cli.py for those parsed records and run tests',
    file: '02-resume-followup.jsonl',
    requiresResume: true,
  },
  {
    id: '03-subagent-survey',
    title: '3. Subagent Tree Survey + README Edit',
    prompt: 'use subagents to survey the codebase and docs, then update README.md',
    file: '03-subagent-survey.jsonl',
    requiresResume: true,
  },
];

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

async function readJsonBody(req, limitBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('Request payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function isAuthorized(req, urlObj, accessToken) {
  if (!accessToken) return true;
  const header = req.headers.authorization || '';
  if (header === `Bearer ${accessToken}`) return true;
  if (urlObj.searchParams.get('token') === accessToken) return true;
  return false;
}

/**
 * Create the Assignment 1 HTTP server instance.
 */
export function createAppServer({ accessToken = process.env.ACCESS_TOKEN || '' } = {}) {
  const runs = new Map();

  const emitToRun = (run, payload) => {
    const frame = `data: ${JSON.stringify(payload)}\n\n`;
    run.frames.push(frame);
    if (payload.type === 'event' && payload.event) {
      run.rawEvents.push(payload.event);
    }
    for (const listener of run.listeners) {
      listener.write(frame);
      if (payload.type === 'done') listener.end();
    }
    if (payload.type === 'done') {
      run.done = true;
      run.listeners.clear();
    }
  };

  return http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

    if (!isAuthorized(req, reqUrl, accessToken)) {
      res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Unauthorized: valid ACCESS_TOKEN required');
      return;
    }

    // GET /api/env — inspect local runtime capabilities & replay catalog
    if (req.method === 'GET' && reqUrl.pathname === '/api/env') {
      const claude = discoverClaudeBinary();
      sendJson(res, 200, {
        claudeAvailable: claude.available,
        claudePath: claude.path,
        hasAnthropicApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
        demoWorkdir: DEMO_WORKDIR,
        authRequired: Boolean(accessToken),
        fixtures: FIXTURE_CATALOG.map(({ id, title, prompt, requiresResume }) => ({
          id,
          title,
          prompt,
          requiresResume,
        })),
      });
      return;
    }

    // POST /api/runs — start a live Claude CLI run or a replay run
    if (req.method === 'POST' && reqUrl.pathname === '/api/runs') {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        sendJson(res, 400, { error: err.message });
        return;
      }

      const mode = body.mode === 'replay' ? 'replay' : 'live';
      const prompt = String(body.prompt || '').trim();
      const cwd = String(body.cwd ?? '').trim();
      const resumeSessionId = body.resumeSessionId ? String(body.resumeSessionId) : null;
      const permissionMode = body.permissionMode === 'allowedTools' ? 'allowedTools' : 'skip';
      const allowedTools = Array.isArray(body.allowedTools) ? body.allowedTools : undefined;
      const speed = ['1x', '4x', 'instant'].includes(body.speed) ? body.speed : '1x';

      if (!prompt && mode === 'live') {
        sendJson(res, 400, { error: 'Prompt is required for live runs' });
        return;
      }

      const runId = crypto.randomUUID();
      const run = {
        runId,
        mode,
        frames: [],
        rawEvents: [],
        listeners: new Set(),
        done: false,
        handle: null,
      };
      runs.set(runId, run);

      const onEvent = (event) => {
        emitToRun(run, { type: 'event', event, ts: Date.now() });
      };
      const onClose = (exitCode) => {
        emitToRun(run, { type: 'done', exitCode, ts: Date.now() });
      };

      if (mode === 'replay') {
        let fixturePath = null;
        if (!body.jsonlText) {
          const fixtureId = String(body.fixtureId || '01-fix-bug');
          const entry = FIXTURE_CATALOG.find((item) => item.id === fixtureId);
          if (!entry) {
            sendJson(res, 404, { error: `Unknown replay fixture: ${fixtureId}` });
            return;
          }
          fixturePath = path.join(FIXTURES_DIR, entry.file);
        }

        run.handle = startReplayRun({
          fixturePath,
          jsonlText: typeof body.jsonlText === 'string' ? body.jsonlText : null,
          cwd,
          speed,
          onEvent,
          onClose,
        });
      } else {
        run.handle = startLiveRun({
          prompt,
          cwd,
          resumeSessionId,
          permissionMode,
          allowedTools,
          onEvent,
          onClose,
        });
      }

      sendJson(res, 201, { runId, mode });
      return;
    }

    // GET /api/runs/:id/stream — live SSE stream with replay buffer catch-up
    const streamMatch = reqUrl.pathname.match(/^\/api\/runs\/([^/]+)\/stream$/);
    if (req.method === 'GET' && streamMatch) {
      const run = runs.get(streamMatch[1]);
      if (!run) {
        sendJson(res, 404, { error: 'Run not found' });
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Content-Type-Options': 'nosniff',
      });

      for (const frame of run.frames) {
        res.write(frame);
      }

      if (run.done) {
        res.end();
        return;
      }

      run.listeners.add(res);
      req.on('close', () => {
        run.listeners.delete(res);
      });
      return;
    }

    // POST /api/runs/:id/stop — terminate running subprocess or replay timer
    const stopMatch = reqUrl.pathname.match(/^\/api\/runs\/([^/]+)\/stop$/);
    if (req.method === 'POST' && stopMatch) {
      const run = runs.get(stopMatch[1]);
      if (!run) {
        sendJson(res, 404, { error: 'Run not found' });
        return;
      }
      run.handle?.abort();
      sendJson(res, 200, { stopped: true, runId: run.runId });
      return;
    }

    // GET /api/runs/:id/export — export raw NDJSON event stream
    const exportMatch = reqUrl.pathname.match(/^\/api\/runs\/([^/]+)\/export$/);
    if (req.method === 'GET' && exportMatch) {
      const run = runs.get(exportMatch[1]);
      if (!run) {
        sendJson(res, 404, { error: 'Run not found' });
        return;
      }
      const ndjson = run.rawEvents.map((e) => JSON.stringify(e)).join('\n') + '\n';
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Content-Disposition': `attachment; filename="claude-run-${run.runId.slice(0, 8)}.jsonl"`,
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(ndjson);
      return;
    }

    // Static assets from ./public
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    const relativePath = reqUrl.pathname === '/' ? 'index.html' : reqUrl.pathname.replace(/^\/+/, '');
    const resolved = path.resolve(PUBLIC_DIR, relativePath);
    if (resolved !== PUBLIC_DIR && !resolved.startsWith(PUBLIC_DIR + path.sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    fs.readFile(resolved, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      const ext = path.extname(resolved).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const port = Number(process.env.PORT || 3456);
  const host = process.env.HOST || '127.0.0.1';
  const server = createAppServer();
  server.listen(port, host, () => {
    console.log(`CS2680 Assignment 1 Observer listening on http://${host}:${port}`);
    console.log(`Demo workdir: ${DEMO_WORKDIR}`);
  });
}
