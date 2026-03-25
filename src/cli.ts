/**
 * Mission Control CLI — thin wrapper that talks to the persistent server
 *
 * Flow:
 *   1. Read .gstack/missioncontrol-server.json for port + token
 *   2. If missing or stale PID → start server in background
 *   3. Health check + version mismatch detection
 *   4. Send command via HTTP request
 *   5. Print response to stdout (or stderr for errors)
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolveConfig, ensureStateDir, readVersionHash } from './config';

const config = resolveConfig();

function resolveServerScript(
  env: Record<string, string | undefined> = process.env,
  metaDir: string = import.meta.dir,
  execPath: string = process.execPath,
): string {
  if (env.MC_SERVER_SCRIPT) {
    return env.MC_SERVER_SCRIPT;
  }

  // Dev mode: cli.ts runs directly from missioncontrol/src
  if (!metaDir.includes('$bunfs')) {
    const direct = path.resolve(metaDir, 'server.ts');
    if (fs.existsSync(direct)) {
      return direct;
    }
  }

  // Compiled binary: derive source tree from missioncontrol/dist/missioncontrol
  if (execPath) {
    const adjacent = path.resolve(path.dirname(execPath), '..', 'src', 'server.ts');
    if (fs.existsSync(adjacent)) {
      return adjacent;
    }
  }

  throw new Error(
    'Cannot find server.ts. Set MC_SERVER_SCRIPT env or run from the missioncontrol source tree.'
  );
}

// Lazy — only resolved when we actually need to start the server
let _serverScript: string | null = null;
function getServerScript(): string {
  if (!_serverScript) _serverScript = resolveServerScript();
  return _serverScript;
}

interface ServerState {
  pid: number;
  port: number;
  token: string;
  startedAt: string;
  serverPath: string;
  binaryVersion?: string;
}

// ─── State File ────────────────────────────────────────────────
function readState(): ServerState | null {
  try {
    const data = fs.readFileSync(config.serverStateFile, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ─── Process Management ─────────────────────────────────────────
async function killServer(pid: number): Promise<void> {
  if (!isProcessAlive(pid)) return;

  try { process.kill(pid, 'SIGTERM'); } catch { return; }

  // Wait up to 2s for graceful shutdown
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && isProcessAlive(pid)) {
    await Bun.sleep(100);
  }

  // Force kill if still alive
  if (isProcessAlive(pid)) {
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }
}

// ─── Server Lifecycle ──────────────────────────────────────────
async function startServer(): Promise<ServerState> {
  ensureStateDir(config);

  // Clean up stale state file
  try { fs.unlinkSync(config.serverStateFile); } catch {}

  const proc = Bun.spawn(['bun', 'run', getServerScript()], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MC_STATE_FILE: config.serverStateFile },
  });

  // Don't hold the CLI open
  proc.unref();

  // Wait for state file to appear
  const start = Date.now();
  while (Date.now() - start < 8000) {
    const state = readState();
    if (state && isProcessAlive(state.pid)) {
      return state;
    }
    await Bun.sleep(100);
  }

  // If we get here, server didn't start in time
  // Try to read stderr for error message
  const stderr = proc.stderr;
  if (stderr) {
    const reader = stderr.getReader();
    const { value } = await reader.read();
    if (value) {
      const errText = new TextDecoder().decode(value);
      throw new Error(`Server failed to start:\n${errText}`);
    }
  }
  throw new Error('Server failed to start within 8s');
}

async function ensureServer(): Promise<ServerState> {
  const state = readState();

  if (state && isProcessAlive(state.pid)) {
    // Check for binary version mismatch (auto-restart on update)
    const currentVersion = readVersionHash();
    if (currentVersion && state.binaryVersion && currentVersion !== state.binaryVersion) {
      console.error('[missioncontrol] Binary updated, restarting server...');
      await killServer(state.pid);
      return startServer();
    }

    // Server appears alive — do a health check
    try {
      const resp = await fetch(`http://127.0.0.1:${state.port}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (resp.ok) {
        const health = await resp.json() as any;
        if (health.status === 'healthy') {
          return state;
        }
      }
    } catch {
      // Health check failed — server is dead or unhealthy
    }
  }

  // Need to (re)start
  console.error('[missioncontrol] Starting server...');
  return startServer();
}

// ─── Command Dispatch ──────────────────────────────────────────
async function sendCommand(state: ServerState, endpoint: string, method: string, body?: any): Promise<any> {
  const resp = await fetch(`http://127.0.0.1:${state.port}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${state.token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    try {
      const err = JSON.parse(text);
      throw new Error(err.error || text);
    } catch (e: any) {
      if (e.message !== text) throw e;
      throw new Error(text);
    }
  }

  const text = await resp.text();
  try { return JSON.parse(text); } catch { return text; }
}

// ─── Output Formatting ─────────────────────────────────────────
function printBoardState(data: any): void {
  const cards: any[] = data.cards || [];
  const byColumn: Record<string, any[]> = {};

  for (const card of cards) {
    const col = card.column || 'Backlog';
    if (!byColumn[col]) byColumn[col] = [];
    byColumn[col].push(card);
  }

  if (Object.keys(byColumn).length === 0) {
    console.log('Board is empty');
    return;
  }

  for (const [column, colCards] of Object.entries(byColumn)) {
    console.log(`\n${column} (${colCards.length})`);
    for (const card of colCards) {
      const status = card.status ? ` [${card.status}]` : '';
      console.log(`  ${card.id}${status}  ${card.title}`);
    }
  }
}

// ─── Main ──────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    console.log(`Mission Control — Visual Agent Task Manager

Usage: missioncontrol <command> [args...]

Commands:
  start                    Start the Mission Control server
  stop                     Stop the server
  open                     Open the board in your browser
  show                     Print board state to terminal
  add "title"              Add a card to the backlog
  move <id> <column>       Move a card to a column
  process                  List pending cards for skill execution`);
    process.exit(0);
  }

  const command = args[0];

  switch (command) {
    case 'start': {
      const state = await ensureServer();
      console.log(`Mission Control running at http://127.0.0.1:${state.port}`);
      break;
    }
    case 'stop': {
      const state = readState();
      if (state && isProcessAlive(state.pid)) {
        await killServer(state.pid);
        console.log('Mission Control stopped');
      } else {
        console.log('Mission Control is not running');
      }
      break;
    }
    case 'open': {
      const state = await ensureServer();
      const url = `http://127.0.0.1:${state.port}`;
      Bun.spawn(['open', url]);
      console.log(`Opened ${url}`);
      break;
    }
    case 'show': {
      const state = await ensureServer();
      const data = await sendCommand(state, '/api/state', 'GET');
      printBoardState(data);
      break;
    }
    case 'add': {
      const title = args[1];
      if (!title) { console.error('Usage: missioncontrol add "title"'); process.exit(1); }
      const descIdx = args.indexOf('--desc');
      const tagsIdx = args.indexOf('--tags');
      const description = descIdx !== -1 ? args[descIdx + 1] : '';
      const tags = tagsIdx !== -1 ? args[tagsIdx + 1].split(',').map(t => t.trim()) : [];
      const state = await ensureServer();
      const card = await sendCommand(state, '/api/cards', 'POST', { title, description, tags });
      console.log(`Created card: ${card.id} "${card.title}"`);
      break;
    }
    case 'move': {
      const cardId = args[1];
      const column = args[2];
      if (!cardId || !column) { console.error('Usage: missioncontrol move <id> <column>'); process.exit(1); }
      const state = await ensureServer();
      const result = await sendCommand(state, `/api/cards/${cardId}/move`, 'POST', { column });
      console.log(`Moved "${result.card.title}" to ${result.card.column}`);
      if (result.skill) console.log(`Skill triggered: ${result.skill}`);
      break;
    }
    case 'process': {
      const state = await ensureServer();
      const data = await sendCommand(state, '/api/state', 'GET');
      const pending = data.cards.filter((c: any) => c.status === 'pending');
      if (pending.length === 0) {
        console.log('No pending cards');
      } else {
        console.log(`${pending.length} pending card(s):\n`);
        for (const card of pending) {
          console.log(`  ${card.id}  "${card.title}"  → ${card.skillTriggered}  (column: ${card.column})`);
        }
      }
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(`[missioncontrol] ${err.message}`);
    process.exit(1);
  });
}
