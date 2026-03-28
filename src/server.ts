/**
 * gstack botlanes server — persistent Kanban board daemon
 *
 * Architecture:
 *   Bun.serve HTTP on 0.0.0.0 → serves board UI and REST API
 *   Auth: HMAC-signed HttpOnly cookie (browser) + Bearer token (CLI)
 *   No idle timeout — board stays alive
 *
 * State:
 *   Server state: <project-root>/.gstack/botlanes-server.json
 *   Board state:  <project-root>/.gstack/botlanes.db (SQLite)
 *   Log files:    <project-root>/.gstack/botlanes-logs/
 *   Port:         random 10000-60000 (or BOTLANES_PORT env for debug override)
 */

import { resolveConfig, ensureStateDir, readVersionHash, type MCConfig } from './config';
import {
  loadState,
  createCard,
  moveCard,
  updateCard,
  deleteCard,
  getCard,
  addPlan,
  addActivity,
  setCardStatus,
  isCardStatus,
  recoverStaleCards,
  cleanOldLogs,
  getAllUnreadCommentCounts,
  getUnreadCommentCount as getUnreadCountFromDb,
  COLUMNS,
  type ActivityActor,
  type AttentionMode,
  type Card,
  type CardAttachment,
} from './state';
import { generateBoardHTML } from './ui';
import { stripBasePath } from './base-path';
import fs from 'node:fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as process from 'process';
import * as os from 'os';

// ─── Config ─────────────────────────────────────────────────────
const config = resolveConfig();
ensureStateDir(config);

// ─── Base Path (for reverse proxy deployments) ──────────────────
const BOTLANES_BASE_PATH = (process.env.BOTLANES_BASE_PATH || '').replace(/\/+$/, '');

// ─── Claude CLI Integration ─────────────────────────────────────
// For skill lookup, always resolve to a concrete path
const CLAUDE_CONFIG_DIR = process.env.BOTLANES_CLAUDE_CONFIG_DIR
  || process.env.CLAUDE_CONFIG_DIR
  || path.join(os.homedir(), '.claude');
// Only override in child env when explicitly configured; otherwise let
// the Claude CLI use its own auth resolution (which may differ from ~/.claude)
const CLAUDE_ENV_OVERRIDE: Record<string, string> =
  (process.env.BOTLANES_CLAUDE_CONFIG_DIR || process.env.CLAUDE_CONFIG_DIR)
    ? { CLAUDE_CONFIG_DIR }
    : {};
const CLAUDE_BIN = process.env.BOTLANES_CLAUDE_BIN || 'claude';
const GEMINI_BIN = process.env.BOTLANES_GEMINI_BIN || 'gemini';
const AGENT_TIMEOUT_MS = (parseInt(process.env.BOTLANES_AGENT_TIMEOUT_SECONDS || '1800', 10) || 1800) * 1000;

// ─── Skill Token Counts ──────────────────────────────────────────
// Approximate token count from file byte size (chars / 4).
function computeSkillTokenCount(skillSlug: string): number | null {
  const searchDirs = [
    path.join(CLAUDE_CONFIG_DIR, 'skills', 'gstack'),
    path.join(os.homedir(), '.gemini', 'skills', 'gstack'),
  ];
  for (const base of searchDirs) {
    const skillMd = path.join(base, skillSlug, 'SKILL.md');
    try {
      const stat = fs.statSync(skillMd);
      return Math.round(stat.size / 4);
    } catch {
      // not found in this location, try next
    }
  }
  return null;
}

// Pre-compute at startup: skill slug → token count
const SKILL_TOKEN_COUNTS = new Map<string, number | null>();
for (const col of COLUMNS) {
  if (col.skill && col.skill.startsWith('/')) {
    const slug = col.skill.slice(1);
    SKILL_TOKEN_COUNTS.set(col.skill, computeSkillTokenCount(slug));
  }
}

type ActiveRun = {
  runId: string;
  proc: Bun.Subprocess;
};

const ACTIVE_RUNS = new Map<string, ActiveRun>();
let SERVER_PORT = 0;

// ─── Real-time Events ──────────────────────────────────────────
const EVENT_CLIENTS = new Set<ReadableStreamDefaultController<string>>();

function broadcast(event: string, data?: any) {
  const payload = JSON.stringify({ event, data });
  const message = `data: ${payload}\n\n`;
  for (const controller of EVENT_CLIENTS) {
    try {
      controller.enqueue(message);
    } catch {
      EVENT_CLIENTS.delete(controller);
    }
  }
}

function createEventStream(): Response {
  const stream = new ReadableStream({
    start(controller) {
      EVENT_CLIENTS.add(controller);
      // Heartbeat every 15s to keep connection alive
      const interval = setInterval(() => {
        try {
          controller.enqueue(': heartbeat\n\n');
        } catch {
          clearInterval(interval);
          EVENT_CLIENTS.delete(controller);
        }
      }, 15000);
    },
    cancel(controller) {
      EVENT_CLIENTS.delete(controller as any);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

type AttentionLevel = 'none' | 'output' | 'comment' | 'human';

type CardAttentionDerived = {
  logUpdatedAt: string | null;
  hasUnreadOutput: boolean;
  unreadCommentCount: number;
  attentionLevel: AttentionLevel;
};

type CardView = Card & {
  derived: CardAttentionDerived;
};

const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_CARD = 20;
const MAX_TOTAL_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024;

function getCardUploadsDir(cardId: string): string {
  return path.join(config.uploadsDir, cardId);
}

function getAttachmentDiskPath(cardId: string, attachment: Pick<CardAttachment, 'storedName'>): string {
  return path.join(getCardUploadsDir(cardId), attachment.storedName);
}

/**
 * Get the path to an attachment that is safe for an agent to read.
 * Uses symlinked directories to bypass CLI dot-directory ignore patterns.
 */
function getAttachmentAgentPath(cardId: string, attachment: Pick<CardAttachment, 'storedName'>): string {
  return path.join(config.uploadsSymlinkDir, cardId, attachment.storedName);
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

export function detectMime(bytes: Uint8Array, originalName: string = ''): string {
  // PNG
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return 'image/png';
  }
  // JPEG
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  // GIF
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return 'image/gif';
  }
  // WebP
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp';
  }
  // PDF
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return 'application/pdf';
  }
  // MP3 (ID3 tag)
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return 'audio/mpeg';
  }
  // MP3 (frame sync)
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return 'audio/mpeg';
  }
  // WAV
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45) {
    return 'audio/wav';
  }
  // MP4/M4A/MOV (ftyp box at offset 4)
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return 'video/mp4';
  }
  // WebM
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return 'video/webm';
  }

  const sample = Buffer.from(bytes.slice(0, 2048)).toString('utf-8').trimStart();
  const sampleLower = sample.toLowerCase();
  // SVG
  if (sampleLower.startsWith('<svg') || sampleLower.startsWith('<?xml') || sampleLower.includes('<svg')) {
    const ext = path.extname(originalName).toLowerCase();
    if (!ext || ext === '.svg') return 'image/svg+xml';
  }

  // Extension fallback for common text/document types
  const ext = path.extname(originalName).toLowerCase();
  const extMimeMap: Record<string, string> = {
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.log': 'text/plain',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.xml': 'application/xml',
    '.yaml': 'text/yaml',
    '.yml': 'text/yaml',
    '.py': 'text/x-python',
    '.js': 'text/javascript',
    '.ts': 'text/typescript',
    '.sh': 'text/x-sh',
  };
  if (ext && extMimeMap[ext]) return extMimeMap[ext];

  return 'application/octet-stream';
}

/** @deprecated Use detectMime instead */
export function detectImageMime(bytes: Uint8Array, originalName: string = ''): string | null {
  const mime = detectMime(bytes, originalName);
  return mime.startsWith('image/') ? mime : null;
}

function safeRemoveCardUploadsDir(cardId: string): void {
  const resolvedRoot = path.resolve(config.uploadsDir);
  const targetDir = path.resolve(getCardUploadsDir(cardId));
  if (!targetDir.startsWith(resolvedRoot + path.sep) && targetDir !== resolvedRoot) {
    throw new Error('Refusing to remove uploads outside botlanes-uploads root');
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

function normalizeCardForResponse(card: Card): CardView {
  return decorateCard(card);
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
  if (card.activity && card.activity.length > 0) {
    return (card.activity || []).filter((entry) => {
      if (entry.actor === 'system') return false;
      if (!card.lastViewedAt) return true;
      return entry.timestamp > card.lastViewedAt;
    }).length;
  }
  return getUnreadCountFromDb(config, card.id);
}

function decorateCard(card: Card, unreadCount?: number): CardView {
  const logUpdatedAt = getLogUpdatedAt(card);
  const hasUnreadOutput = !!logUpdatedAt && (!card.lastViewedAt || logUpdatedAt > card.lastViewedAt);
  const unreadCommentCount = unreadCount ?? getUnreadCommentCount(card);
  const attentionLevel: AttentionLevel =
    card.attentionMode === 'waiting_on_human'
      ? 'human'
      : unreadCommentCount > 0
        ? 'comment'
        : hasUnreadOutput
          ? 'output'
          : 'none';

  return {
    ...card,
    derived: {
      logUpdatedAt,
      hasUnreadOutput,
      unreadCommentCount,
      attentionLevel,
    },
  };
}

function getColumnName(columnId: string): string {
  return COLUMNS.find((column) => column.id === columnId)?.name || columnId;
}

function buildCardApiUrl(cardId: string): string {
  return `http://127.0.0.1:${SERVER_PORT}/api/cards/${cardId}`;
}

function buildCardAgentEnv(cardId: string): Record<string, string | undefined> {
  return {
    ...process.env,
    BOTLANES_CARD_API_URL: buildCardApiUrl(cardId),
    BOTLANES_AUTH_TOKEN: AUTH_TOKEN,
  };
}

export const MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export function appendLog(logFile: string, text: string): void {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    
    try {
      if (fs.existsSync(logFile)) {
        const stats = fs.statSync(logFile);
        if (stats.size > MAX_LOG_SIZE_BYTES) {
          return; // Already truncated
        }
        if (stats.size + text.length > MAX_LOG_SIZE_BYTES) {
          fs.appendFileSync(logFile, '\n[botlanes] Log size limit reached. Further output suppressed.\n', { encoding: 'utf-8', mode: 0o600 });
          return;
        }
      }
    } catch (err: any) {
      // Ignore stat errors (e.g. race with deletion)
    }

    fs.appendFileSync(logFile, text, { encoding: 'utf-8', mode: 0o600 });
  } catch (err: any) {
    console.error(`[botlanes] Failed to append to log ${logFile}: ${err.message}`);
  }
}

async function pipeStreamToLog(
  stream: ReadableStream<Uint8Array> | null | undefined | number,
  logFile: string,
  prefix = '',
): Promise<void> {
  if (!stream || typeof stream === 'number') return;
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
    appendLog(logFile, `\n[botlanes] log stream error: ${err.message}\n`);
  }
}

export function buildStagePrompt(params: {
  card: Card;
  skill: string;
  columnName: string;
  priorLogFile: string | null;
  isGemini: boolean;
  humanMessage?: string;
  isReply?: boolean;
}): string {
  const { card, skill, columnName, priorLogFile, isGemini, humanMessage, isReply } = params;
  const lines = [
    `botlanes stage run.`,
    `You are the ${isGemini ? 'Gemini' : 'Claude'} agent executing work for this card. This is a fresh invocation for this stage.`,
    `Card title: ${card.title}`,
    `Card ID: ${card.id}`,
    `Current stage: ${columnName}`,
    `Requested skill/stage mode: ${skill}`,
  ];

  if (humanMessage) {
    if (isReply) {
      lines.push(`Human reply to your previous question:\n${humanMessage}`);
    } else {
      lines.push(`Human message (comment to the timeline):\n${humanMessage}`);
    }
  }

  if (card.description?.trim()) {
    lines.push(`Card description:\n${card.description.trim()}`);
  }

  if (priorLogFile) {
    // Convert .gstack/botlanes-logs/ to botlanes-logs/ for agent access
    const agentPriorLogFile = priorLogFile.replace(config.logsDir, config.logsSymlinkDir);
    lines.push(
      `Prior stage output is saved in this file: ${agentPriorLogFile}\nRead it to understand what was done in previous stages before taking action.`,
    );
  }

  if ((card.attachments || []).length > 0) {
    const attachmentLines = (card.attachments || []).map((attachment) => {
      const attachmentPath = getAttachmentAgentPath(card.id, attachment);
      return `[media attached: ${attachmentPath} (${attachment.mimeType})]`;
    });
    lines.push(
      `Card attachments (read images directly; treat other files as context at the paths below):\n${attachmentLines.join(
        '\n',
      )}`,
    );
  }

  if ((card.tags || []).length > 0) {
    lines.push(`Tags: ${(card.tags || []).join(', ')}`);
  }

  lines.push(
    `If you need human input to proceed, ask exactly one clear question by POSTing to the botlanes callback URL in this environment:`,
    `curl -sS -X POST "$BOTLANES_CARD_API_URL/question" \\\n  -H "Authorization: Bearer $BOTLANES_AUTH_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  --data '{"text":"<your question here>"}'`,
    `After posting the question, stop and wait. Do not guess, do not continue with placeholder assumptions. When the human replies in the card UI their response will be sent to you as a new invocation.`,
  );

  if (card.column === 'implementation') {
    lines.push(
      `Task: implement the code now. Read the prior engineering plan from the log file above if it exists, then begin writing code immediately. Do not re-plan, do not summarize what you are about to do — start coding. Only ask a question if you hit a genuine blocker with no reasonable way to proceed.`,
    );
  } else {
    lines.push(`Task: advance this card in the ${columnName} stage.`);
  }

  return lines.join('\n\n');
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
    appendLog(card.logFile, `\n[botlanes] Cancelled active run${reason ? `: ${reason}` : ''}\n`);
  }
  if (card) {
    addActivity(config, cardId, 'run_cancelled', reason ? `Run cancelled: ${reason}` : 'Run cancelled', {
      column: card.column,
      skill: card.skillTriggered || undefined,
      reason,
    });
    broadcast('state_changed');
  }
}

function extractPlanFromLog(logFile: string): string {
  try {
    if (!fs.existsSync(logFile)) return '';
    const content = fs.readFileSync(logFile, 'utf-8');
    const lines = content.split('\n');
    const mdLines = [];
    for (const line of lines) {
      // Filter out system and stderr lines
      if (!/^\[botlanes\]|^\[stderr\]/i.test(line)) {
        mdLines.push(line);
      }
    }
    return mdLines.join('\n').trim();
  } catch {
    return '';
  }
}

function attachRunExitHandler(params: {
  cardId: string;
  runId: string;
  proc: Bun.Subprocess;
  timeoutHandle: ReturnType<typeof setTimeout>;
  logFile: string;
  columnName: string;
  column: string;
  skill: string | null;
}): void {
  const { cardId, runId, proc, timeoutHandle, logFile, columnName, column, skill } = params;

  void proc.exited
    .then(async (exitCode) => {
      clearTimeout(timeoutHandle);
      const active = ACTIVE_RUNS.get(cardId);
      if (!active || active.runId !== runId) {
        return;
      }
      ACTIVE_RUNS.delete(cardId);

      const currentCard = getCard(config, cardId);
      if (currentCard?.status === 'awaiting_human') {
        appendLog(
          logFile,
          `\n[botlanes] Process exited with code ${exitCode}; card is awaiting human input so status was preserved\n`,
        );
        broadcast('state_changed');
        return;
      }

      const status = exitCode === 0 ? 'complete' : 'failed';
      const activityType = exitCode === 0 ? 'run_completed' : 'run_failed';
      const activityText =
        exitCode === 0
          ? `${columnName} completed`
          : `${columnName} failed (exit ${exitCode})`;

      appendLog(logFile, `\n[botlanes] Process exited with code ${exitCode}\n`);

      // If successful planning stage, extract and save the plan
      if (exitCode === 0 && ['office-hours', 'autoplan', 'ceo-review', 'eng-review', 'design-review', 'design'].includes(column)) {
        const planText = extractPlanFromLog(logFile);
        if (planText) {
          addPlan(config, cardId, column, skill || '', planText);
          appendLog(logFile, `\n[botlanes] Extracted and saved stage plan\n`);
        }
      }

      setCardStatus(config, cardId, status, {
        column,
        skill: skill || undefined,
      });
      addActivity(config, cardId, activityType, activityText, {
        column,
        skill: skill || undefined,
        ...(typeof exitCode === 'number' ? { exitCode } : {}),
      });
      broadcast('state_changed');
    })
    .catch((err: any) => {
      clearTimeout(timeoutHandle);
      const active = ACTIVE_RUNS.get(cardId);
      if (!active || active.runId !== runId) {
        return;
      }
      ACTIVE_RUNS.delete(cardId);
      appendLog(logFile, `\n[botlanes] Execution error: ${err.message}\n`);
      setCardStatus(config, cardId, 'failed', {
        column,
        skill: skill || undefined,
      });
      addActivity(config, cardId, 'run_failed', `${columnName} failed: ${err.message}`, {
        column,
        skill: skill || undefined,
      });
      broadcast('state_changed');
    });
  }
async function startCardSessionRun(params: {
  config: MCConfig;
  card: Card;
  skill: string;
  humanMessage?: string;
  isReply?: boolean;
}): Promise<void> {
  const { config, skill, humanMessage, isReply } = params;
  let card = markAttachmentsUsed(params.card, new Date().toISOString());
  const columnName = getColumnName(card.column);
  const priorLogFile = card.logFile;
  const logFile = path.join(config.logsDir, `${card.id}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

  cancelActiveRun(card.id, humanMessage ? (isReply ? 'human replied' : 'human commented') : `stage moved to ${columnName}`);

  card = updateCard(config, card.id, {
    skillTriggered: skill,
    logFile,
    attentionMode: 'none',
    attentionReason: null,
    attentionUpdatedAt: new Date().toISOString(),
  });
  card = setCardStatus(config, card.id, 'running', {
    column: card.column,
    skill,
  });
  broadcast('state_changed');
  const { getProject } = await import('./state');
  const project = card.projectId ? getProject(config, card.projectId) : null;
  const isGemini = project?.aiCli === 'gemini';
  const bin = isGemini ? GEMINI_BIN : CLAUDE_BIN;
  const prompt = buildStagePrompt({ card, skill, columnName, priorLogFile, isGemini, humanMessage, isReply });
  const args = isGemini
    ? ['-p', prompt, '--output-format', 'text', '--approval-mode', 'yolo']
    : ['-p', prompt, '--output-format', 'text', '--dangerously-skip-permissions'];

  const activityText = humanMessage
    ? isReply
      ? `Resumed ${columnName} after human reply`
      : `Resumed ${columnName} after human comment`
    : `Started ${columnName} via ${isGemini ? 'Gemini' : 'Claude'}`;

  addActivity(config, card.id, 'run_started', activityText, {
    column: card.column,
    skill,
  });

  appendLog(
    logFile,
    `\n=== botlanes stage run${humanMessage ? (isReply ? ' (reply)' : ' (comment)') : ''} ===\n` +
      `[started] ${new Date().toISOString()}\n` +
      `[card] ${card.title} (${card.id})\n` +
      `[stage] ${columnName}\n` +
      (humanMessage ? `[human-message] ${humanMessage}\n` : '') +
      `[skill] ${skill}\n` +
      `[cli] ${isGemini ? 'gemini' : 'claude'}\n\n`,
  );

  let executionCwd = config.projectDir;
  if (project?.directory) {
    executionCwd = path.isAbsolute(project.directory)
      ? project.directory
      : path.resolve(config.projectDir, project.directory);
    if (!fs.existsSync(executionCwd)) {
      const errText = `Project directory not found: ${executionCwd}`;
      appendLog(logFile, `\n[botlanes] Error: ${errText}\n`);
      setCardStatus(config, card.id, 'failed', { column: card.column, skill });
      addActivity(config, card.id, 'run_failed', errText, { column: card.column, skill });
      return;
    }
  }

  let proc: Bun.Subprocess;
  try {
    proc = Bun.spawn(
      [bin, ...args],
      {
        cwd: executionCwd,
        env: { ...buildCardAgentEnv(card.id), ...(isGemini ? {} : CLAUDE_ENV_OVERRIDE) },
        stdout: 'pipe',
        stderr: 'pipe',
        stdin: 'ignore',
      },
    );
  } catch (err: any) {
    const errText = `Failed to spawn agent process (${bin}): ${err.message}`;
    appendLog(logFile, `\n[botlanes] Error: ${errText}\n`);
    setCardStatus(config, card.id, 'failed', { column: card.column, skill });
    addActivity(config, card.id, 'run_failed', errText, { column: card.column, skill });
    return;
  }

  const runId = crypto.randomUUID();
  ACTIVE_RUNS.set(card.id, { runId, proc });

  const timeoutHandle = setTimeout(() => {
    const active = ACTIVE_RUNS.get(card.id);
    if (!active || active.runId !== runId) return;
    appendLog(logFile, `\n[botlanes] Agent timed out after ${AGENT_TIMEOUT_MS / 1000}s — killing process\n`);
    cancelActiveRun(card.id, 'timeout');
  }, AGENT_TIMEOUT_MS);

  void pipeStreamToLog(proc.stdout, logFile);
  void pipeStreamToLog(proc.stderr, logFile, '[stderr] ');
  attachRunExitHandler({
    cardId: card.id,
    runId,
    proc,
    timeoutHandle,
    logFile,
    columnName,
    column: card.column,
    skill,
  });
}

// ─── Auth ───────────────────────────────────────────────────────
const BOTLANES_PASSWORD = process.env.MISSION_CONTROL_PASSWORD || '';
const COOKIE_SECRET = crypto.randomBytes(32).toString('hex');
const COOKIE_NAME = 'BOTLANES_session';
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
  if (!BOTLANES_PASSWORD) return true; // No password = no auth required
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
  const secure = process.env.NODE_ENV === 'production' || BOTLANES_BASE_PATH ? '; Secure' : '';
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
  // GET /api/events — Global SSE event stream
  if (url.pathname === '/api/events' && req.method === 'GET') {
    return createEventStream();
  }

  // GET /api/state — return columns + cards + projects
  if (url.pathname === '/api/state' && req.method === 'GET') {
    const state = loadState(config);
    const unreadCountsMap = getAllUnreadCommentCounts(config);
    return Response.json({
      columns: COLUMNS.map((col) => ({
        ...col,
        skillTokenCount: col.skill ? (SKILL_TOKEN_COUNTS.get(col.skill) ?? null) : null,
      })),
      projects: state.projects || [],
      cards: state.cards.map((card) => {
        const decorated = decorateCard(card, unreadCountsMap.get(card.id) || 0);
        return { ...decorated, activity: [] };
      }),
    });
  }

  // GET /api/project-root — return the project root directory
  if (url.pathname === '/api/project-root' && req.method === 'GET') {
    return Response.json({ root: config.projectDir });
  }

  // GET /api/home-dir — return the user's home directory
  if (url.pathname === '/api/home-dir' && req.method === 'GET') {
    return Response.json({ home: os.homedir() });
  }

  // GET /api/directories — list subdirectories of any absolute path
  if (url.pathname === '/api/directories' && req.method === 'GET') {
    const queryPath = url.searchParams.get('path') || '';
    const resolvedPath = queryPath && path.isAbsolute(queryPath)
      ? path.resolve(queryPath)
      : os.homedir();

    try {
      const entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
      const subdirectories = entries
        .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('.'))
        .map(dirent => dirent.name)
        .sort();
      return Response.json({ path: resolvedPath, dirs: subdirectories });
    } catch (err: any) {
      return Response.json({ error: `Failed to read directory: ${err.message}` }, { status: 500 });
    }
  }

  // POST /api/projects — create project
  if (url.pathname === '/api/projects' && req.method === 'POST') {
    const body = await req.json();
    if (!body.name || !body.directory) {
      return Response.json({ error: 'name and directory are required' }, { status: 400 });
    }
    const { createProject } = await import('./state');
    const project = createProject(config, body.name, body.directory, body.aiCli);
    broadcast('state_changed');
    return Response.json(project, { status: 201 });
  }

  // PATCH /api/projects/:id — update project
  const projectPatchMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectPatchMatch && req.method === 'PATCH') {
    const projectId = projectPatchMatch[1];
    const body = await req.json();
    const { updateProject } = await import('./state');
    try {
      const updates: any = {};
      if (typeof body.name === 'string') updates.name = body.name;
      if (typeof body.directory === 'string') updates.directory = body.directory;
      if (typeof body.aiCli === 'string') updates.aiCli = body.aiCli;
      const project = updateProject(config, projectId, updates);
      broadcast('state_changed');
      return Response.json(project);
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 404 });
    }
  }

  // DELETE /api/projects/:id — delete project
  const projectDeleteMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectDeleteMatch && req.method === 'DELETE') {
    const projectId = projectDeleteMatch[1];
    const { deleteProject } = await import('./state');
    try {
      deleteProject(config, projectId);
      broadcast('state_changed');
      return Response.json({ ok: true });
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 404 });
    }
  }

  // POST /api/cards — create card
  if (url.pathname === '/api/cards' && req.method === 'POST') {
    const body = await req.json();
    const projectId = typeof body.projectId === 'string' && body.projectId ? body.projectId : null;
    const card = createCard(config, body.title, projectId, body.description, body.tags);
    broadcast('state_changed');
    return Response.json(card, { status: 201 });
  }

  // POST /api/cards/:id/upload — upload a single image attachment
  const uploadMatch = url.pathname.match(/^\/api\/cards\/([^/]+)\/upload$/);
  if (uploadMatch && req.method === 'POST') {
    const cardId = uploadMatch[1];
    const existing = getCard(config, cardId);
    if (!existing) return Response.json({ error: 'Card not found' }, { status: 404 });

    const form = await req.formData();
    const files = Array.from(form.values() as any).filter((value): value is any => value instanceof Blob && (value as any).size > 0);
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
    const detectedMime = detectMime(bytes, (file as any).name);

    const attachmentId = crypto.randomUUID();
    const safeName = sanitizeAttachmentName((file as any).name || 'upload');
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
      originalName: (file as any).name || safeName,
      storedName,
      mimeType: detectedMime,
      sizeBytes: file.size,
      uploadedAt: new Date().toISOString(),
      lastUsedAt: null,
    };

    const card = updateCard(config, cardId, {
      attachments: [...(existing.attachments || []), attachment],
    });

    broadcast('state_changed');
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
      const nextAttachments = (card.attachments || []).filter((entry) => entry.id !== attachmentId);
      const updatedCard = updateCard(config, cardId, { attachments: nextAttachments });
      broadcast('state_changed');
      return Response.json({ card: updatedCard, deletedId: attachmentId });
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 404 });
    }
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
          console.error(`[botlanes] Card session run failed: ${err.message}`);
          setCardStatus(config, cardId, 'failed', {
            column: body.column,
            skill: result.skill || undefined,
          });
          addActivity(config, cardId, 'run_failed', `Failed to start agent: ${err.message}`, {
            column: body.column,
            skill: result.skill || undefined,
          });
        });
      }
      broadcast('state_changed');
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
        Pick<Card, 'projectId' | 'title' | 'description' | 'tags' | 'attentionMode' | 'attentionReason' | 'attentionUpdatedAt'>
      > = {};
      let requestedStatus: Card['status'] | null = null;
      if ('projectId' in body) updates.projectId = typeof body.projectId === 'string' && body.projectId ? body.projectId : null;
      if ('title' in body) updates.title = typeof body.title === 'string' ? body.title : existing.title;
      if ('description' in body) {
        updates.description = typeof body.description === 'string' ? body.description : existing.description;
      }
      if ('tags' in body) {
        updates.tags = Array.isArray(body.tags)
          ? body.tags.map((tag: unknown) => String(tag).trim()).filter(Boolean)
          : existing.tags;
      }
      if ('status' in body) {
        if (!isCardStatus(body.status)) {
          return Response.json({ error: 'Invalid status' }, { status: 400 });
        }
        requestedStatus = body.status;
      }
      if (('attentionMode' in body || 'attentionReason' in body) && existing.status !== 'awaiting_human') {
        const nextMode: AttentionMode =
          body.attentionMode === 'waiting_on_human'
            ? 'waiting_on_human'
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
        updates.attentionReason = nextMode === 'waiting_on_human' && requestedReason ? requestedReason : null;
        updates.attentionUpdatedAt = new Date().toISOString();
      }

      let card = updateCard(config, cardId, updates);
      if (requestedStatus && requestedStatus !== existing.status) {
        card = setCardStatus(config, cardId, requestedStatus, {
          column: card.column,
          skill: card.skillTriggered || undefined,
        });
      }

      broadcast('state_changed');
      return Response.json(decorateCard(card));
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
      broadcast('state_changed');
      return Response.json(decorateCard(card));
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

    const now = new Date().toISOString();
    updateCard(config, cardId, {
      attentionMode: 'waiting_on_human',
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
      appendLog(card.logFile, `\n[botlanes] Agent requested human input: ${text}\n`);
    }
    broadcast('state_changed');
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
    if (currentCard.status !== 'awaiting_human') {
      return Response.json({ error: 'Card is not awaiting human input' }, { status: 400 });
    }

    const skill = currentCard.skillTriggered;
    if (!skill) {
      return Response.json({ error: 'Card has no active skill to resume' }, { status: 400 });
    }

    addActivity(config, cardId, 'human_reply', text, {
      actor: 'human' as ActivityActor,
      column: currentCard.column,
      skill: currentCard.skillTriggered || undefined,
    });

    startCardSessionRun({
      config,
      card: currentCard,
      skill,
      humanMessage: text,
      isReply: true,
    }).catch((err: any) => {
      console.error(`[botlanes] Resume after reply failed: ${err.message}`);
    });

    broadcast('state_changed');
    return Response.json({ ok: true });
  }

  // POST /api/cards/:id/retry — re-trigger the current skill
  const retryMatch = url.pathname.match(/^\/api\/cards\/([^/]+)\/retry$/);
  if (retryMatch && req.method === 'POST') {
    const cardId = retryMatch[1];
    const card = getCard(config, cardId);
    if (!card) return Response.json({ error: 'Card not found' }, { status: 404 });
    if (!card.skillTriggered) return Response.json({ error: 'Card has no skill to retry' }, { status: 400 });

    cancelActiveRun(cardId, 'retry requested');
    startCardSessionRun({
      config,
      card,
      skill: card.skillTriggered,
    }).catch((err: any) => {
      console.error(`[botlanes] Card session retry failed: ${err.message}`);
      setCardStatus(config, cardId, 'failed', {
        column: card.column,
        skill: card.skillTriggered || undefined,
      });
      addActivity(config, cardId, 'run_failed', `Failed to start agent retry: ${err.message}`, {
        column: card.column,
        skill: card.skillTriggered || undefined,
      });
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
      broadcast('state_changed');
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

      // Trigger/Resume agent if the column has a skill
      const columnDef = COLUMNS.find((c) => c.id === card.column);
      if (columnDef?.skill) {
        startCardSessionRun({
          config,
          card,
          skill: card.skillTriggered || columnDef.skill,
          humanMessage: text,
          isReply: false,
        }).catch((err: any) => {
          console.error(`[botlanes] Agent trigger after comment failed: ${err.message}`);
        });
      }

      broadcast('state_changed');
      return Response.json(card.activity);
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 404 });
    }
  }

  return new Response('Not found', { status: 404 });
}

// ─── Port Finding ───────────────────────────────────────────────
async function findPort(): Promise<number> {
  const BOTLANES_PORT = parseInt(process.env.BOTLANES_PORT || '0', 10);
  if (BOTLANES_PORT) {
    try {
      const testServer = Bun.serve({ port: BOTLANES_PORT, fetch: () => new Response('ok') });
      testServer.stop();
      return BOTLANES_PORT;
    } catch {
      throw new Error(`Port ${BOTLANES_PORT} is in use`);
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
  console.log('[botlanes] Shutting down...');
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

  recoverStaleCards(config);
  cleanOldLogs(config);

  // Periodic maintenance every 24 hours
  setInterval(() => {
    try {
      cleanOldLogs(config);
    } catch (err) {
      console.error('[botlanes] Periodic maintenance failed:', err);
    }
  }, 24 * 60 * 60 * 1000);

  const server = Bun.serve({
    port,
    hostname: '0.0.0.0', // Allow non-localhost access (for Northflank)
    fetch: async (req) => {
      try {
        const url = new URL(req.url);
        const routedPath = stripBasePath(url.pathname, BOTLANES_BASE_PATH);

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
          const mem = process.memoryUsage();
          
          const projects = (state.projects || []).map(p => ({
            name: p.name,
            exists: fs.existsSync(p.directory),
          }));

          return Response.json({
            version: version.substring(0, 7),
            uptime: Math.floor((Date.now() - startTime) / 1000),
            runtime: `Bun ${Bun.version}`,
            cards: state.cards.length,
            activeRuns: ACTIVE_RUNS.size,
            binaries: {
              [CLAUDE_BIN]: CLAUDE_BIN.startsWith('/') ? fs.existsSync(CLAUDE_BIN) : !!Bun.which(CLAUDE_BIN),
              [GEMINI_BIN]: GEMINI_BIN.startsWith('/') ? fs.existsSync(GEMINI_BIN) : !!Bun.which(GEMINI_BIN),
            },
            projects,
            memory: {
              rss: Math.round(mem.rss / 1024 / 1024) + 'MB',
              heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + 'MB',
            },
            executionMode: 'agent-cli',
            authRequired: !!BOTLANES_PASSWORD,
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
          if (!BOTLANES_PASSWORD || body.password === BOTLANES_PASSWORD) {
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

        // Static assets — no auth
        if (routedPath.startsWith('/public/')) {
          const safePath = routedPath.substring(8).replace(/\.\./g, '');
          const filePath = path.join(import.meta.dir, 'public', safePath);
          const file = Bun.file(filePath);
          if (await file.exists()) {
            return new Response(file, {
              headers: {
                'Cache-Control': 'public, max-age=3600',
              },
            });
          }
          return new Response('Not found', { status: 404 });
        }

        // Board HTML — always served (JS handles login state)
        if (routedPath === '/' && req.method === 'GET') {
          return new Response(generateBoardHTML(BOTLANES_BASE_PATH), {
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
          const apiRes = await handleApiRoute(routedUrl, req, config);
          apiRes.headers.set('Cache-Control', 'no-store');
          if (req.method !== 'GET' && apiRes.ok && routedPath !== '/api/events') {
            broadcast('state_changed');
          }
          return apiRes;
        }

        return new Response('Not found', { status: 404 });
      } catch (err: any) {
        console.error(`[botlanes] Unhandled error: ${err.message}`);
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

  console.log(`[botlanes] Server running on http://0.0.0.0:${port} (PID: ${process.pid})`);
  console.log(`[botlanes] State file: ${config.serverStateFile}`);
  console.log(`[botlanes] Database: ${config.dbFile}`);
  console.log(`[botlanes] Claude config dir: ${CLAUDE_CONFIG_DIR}`);
  if (BOTLANES_PASSWORD) {
    console.log(`[botlanes] Password auth enabled`);
  } else {
    console.log(`[botlanes] No password set — open access`);
  }
}

start().catch((err) => {
  console.error(`[botlanes] Failed to start: ${err.message}`);
  process.exit(1);
});
