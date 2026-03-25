/**
 * gstack missioncontrol server — persistent Kanban board daemon
 *
 * Architecture:
 *   Bun.serve HTTP on 0.0.0.0 → serves board UI and REST API
 *   Auth: HMAC-signed HttpOnly cookie (browser) + Bearer token (CLI)
 *   No idle timeout — board stays alive for phone access
 *
 * State:
 *   Server state: <project-root>/.gstack/missioncontrol-server.json
 *   Board state:  <project-root>/.gstack/missioncontrol.json
 *   Log files:    <project-root>/.gstack/missioncontrol-logs/
 *   Port:         random 10000-60000 (or MC_PORT env for debug override)
 */

import { resolveConfig, ensureStateDir, readVersionHash, type MCConfig } from './config';
import {
  loadState,
  createCard,
  moveCard,
  updateCard,
  deleteCard,
  getCard,
  addActivity,
  setCardStatus,
  isCardStatus,
  COLUMNS,
  type ActivityActor,
  type AttentionMode,
  type Card,
  type CardAttachment,
} from './state';
import { generateBoardHTML } from './ui';
import { stripBasePath } from './base-path';
import { mergeSessionEntry, resolveSessionTranscriptPath, resolveStorePath, updateSessionStore } from '/openclaw/packages/moltbot/node_modules/openclaw/src/config/sessions.ts';
import { normalizeAgentId } from '/openclaw/packages/moltbot/node_modules/openclaw/src/routing/session-key.ts';
import { loadGatewayModelCatalog, type GatewayModelChoice } from '/openclaw/packages/moltbot/node_modules/openclaw/src/gateway/server-model-catalog.ts';
import { loadConfig } from '/openclaw/packages/moltbot/node_modules/openclaw/src/config/config.js';
import { applyModelOverrideToSessionEntry } from '/openclaw/packages/moltbot/node_modules/openclaw/src/sessions/model-overrides.ts';
import { resolveAllowedModelRef, resolveDefaultModelForAgent } from '/openclaw/packages/moltbot/node_modules/openclaw/src/agents/model-selection.ts';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ─── Config ─────────────────────────────────────────────────────
const config = resolveConfig();
ensureStateDir(config);

// ─── Base Path (for reverse proxy deployments) ──────────────────
const MC_BASE_PATH = (process.env.MC_BASE_PATH || '').replace(/\/+$/, '');

// ─── OpenClaw Durable Sessions ─────────────────────────────────
const OPENCLAW_AGENT_ID = normalizeAgentId(process.env.MC_OPENCLAW_AGENT_ID || 'main');
const OPENCLAW_SESSION_STORE = resolveStorePath(undefined, { agentId: OPENCLAW_AGENT_ID });
const AGENT_TIMEOUT_SECONDS = String(parseInt(process.env.MC_AGENT_TIMEOUT_SECONDS || '1800', 10) || 1800);

type ActiveRun = {
  runId: string;
  proc: Bun.Subprocess;
};

const ACTIVE_RUNS = new Map<string, ActiveRun>();
let SERVER_PORT = 0;

type ModelOption = {
  ref: string;
  label: string;
  provider: string;
  providerLabel: string;
  model: string;
  name: string;
};

type CardModelView = {
  modelState: 'default' | 'selected' | 'unavailable';
  modelLabel: string | null;
  modelBadgeLabel: string | null;
};

type AttentionLevel = 'none' | 'output' | 'comment' | 'patrick';

type CardAttentionDerived = {
  logUpdatedAt: string | null;
  hasUnreadOutput: boolean;
  unreadCommentCount: number;
  attentionLevel: AttentionLevel;
};

type CardView = Card & CardModelView & {
  derived: CardAttentionDerived;
};

let modelOptionsCache:
  | {
      expiresAt: number;
      options: ModelOption[];
      byRef: Map<string, ModelOption>;
      defaultRef: string;
    }
  | null = null;

const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_CARD = 20;
const MAX_TOTAL_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024;

function getCardUploadsDir(cardId: string): string {
  return path.join(config.uploadsDir, cardId);
}

function getAttachmentDiskPath(cardId: string, attachment: Pick<CardAttachment, 'storedName'>): string {
  return path.join(getCardUploadsDir(cardId), attachment.storedName);
}

function sumAttachmentBytes(attachments: CardAttachment[]): number {
  return attachments.reduce((sum, attachment) => sum + (attachment.sizeBytes || 0), 0);
}

export function sanitizeAttachmentName(originalName: string): string {
  const trimmed = String(originalName || '').trim();
  const base = path.basename(trimmed || 'upload');
  const ext = path.extname(base).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 20);
  const stem = (ext ? base.slice(0, -ext.length) : base)
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^[_\. -]+|[_\. -]+$/g, '')
    .slice(0, 180) || 'upload';
  return `${stem}${ext}`.slice(0, 200);
}

export function detectImageMime(bytes: Uint8Array, originalName: string = ''): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return 'image/gif';
  }
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp';
  }

  const sample = Buffer.from(bytes.slice(0, 2048)).toString('utf-8').trimStart();
  const sampleLower = sample.toLowerCase();
  if (sampleLower.startsWith('<svg') || sampleLower.startsWith('<?xml') || sampleLower.includes('<svg')) {
    const ext = path.extname(originalName).toLowerCase();
    if (!ext || ext === '.svg') return 'image/svg+xml';
  }

  return null;
}

function safeRemoveCardUploadsDir(cardId: string): void {
  const resolvedRoot = path.resolve(config.uploadsDir);
  const targetDir = path.resolve(getCardUploadsDir(cardId));
  if (!targetDir.startsWith(resolvedRoot + path.sep) && targetDir !== resolvedRoot) {
    throw new Error('Refusing to remove uploads outside missioncontrol-uploads root');
  }
  fs.rmSync(targetDir, { recursive: true, force: true });
}

function markAttachmentsUsed(card: Card, usedAt: string): Card {
  if (!Array.isArray(card.attachments) || card.attachments.length === 0) return card;
  const nextAttachments = card.attachments.map((attachment) => ({
    ...attachment,
    lastUsedAt: usedAt,
  }));
  return updateCard(config, card.id, { attachments: nextAttachments });
}

function findAttachment(card: Card, attachmentId: string): CardAttachment | null {
  return (card.attachments || []).find((attachment) => attachment.id === attachmentId) || null;
}

function normalizeCardForResponse(card: Card, modelIndex?: Map<string, ModelOption>): CardView {
  return decorateCard(card, modelIndex);
}

function formatProviderLabel(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === 'github-copilot') return 'GitHub Copilot';
  if (normalized === 'openai-codex') return 'OpenAI Codex';
  if (normalized === 'anthropic') return 'Anthropic';
  if (normalized === 'google') return 'Google';
  if (normalized === 'openai') return 'OpenAI';
  return provider
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

async function getModelOptions(): Promise<{
  options: ModelOption[];
  byRef: Map<string, ModelOption>;
  defaultRef: string;
}> {
  const now = Date.now();
  if (modelOptionsCache && modelOptionsCache.expiresAt > now) {
    return modelOptionsCache;
  }

  const cfg = loadConfig();
  const defaultModel = resolveDefaultModelForAgent({ cfg, agentId: OPENCLAW_AGENT_ID });
  const defaultRef = `${defaultModel.provider}/${defaultModel.model}`;
  const catalog = await loadGatewayModelCatalog();
  const available: GatewayModelChoice[] = [];
  for (const entry of catalog) {
    const resolved = resolveAllowedModelRef({
      cfg,
      catalog,
      raw: `${entry.provider}/${entry.id}`,
      defaultProvider: defaultModel.provider,
      defaultModel: defaultModel.model,
    });
    if (!('ref' in resolved)) continue;
    available.push(entry);
  }

  const nameCounts = new Map<string, number>();
  for (const entry of available) {
    const name = (entry.name || entry.id).trim();
    const key = name.toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
  }

  const options = available.map((entry) => {
    const name = (entry.name || entry.id).trim();
    const providerLabel = formatProviderLabel(entry.provider);
    const useProviderSuffix = (nameCounts.get(name.toLowerCase()) || 0) > 1 || entry.provider === 'github-copilot';
    const label = useProviderSuffix ? `${name} · ${providerLabel}` : name;
    return {
      ref: `${entry.provider}/${entry.id}`,
      label,
      provider: entry.provider,
      providerLabel,
      model: entry.id,
      name,
    } satisfies ModelOption;
  });

  const byRef = new Map(options.map((option) => [option.ref.toLowerCase(), option]));
  modelOptionsCache = {
    expiresAt: now + 30_000,
    options,
    byRef,
    defaultRef,
  };
  return modelOptionsCache;
}

function decorateCardWithModelView(card: Card, modelIndex?: Map<string, ModelOption>): Card & CardModelView {
  const rawRef = card.modelRef?.trim();
  if (!rawRef) {
    return {
      ...card,
      modelState: 'default',
      modelLabel: null,
      modelBadgeLabel: null,
    };
  }

  if (!modelIndex) {
    return {
      ...card,
      modelState: 'selected',
      modelLabel: rawRef,
      modelBadgeLabel: `Model: ${rawRef}`,
    };
  }

  const option = modelIndex.get(rawRef.toLowerCase()) || null;
  if (!option) {
    return {
      ...card,
      modelState: 'unavailable',
      modelLabel: null,
      modelBadgeLabel: 'Model unavailable',
    };
  }

  return {
    ...card,
    modelState: 'selected',
    modelLabel: option.label,
    modelBadgeLabel: `Model: ${option.label}`,
  };
}

function getLogUpdatedAt(card: Card): string | null {
  if (!card.logFile) return null;
  try {
    return fs.statSync(card.logFile).mtime.toISOString();
  } catch {
    return null;
  }
}

function getUnreadCommentCount(card: Card): number {
  return (card.activity || []).filter((entry) => {
    if (entry.actor === 'system') return false;
    if (!card.lastViewedAt) return true;
    return entry.timestamp > card.lastViewedAt;
  }).length;
}

function decorateCard(card: Card, modelIndex?: Map<string, ModelOption>): CardView {
  const logUpdatedAt = getLogUpdatedAt(card);
  const hasUnreadOutput = !!logUpdatedAt && (!card.lastViewedAt || logUpdatedAt > card.lastViewedAt);
  const unreadCommentCount = getUnreadCommentCount(card);
  const attentionLevel: AttentionLevel =
    card.attentionMode === 'waiting_on_patrick'
      ? 'patrick'
      : unreadCommentCount > 0
        ? 'comment'
        : hasUnreadOutput
          ? 'output'
          : 'none';

  return {
    ...decorateCardWithModelView(card, modelIndex),
    derived: {
      logUpdatedAt,
      hasUnreadOutput,
      unreadCommentCount,
      attentionLevel,
    },
  };
}

async function applyCardModelToSession(card: Card): Promise<void> {
  if (!card.sessionKey || !card.sessionId) return;

  const cfg = loadConfig();
  const configured = resolveDefaultModelForAgent({ cfg, agentId: OPENCLAW_AGENT_ID });
  const modelOptions = await getModelOptions();

  await updateSessionStore(OPENCLAW_SESSION_STORE, (store) => {
    const existing = store[card.sessionKey] || mergeSessionEntry(undefined, {
      sessionId: card.sessionId || crypto.randomUUID(),
      updatedAt: Date.now(),
      sessionFile: card.sessionFile || resolveSessionTranscriptPath(card.sessionId || crypto.randomUUID(), OPENCLAW_AGENT_ID),
      label: `missioncontrol:${card.id}`,
      displayName: `Mission Control — ${card.title}`,
      subject: card.title,
      origin: {
        label: 'Mission Control',
        provider: 'missioncontrol',
        surface: 'kanban',
      },
      lastChannel: 'webchat',
    });
    const entry = mergeSessionEntry(existing, {
      sessionId: card.sessionId,
      updatedAt: Date.now(),
      sessionFile: card.sessionFile || resolveSessionTranscriptPath(card.sessionId, OPENCLAW_AGENT_ID),
      label: `missioncontrol:${card.id}`,
      displayName: `Mission Control — ${card.title}`,
      subject: card.title,
    });

    if (!card.modelRef) {
      applyModelOverrideToSessionEntry({
        entry,
        selection: {
          provider: configured.provider,
          model: configured.model,
          isDefault: true,
        },
      });
    } else {
      const option = modelOptions.byRef.get(card.modelRef.toLowerCase());
      if (!option) {
        throw new Error(`Saved model is not available: ${card.modelRef}`);
      }
      applyModelOverrideToSessionEntry({
        entry,
        selection: {
          provider: option.provider,
          model: option.model,
          isDefault: option.ref === modelOptions.defaultRef,
        },
      });
    }

    store[card.sessionKey] = entry;
    return entry;
  });
}

function getColumnName(columnId: string): string {
  return COLUMNS.find((column) => column.id === columnId)?.name || columnId;
}

function shortId(value: string | null | undefined): string {
  if (!value) return 'unknown';
  return value.length > 8 ? value.slice(0, 8) : value;
}

function buildCardSessionKey(card: Card): string {
  return `agent:${OPENCLAW_AGENT_ID}:missioncontrol:card:${card.id.toLowerCase()}`;
}

function buildCardApiUrl(cardId: string): string {
  return `http://127.0.0.1:${SERVER_PORT}/api/cards/${cardId}`;
}

function buildCardAgentEnv(cardId: string): Record<string, string | undefined> {
  return {
    ...process.env,
    MC_CARD_API_URL: buildCardApiUrl(cardId),
    MC_AUTH_TOKEN: AUTH_TOKEN,
  };
}

function appendLog(logFile: string, text: string): void {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, text, { encoding: 'utf-8', mode: 0o600 });
}

async function pipeStreamToLog(
  stream: ReadableStream<Uint8Array> | null | undefined,
  logFile: string,
  prefix = '',
): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      appendLog(logFile, `${prefix}${decoder.decode(value, { stream: true })}`);
    }
    const tail = decoder.decode();
    if (tail) appendLog(logFile, `${prefix}${tail}`);
  } catch (err: any) {
    appendLog(logFile, `\n[missioncontrol] log stream error: ${err.message}\n`);
  }
}

export function buildStagePrompt(params: {
  card: Card;
  skill: string;
  columnName: string;
  firstTurn: boolean;
}): string {
  const { card, skill, columnName, firstTurn } = params;
  const lines = [
    `Mission Control durable card session update.`,
    firstTurn
      ? `This is the first OpenClaw turn for this Mission Control card. Treat this session as the durable work thread for the card going forward.`
      : `Resume the existing Mission Control work thread for this card. Continue from prior work in this same session instead of starting over.`,
    `Card title: ${card.title}`,
    `Card ID: ${card.id}`,
    `Current stage: ${columnName}`,
    `Requested skill/stage mode: ${skill}`,
  ];

  if (card.description?.trim()) {
    lines.push(`Card description:\n${card.description.trim()}`);
  }

  if ((card.attachments || []).length > 0) {
    const attachmentLines = (card.attachments || []).map((attachment) => {
      const attachmentPath = getAttachmentDiskPath(card.id, attachment);
      return `[media attached: ${attachmentPath} (${attachment.mimeType})]`;
    });
    lines.push(`Card attachments (images the agent can see):\n${attachmentLines.join('\n')}`);
  }

  if ((card.tags || []).length > 0) {
    lines.push(`Tags: ${(card.tags || []).join(', ')}`);
  }

  lines.push(
    `If you need human input to proceed, ask exactly one clear question by POSTing to the Mission Control callback URL in this environment:`,
    `curl -sS -X POST "$MC_CARD_API_URL/question" \\\n  -H "Authorization: Bearer $MC_AUTH_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  --data '{"text":"<your question here>"}'`,
    `After posting the question, stop and wait. Do not guess, do not continue with placeholder assumptions, and do not ask the human anywhere else. When the human replies in the card UI, their response will be sent back into this same session so you can continue.`,
    `Task: advance this card in the ${columnName} stage and leave the thread in a resumable state for the next stage move.`,
  );

  return lines.join('\n\n');
}

async function ensureCardSession(config: MCConfig, card: Card): Promise<Card> {
  const sessionId = card.sessionId || crypto.randomUUID();
  const sessionKey = card.sessionKey || buildCardSessionKey(card);
  const sessionFile = card.sessionFile || resolveSessionTranscriptPath(sessionId, OPENCLAW_AGENT_ID);

  await updateSessionStore(OPENCLAW_SESSION_STORE, (store) => {
    store[sessionKey] = mergeSessionEntry(store[sessionKey], {
      sessionId,
      updatedAt: Date.now(),
      sessionFile,
      label: `missioncontrol:${card.id}`,
      displayName: `Mission Control — ${card.title}`,
      subject: card.title,
      origin: {
        label: 'Mission Control',
        provider: 'missioncontrol',
        surface: 'kanban',
      },
      lastChannel: 'webchat',
    });
    return store[sessionKey];
  });

  const linkedCard = updateCard(config, card.id, {
    sessionId,
    sessionKey,
    sessionFile,
  });

  if (!card.sessionId || !card.sessionKey) {
    addActivity(
      config,
      card.id,
      'session_linked',
      `Linked durable OpenClaw session ${shortId(sessionId)} (${sessionKey})`,
      { actor: 'system', sessionId, sessionKey },
    );
  }

  return linkedCard;
}

function cancelActiveRun(cardId: string, reason?: string): void {
  const active = ACTIVE_RUNS.get(cardId);
  if (!active) return;
  ACTIVE_RUNS.delete(cardId);
  try {
    active.proc.kill();
  } catch {}
  const card = getCard(config, cardId);
  if (card?.logFile) {
    appendLog(card.logFile, `\n[missioncontrol] Cancelled active run${reason ? `: ${reason}` : ''}\n`);
  }
  if (card) {
    addActivity(config, cardId, 'run_cancelled', reason ? `Run cancelled: ${reason}` : 'Run cancelled', {
      column: card.column,
      skill: card.skillTriggered || undefined,
      reason,
    });
  }
}

function attachRunExitHandler(params: {
  cardId: string;
  runId: string;
  proc: Bun.Subprocess;
  logFile: string;
  columnName: string;
  sessionId: string | null;
  column: string;
  skill: string | null;
}): void {
  const { cardId, runId, proc, logFile, columnName, sessionId, column, skill } = params;

  void proc.exited
    .then((exitCode) => {
      const active = ACTIVE_RUNS.get(cardId);
      if (!active || active.runId !== runId) {
        return;
      }
      ACTIVE_RUNS.delete(cardId);

      const currentCard = getCard(config, cardId);
      if (currentCard?.status === 'awaiting_human') {
        appendLog(
          logFile,
          `\n[missioncontrol] Process exited with code ${exitCode}; card is awaiting human input so status was preserved\n`,
        );
        return;
      }

      const status = exitCode === 0 ? 'complete' : 'failed';
      const activityType = exitCode === 0 ? 'run_completed' : 'run_failed';
      const activityText =
        exitCode === 0
          ? `${columnName} completed in durable session ${shortId(sessionId)}`
          : `${columnName} failed in durable session ${shortId(sessionId)} (exit ${exitCode})`;

      appendLog(logFile, `\n[missioncontrol] Process exited with code ${exitCode}\n`);
      setCardStatus(config, cardId, status, {
        column,
        skill: skill || undefined,
      });
      addActivity(config, cardId, activityType, activityText, {
        column,
        skill: skill || undefined,
        ...(typeof exitCode === 'number' ? { exitCode } : {}),
      });
    })
    .catch((err: any) => {
      const active = ACTIVE_RUNS.get(cardId);
      if (!active || active.runId !== runId) {
        return;
      }
      ACTIVE_RUNS.delete(cardId);
      appendLog(logFile, `\n[missioncontrol] Execution error: ${err.message}\n`);
      setCardStatus(config, cardId, 'failed', {
        column,
        skill: skill || undefined,
      });
      addActivity(config, cardId, 'run_failed', `${columnName} failed: ${err.message}`, {
        column,
        skill: skill || undefined,
      });
    });
}

async function startCardSessionRun(params: {
  config: MCConfig;
  card: Card;
  skill: string;
}): Promise<void> {
  const { config, skill } = params;
  const firstTurn = !params.card.sessionId;
  let card = await ensureCardSession(config, params.card);
  await applyCardModelToSession(card);
  card = markAttachmentsUsed(card, new Date().toISOString());
  const columnName = getColumnName(card.column);
  const logFile =
    card.logFile || path.join(config.logsDir, `${card.id}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

  cancelActiveRun(card.id, `stage moved to ${columnName}`);

  card = updateCard(config, card.id, {
    skillTriggered: skill,
    logFile,
  });
  card = setCardStatus(config, card.id, 'running', {
    column: card.column,
    skill,
  });
  addActivity(
    config,
    card.id,
    'run_started',
    `${firstTurn ? 'Started' : 'Resumed'} ${columnName} in durable OpenClaw session ${shortId(card.sessionId)}`,
    { column: card.column, skill, sessionId: card.sessionId || undefined },
  );

  appendLog(
    logFile,
    `\n=== Mission Control stage run ===\n` +
      `[started] ${new Date().toISOString()}\n` +
      `[card] ${card.title} (${card.id})\n` +
      `[stage] ${columnName}\n` +
      `[skill] ${skill}\n` +
      `[sessionId] ${card.sessionId}\n` +
      `[sessionKey] ${card.sessionKey}\n\n`,
  );

  const prompt = buildStagePrompt({
    card,
    skill,
    columnName,
    firstTurn,
  });

  const proc = Bun.spawn(
    ['openclaw', 'agent', '--session-id', String(card.sessionId), '--message', prompt, '--timeout', AGENT_TIMEOUT_SECONDS],
    {
      cwd: config.projectDir,
      env: buildCardAgentEnv(card.id),
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );

  const runId = crypto.randomUUID();
  ACTIVE_RUNS.set(card.id, { runId, proc });

  void pipeStreamToLog(proc.stdout, logFile);
  void pipeStreamToLog(proc.stderr, logFile, '[stderr] ');
  attachRunExitHandler({
    cardId: card.id,
    runId,
    proc,
    logFile,
    columnName,
    sessionId: card.sessionId,
    column: card.column,
    skill,
  });
}

// ─── Auth ───────────────────────────────────────────────────────
const MC_PASSWORD = process.env.MISSION_CONTROL_PASSWORD || '';
const COOKIE_SECRET = crypto.randomBytes(32).toString('hex');
const COOKIE_NAME = 'mc_session';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds

const AUTH_TOKEN = crypto.randomUUID(); // For CLI → server communication

function signToken(payload: string): string {
  const hmac = crypto.createHmac('sha256', COOKIE_SECRET);
  hmac.update(payload);
  return `${payload}.${hmac.digest('hex')}`;
}

function verifyToken(token: string): boolean {
  const lastDot = token.lastIndexOf('.');
  if (lastDot === -1) return false;
  const payload = token.substring(0, lastDot);
  return signToken(payload) === token;
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.get('cookie') || '';
  const cookies: Record<string, string> = {};
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) cookies[k.trim()] = v.join('=');
  }
  return cookies;
}

function isAuthenticated(req: Request): boolean {
  if (!MC_PASSWORD) return true; // No password = no auth required
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  return token ? verifyToken(token) : false;
}

function isCliAuthenticated(req: Request): boolean {
  const header = req.headers.get('authorization');
  return header === `Bearer ${AUTH_TOKEN}`;
}

function setAuthCookie(): string {
  const token = signToken(Date.now().toString());
  const secure = process.env.NODE_ENV === 'production' || MC_BASE_PATH ? '; Secure' : '';
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}${secure}`;
}

// ─── SSE Log Stream ─────────────────────────────────────────────
function createLogStream(logFilePath: string): Response {
  let offset = 0;
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      // Send existing content first
      try {
        const existing = fs.readFileSync(logFilePath, 'utf-8');
        if (existing) {
          controller.enqueue(`data: ${JSON.stringify(existing)}\n\n`);
          offset = existing.length;
        }
      } catch {}

      // Poll for new content every 500ms
      const interval = setInterval(() => {
        if (closed) {
          clearInterval(interval);
          return;
        }
        try {
          const content = fs.readFileSync(logFilePath, 'utf-8');
          if (content.length > offset) {
            const newContent = content.substring(offset);
            controller.enqueue(`data: ${JSON.stringify(newContent)}\n\n`);
            offset = content.length;
          }
        } catch {}
      }, 500);

      // Clean up after 5 minutes
      setTimeout(() => {
        closed = true;
        clearInterval(interval);
        try {
          controller.close();
        } catch {}
      }, 300_000);
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

// ─── API Handler ────────────────────────────────────────────────
export async function handleApiRoute(url: URL, req: Request, config: MCConfig): Promise<Response> {
  // GET /api/state — return columns + cards
  if (url.pathname === '/api/state' && req.method === 'GET') {
    const state = loadState(config);
    let modelIndex: Map<string, ModelOption> | undefined;
    try {
      modelIndex = (await getModelOptions()).byRef;
    } catch {}
    return Response.json({
      columns: COLUMNS,
      cards: state.cards.map((card) => {
        const decorated = decorateCard(card, modelIndex);
        return { ...decorated, activity: [] };
      }),
    });
  }

  // GET /api/models — configured model options for the card modal
  if (url.pathname === '/api/models' && req.method === 'GET') {
    try {
      const modelOptions = await getModelOptions();
      return Response.json({
        defaultRef: modelOptions.defaultRef,
        options: modelOptions.options,
      });
    } catch (err: any) {
      return Response.json({ error: err.message || 'Failed to load model options' }, { status: 503 });
    }
  }

  // POST /api/cards — create card
  if (url.pathname === '/api/cards' && req.method === 'POST') {
    const body = await req.json();
    const card = createCard(config, body.title, body.description, body.tags);
    return Response.json(card, { status: 201 });
  }

  // POST /api/cards/:id/upload — upload a single image attachment
  const uploadMatch = url.pathname.match(/^\/api\/cards\/([^/]+)\/upload$/);
  if (uploadMatch && req.method === 'POST') {
    const cardId = uploadMatch[1];
    const existing = getCard(config, cardId);
    if (!existing) return Response.json({ error: 'Card not found' }, { status: 404 });

    const form = await req.formData();
    const files = Array.from(form.values()).filter((value): value is File => value instanceof File && value.size > 0);
    if (files.length !== 1) {
      return Response.json({ error: 'Exactly one file is required per upload request' }, { status: 400 });
    }

    const file = files[0];
    if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
      return Response.json({ error: 'File exceeds 10 MB limit' }, { status: 400 });
    }
    if ((existing.attachments || []).length >= MAX_ATTACHMENTS_PER_CARD) {
      return Response.json({ error: 'Attachment limit reached (20 max)' }, { status: 400 });
    }
    if (sumAttachmentBytes(existing.attachments || []) + file.size > MAX_TOTAL_ATTACHMENT_SIZE_BYTES) {
      return Response.json({ error: 'Total attachment size limit reached (50 MB max)' }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const detectedMime = detectImageMime(bytes, file.name);
    if (!detectedMime) {
      return Response.json({ error: 'Only image uploads are supported in v1 (png, jpg, gif, webp, svg)' }, { status: 400 });
    }

    const attachmentId = crypto.randomUUID();
    const safeName = sanitizeAttachmentName(file.name || 'upload');
    const storedName = `${attachmentId}-${safeName}`;
    const uploadDir = getCardUploadsDir(cardId);
    const diskPath = path.join(uploadDir, storedName);

    try {
      fs.mkdirSync(uploadDir, { recursive: true });
      await Bun.write(diskPath, bytes);
    } catch (err: any) {
      const status = err?.code === 'ENOSPC' ? 507 : 500;
      return Response.json({ error: err?.code === 'ENOSPC' ? 'Disk is full — unable to store upload' : `Failed to store upload: ${err.message}` }, { status });
    }

    const attachment: CardAttachment = {
      id: attachmentId,
      originalName: file.name || safeName,
      storedName,
      mimeType: detectedMime,
      sizeBytes: file.size,
      uploadedAt: new Date().toISOString(),
      lastUsedAt: null,
    };

    const card = updateCard(config, cardId, {
      attachments: [...(existing.attachments || []), attachment],
    });

    return Response.json({ card, attachment }, { status: 201 });
  }

  // GET /api/cards/:id/attachments/:attachmentId — serve an uploaded attachment
  const attachmentGetMatch = url.pathname.match(/^\/api\/cards\/([^/]+)\/attachments\/([^/]+)$/);
  if (attachmentGetMatch && req.method === 'GET') {
    const cardId = attachmentGetMatch[1];
    const attachmentId = attachmentGetMatch[2];
    const card = getCard(config, cardId);
    if (!card) return Response.json({ error: 'Card not found' }, { status: 404 });
    const attachment = findAttachment(card, attachmentId);
    if (!attachment) return Response.json({ error: 'Attachment not found' }, { status: 404 });
    const diskPath = getAttachmentDiskPath(cardId, attachment);
    try {
      const file = Bun.file(diskPath);
      if (!(await file.exists())) {
        return Response.json({ error: 'Attachment file not found' }, { status: 404 });
      }
      return new Response(file, {
        headers: {
          'Content-Type': attachment.mimeType,
          'Cache-Control': 'private, max-age=60',
        },
      });
    } catch {
      return Response.json({ error: 'Attachment file not found' }, { status: 404 });
    }
  }

  // DELETE /api/cards/:id/attachments/:attachmentId — remove a single attachment
  const attachmentDeleteMatch = url.pathname.match(/^\/api\/cards\/([^/]+)\/attachments\/([^/]+)$/);
  if (attachmentDeleteMatch && req.method === 'DELETE') {
    const cardId = attachmentDeleteMatch[1];
    const attachmentId = attachmentDeleteMatch[2];
    const card = getCard(config, cardId);
    if (!card) return Response.json({ error: 'Card not found' }, { status: 404 });
    const attachment = findAttachment(card, attachmentId);
    if (!attachment) return Response.json({ error: 'Attachment not found' }, { status: 404 });

    try {
      fs.rmSync(getAttachmentDiskPath(cardId, attachment), { force: true });
    } catch {}

    const nextAttachments = (card.attachments || []).filter((entry) => entry.id !== attachmentId);
    const updatedCard = updateCard(config, cardId, { attachments: nextAttachments });
    return Response.json({ card: updatedCard, deletedId: attachmentId });
  }

  // POST /api/cards/:id/move — move card to column
  const moveMatch = url.pathname.match(/^\/api\/cards\/([^/]+)\/move$/);
  if (moveMatch && req.method === 'POST') {
    const cardId = moveMatch[1];
    const body = await req.json();
    try {
      const currentCard = getCard(config, cardId);
      if (!currentCard) {
        return Response.json({ error: 'Card not found' }, { status: 404 });
      }
      if (!COLUMNS.some((column) => column.id === body.column)) {
        return Response.json({ error: `Unknown column: ${body.column}` }, { status: 404 });
      }
      if (currentCard.column === body.column) {
        return Response.json({ card: currentCard, skill: null, changed: false });
      }

      cancelActiveRun(cardId, `card moved to ${getColumnName(body.column)}`);
      const result = moveCard(config, cardId, body.column);
      if (result.changed && result.skill) {
        startCardSessionRun({
          config,
          card: result.card,
          skill: result.skill,
        }).catch((err: any) => {
          console.error(`[missioncontrol] Card session run failed: ${err.message}`);
          setCardStatus(config, cardId, 'failed', {
            column: body.column,
            skill: result.skill || undefined,
          });
          addActivity(config, cardId, 'run_failed', `Failed to start durable session: ${err.message}`, {
            column: body.column,
            skill: result.skill || undefined,
          });
        });
      }
      return Response.json(result);
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 404 });
    }
  }

  // PATCH /api/cards/:id — update card
  const patchMatch = url.pathname.match(/^\/api\/cards\/([^/]+)$/);
  if (patchMatch && req.method === 'PATCH') {
    const cardId = patchMatch[1];
    const body = await req.json();
    try {
      const existing = getCard(config, cardId);
      if (!existing) {
        return Response.json({ error: 'Card not found' }, { status: 404 });
      }

      const updates: Partial<
        Pick<Card, 'title' | 'description' | 'tags' | 'modelRef' | 'attentionMode' | 'attentionReason' | 'attentionUpdatedAt'>
      > = {};
      let requestedStatus: Card['status'] | null = null;
      if ('title' in body) updates.title = typeof body.title === 'string' ? body.title : existing.title;
      if ('description' in body) {
        updates.description = typeof body.description === 'string' ? body.description : existing.description;
      }
      if ('tags' in body) {
        updates.tags = Array.isArray(body.tags)
          ? body.tags.map((tag: unknown) => String(tag).trim()).filter(Boolean)
          : existing.tags;
      }
      if ('modelRef' in body) {
        const rawModel = body.modelRef == null ? '' : String(body.modelRef).trim();
        if (!rawModel || rawModel.toLowerCase() === 'default') {
          updates.modelRef = null;
        } else {
          const cfg = loadConfig();
          const catalog = await loadGatewayModelCatalog();
          const configured = resolveDefaultModelForAgent({ cfg, agentId: OPENCLAW_AGENT_ID });
          const resolved = resolveAllowedModelRef({
            cfg,
            catalog,
            raw: rawModel,
            defaultProvider: configured.provider,
            defaultModel: configured.model,
          });
          if (!('ref' in resolved)) {
            return Response.json({ error: resolved.error }, { status: 400 });
          }
          const canonicalRef = `${resolved.ref.provider}/${resolved.ref.model}`;
          updates.modelRef = canonicalRef === `${configured.provider}/${configured.model}` ? null : canonicalRef;
        }
      }
      if ('status' in body) {
        if (!isCardStatus(body.status)) {
          return Response.json({ error: 'Invalid status' }, { status: 400 });
        }
        requestedStatus = body.status;
      }
      if (('attentionMode' in body || 'attentionReason' in body) && existing.status !== 'awaiting_human') {
        const nextMode: AttentionMode =
          body.attentionMode === 'waiting_on_patrick'
            ? 'waiting_on_patrick'
            : 'attentionMode' in body
              ? 'none'
              : existing.attentionMode;
        const requestedReason =
          'attentionReason' in body
            ? body.attentionReason == null
              ? ''
              : String(body.attentionReason).trim()
            : existing.attentionReason || '';
        updates.attentionMode = nextMode;
        updates.attentionReason = nextMode === 'waiting_on_patrick' && requestedReason ? requestedReason : null;
        updates.attentionUpdatedAt = new Date().toISOString();
      }

      let card = updateCard(config, cardId, updates);
      if ('modelRef' in updates) {
        await applyCardModelToSession(card);
      }
      if (requestedStatus && requestedStatus !== existing.status) {
        card = setCardStatus(config, cardId, requestedStatus, {
          column: card.column,
          skill: card.skillTriggered || undefined,
        });
      }

      let modelIndex: Map<string, ModelOption> | undefined;
      try {
        modelIndex = (await getModelOptions()).byRef;
      } catch {}
      return Response.json(decorateCard(card, modelIndex));
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 400 });
    }
  }

  // POST /api/cards/:id/read — mark the card as read/viewed
  const readMatch = url.pathname.match(/^\/api\/cards\/([^/]+)\/read$/);
  if (readMatch && req.method === 'POST') {
    const cardId = readMatch[1];
    try {
      const existing = getCard(config, cardId);
      if (!existing) {
        return Response.json({ error: 'Card not found' }, { status: 404 });
      }
      const card = updateCard(config, cardId, { lastViewedAt: new Date().toISOString() });
      let modelIndex: Map<string, ModelOption> | undefined;
      try {
        modelIndex = (await getModelOptions()).byRef;
      } catch {}
      return Response.json(decorateCard(card, modelIndex));
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 400 });
    }
  }

  // POST /api/cards/:id/question — mark a card as waiting on human input
  const questionMatch = url.pathname.match(/^\/api\/cards\/([^/]+)\/question$/);
  if (questionMatch && req.method === 'POST') {
    const cardId = questionMatch[1];
    const body = await req.json();
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) return Response.json({ error: 'text required' }, { status: 400 });

    const card = getCard(config, cardId);
    if (!card) return Response.json({ error: 'Card not found' }, { status: 404 });
    if (!card.sessionId) return Response.json({ error: 'Card has no bound session' }, { status: 400 });

    const now = new Date().toISOString();
    updateCard(config, cardId, {
      attentionMode: 'waiting_on_patrick',
      attentionReason: text,
      attentionUpdatedAt: now,
    });
    setCardStatus(config, cardId, 'awaiting_human', {
      column: card.column,
      skill: card.skillTriggered || undefined,
    });
    addActivity(config, cardId, 'agent_question', text, {
      actor: 'agent' as ActivityActor,
      column: card.column,
      skill: card.skillTriggered || undefined,
    });
    if (card.logFile) {
      appendLog(card.logFile, `\n[missioncontrol] Agent requested human input: ${text}\n`);
    }
    return Response.json({ ok: true, status: 'awaiting_human' });
  }

  // POST /api/cards/:id/reply — resume a card run from the human's reply
  const replyMatch = url.pathname.match(/^\/api\/cards\/([^/]+)\/reply$/);
  if (replyMatch && req.method === 'POST') {
    const cardId = replyMatch[1];
    const body = await req.json();
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) return Response.json({ error: 'text required' }, { status: 400 });

    const currentCard = getCard(config, cardId);
    if (!currentCard) return Response.json({ error: 'Card not found' }, { status: 404 });
    if (!currentCard.sessionId) return Response.json({ error: 'Card has no bound session' }, { status: 400 });
    if (currentCard.status !== 'awaiting_human') {
      return Response.json({ error: 'Card is not awaiting human input' }, { status: 400 });
    }

    await applyCardModelToSession(currentCard);
    cancelActiveRun(cardId, 'human replied');

    const logFile =
      currentCard.logFile ||
      path.join(config.logsDir, `${currentCard.id}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
    let resumedCard = updateCard(config, cardId, {
      logFile,
      attentionMode: 'none',
      attentionReason: null,
      attentionUpdatedAt: new Date().toISOString(),
    });
    resumedCard = setCardStatus(config, cardId, 'running', {
      column: resumedCard.column,
      skill: resumedCard.skillTriggered || undefined,
    });

    addActivity(config, cardId, 'human_reply', text, {
      actor: 'human' as ActivityActor,
      column: resumedCard.column,
      skill: resumedCard.skillTriggered || undefined,
    });

    const columnName = getColumnName(resumedCard.column);
    addActivity(
      config,
      cardId,
      'run_started',
      `Resumed ${columnName} after human reply in durable OpenClaw session ${shortId(resumedCard.sessionId)}`,
      { column: resumedCard.column, skill: resumedCard.skillTriggered || undefined, sessionId: resumedCard.sessionId || undefined },
    );

    appendLog(
      logFile,
      `\n=== Mission Control human reply ===\n` +
        `[received] ${new Date().toISOString()}\n` +
        `[card] ${resumedCard.title} (${resumedCard.id})\n` +
        `[stage] ${columnName}\n` +
        `[sessionId] ${resumedCard.sessionId}\n` +
        `[human-reply] ${text}\n\n`,
    );

    const prompt = [
      'Mission Control durable card session update.',
      'Resume the existing Mission Control work thread for this card. Continue from prior work in this same session instead of starting over.',
      `Card title: ${resumedCard.title}`,
      `Card ID: ${resumedCard.id}`,
      `Current stage: ${columnName}`,
      resumedCard.skillTriggered ? `Requested skill/stage mode: ${resumedCard.skillTriggered}` : null,
      `Human reply to your question:\n${text}`,
      `Task: continue advancing this card in the ${columnName} stage using the human's answer above. If you need more input, ask one new clear question via the Mission Control callback URL and then stop.`,
    ]
      .filter(Boolean)
      .join('\n\n');

    const proc = Bun.spawn(
      ['openclaw', 'agent', '--session-id', String(resumedCard.sessionId), '--message', prompt, '--timeout', AGENT_TIMEOUT_SECONDS],
      {
        cwd: config.projectDir,
        env: buildCardAgentEnv(cardId),
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );

    const runId = crypto.randomUUID();
    ACTIVE_RUNS.set(cardId, { runId, proc });
    void pipeStreamToLog(proc.stdout, logFile);
    void pipeStreamToLog(proc.stderr, logFile, '[stderr] ');
    attachRunExitHandler({
      cardId,
      runId,
      proc,
      logFile,
      columnName,
      sessionId: resumedCard.sessionId,
      column: resumedCard.column,
      skill: resumedCard.skillTriggered,
    });

    return Response.json({ ok: true, status: 'running' });
  }

  // DELETE /api/cards/:id
  const deleteMatch = url.pathname.match(/^\/api\/cards\/([^/]+)$/);
  if (deleteMatch && req.method === 'DELETE') {
    const cardId = deleteMatch[1];
    try {
      cancelActiveRun(cardId, 'card deleted');
      safeRemoveCardUploadsDir(cardId);
      deleteCard(config, cardId);
      return Response.json({ ok: true });
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 404 });
    }
  }

  // GET /api/cards/:id/log — full log contents
  const logMatch = url.pathname.match(/^\/api\/cards\/([^/]+)\/log$/);
  if (logMatch && req.method === 'GET') {
    const cardId = logMatch[1];
    const card = getCard(config, cardId);
    if (!card) return Response.json({ error: 'Card not found' }, { status: 404 });
    if (!card.logFile) return new Response('', { headers: { 'Content-Type': 'text/plain' } });
    try {
      const log = fs.readFileSync(card.logFile, 'utf-8');
      return new Response(log, { headers: { 'Content-Type': 'text/plain' } });
    } catch {
      return new Response('', { headers: { 'Content-Type': 'text/plain' } });
    }
  }

  // GET /api/cards/:id/log/stream — SSE log stream
  const streamMatch = url.pathname.match(/^\/api\/cards\/([^/]+)\/log\/stream$/);
  if (streamMatch && req.method === 'GET') {
    const cardId = streamMatch[1];
    const card = getCard(config, cardId);
    if (!card || !card.logFile) {
      return new Response('data: \n\n', {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }
    return createLogStream(card.logFile);
  }

  // GET /api/cards/:id/activity — return activity trail
  const activityGetMatch = url.pathname.match(/^\/api\/cards\/([^/]+)\/activity$/);
  if (activityGetMatch && req.method === 'GET') {
    const cardId = activityGetMatch[1];
    const card = getCard(config, cardId);
    if (!card) return Response.json({ error: 'Card not found' }, { status: 404 });
    return Response.json(card.activity || []);
  }

  // POST /api/cards/:id/activity — add human comment entry
  const activityPostMatch = url.pathname.match(/^\/api\/cards\/([^/]+)\/activity$/);
  if (activityPostMatch && req.method === 'POST') {
    const cardId = activityPostMatch[1];
    const body = await req.json();
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) return Response.json({ error: 'text required' }, { status: 400 });
    if ('type' in body || 'actor' in body) {
      return Response.json({ error: 'activity type/actor cannot be set by clients' }, { status: 400 });
    }
    try {
      const card = addActivity(config, cardId, 'human_comment', text, {
        actor: 'human' as ActivityActor,
      });
      return Response.json(card.activity);
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 404 });
    }
  }

  return new Response('Not found', { status: 404 });
}

// ─── Port Finding ───────────────────────────────────────────────
async function findPort(): Promise<number> {
  const MC_PORT = parseInt(process.env.MC_PORT || '0', 10);
  if (MC_PORT) {
    try {
      const testServer = Bun.serve({ port: MC_PORT, fetch: () => new Response('ok') });
      testServer.stop();
      return MC_PORT;
    } catch {
      throw new Error(`Port ${MC_PORT} is in use`);
    }
  }

  const MIN_PORT = 10000;
  const MAX_PORT = 60000;
  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const port = MIN_PORT + Math.floor(Math.random() * (MAX_PORT - MIN_PORT));
    try {
      const testServer = Bun.serve({ port, fetch: () => new Response('ok') });
      testServer.stop();
      return port;
    } catch {
      continue;
    }
  }
  throw new Error(`No available port after ${MAX_RETRIES} attempts in range ${MIN_PORT}-${MAX_PORT}`);
}

// ─── Shutdown ───────────────────────────────────────────────────
let isShuttingDown = false;

async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('[missioncontrol] Shutting down...');
  for (const [cardId] of ACTIVE_RUNS) {
    cancelActiveRun(cardId, 'server shutdown');
  }
  try {
    fs.unlinkSync(config.serverStateFile);
  } catch {}
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ─── Start ──────────────────────────────────────────────────────
async function start() {
  const port = await findPort();
  SERVER_PORT = port;
  const startTime = Date.now();

  const server = Bun.serve({
    port,
    hostname: '0.0.0.0', // Allow non-localhost access (for Northflank)
    fetch: async (req) => {
      try {
        const url = new URL(req.url);
        const routedPath = stripBasePath(url.pathname, MC_BASE_PATH);

        // Health check — no auth
        if (routedPath === '/health') {
          return Response.json({
            status: 'healthy',
            uptime: Math.floor((Date.now() - startTime) / 1000),
          });
        }

        // Public server info — no auth, no secrets
        if (routedPath === '/api/info') {
          const state = loadState(config);
          const version = readVersionHash() || process.env.NORTHFLANK_GIT_COMMIT_SHA || 'dev';
          return Response.json({
            version: version.substring(0, 7),
            uptime: Math.floor((Date.now() - startTime) / 1000),
            runtime: `Bun ${Bun.version}`,
            cards: state.cards.length,
            executionMode: 'durable-openclaw-session',
            authRequired: !!MC_PASSWORD,
          });
        }

        // Login — no auth required
        if (routedPath === '/auth/login' && req.method === 'POST') {
          let body: any;
          try {
            body = await req.json();
          } catch {
            return Response.json({ error: 'Invalid request body' }, { status: 400 });
          }
          if (!MC_PASSWORD || body.password === MC_PASSWORD) {
            return new Response(JSON.stringify({ ok: true }), {
              headers: {
                'Content-Type': 'application/json',
                'Set-Cookie': setAuthCookie(),
              },
            });
          }
          return Response.json({ error: 'Invalid password' }, { status: 401 });
        }

        // Auth check — no auth required
        if (routedPath === '/auth/check') {
          return Response.json({ authenticated: isAuthenticated(req) });
        }

        // Board HTML — always served (JS handles login state)
        if (routedPath === '/' && req.method === 'GET') {
          return new Response(generateBoardHTML(MC_BASE_PATH), {
            headers: { 'Content-Type': 'text/html' },
          });
        }

        // All /api/* routes require auth (cookie or bearer)
        if (routedPath.startsWith('/api/')) {
          if (!isAuthenticated(req) && !isCliAuthenticated(req)) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
          }
          const routedUrl = new URL(req.url);
          routedUrl.pathname = routedPath;
          return handleApiRoute(routedUrl, req, config);
        }

        return new Response('Not found', { status: 404 });
      } catch (err: any) {
        console.error(`[missioncontrol] Unhandled error: ${err.message}`);
        return Response.json({ error: 'Internal server error' }, { status: 500 });
      }
    },
  });

  void server;

  // Write server state file (atomic: write .tmp then rename)
  const state = {
    pid: process.pid,
    port,
    token: AUTH_TOKEN,
    startedAt: new Date().toISOString(),
    serverPath: path.resolve(import.meta.dir, 'server.ts'),
    binaryVersion: readVersionHash() || undefined,
  };
  const tmpFile = config.serverStateFile + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmpFile, config.serverStateFile);

  console.log(`[missioncontrol] Server running on http://0.0.0.0:${port} (PID: ${process.pid})`);
  console.log(`[missioncontrol] State file: ${config.serverStateFile}`);
  console.log(`[missioncontrol] Board file: ${config.boardStateFile}`);
  console.log(`[missioncontrol] OpenClaw session store: ${OPENCLAW_SESSION_STORE}`);
  if (MC_PASSWORD) {
    console.log(`[missioncontrol] Password auth enabled`);
  } else {
    console.log(`[missioncontrol] No password set — open access`);
  }
}

start().catch((err) => {
  console.error(`[missioncontrol] Failed to start: ${err.message}`);
  process.exit(1);
});
