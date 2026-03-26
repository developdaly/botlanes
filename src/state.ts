import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { MCConfig } from './config';

// Fixed pipeline columns from AGENTS.md
export const COLUMNS = [
  { id: 'backlog', name: 'Backlog', skill: null, summary: 'New tasks waiting to be picked up.', detail: 'Raw incoming work lives here until someone moves it into the active workflow.', outcome: null, isCoreFlow: false },
  { id: 'office-hours', name: 'Office Hours', skill: '/office-hours', summary: 'Start here. Reframe the problem before anyone writes code.', detail: 'Six forcing questions challenge the framing, surface better alternatives, and generate the design doc downstream stages build on.', outcome: 'Design Doc', isCoreFlow: true },
  { id: 'autoplan', name: 'Autoplan', skill: '/autoplan', summary: 'Run the full planning sequence automatically.', detail: 'Automates office hours, CEO review, eng review, and design review in sequence — skipping stages that are not relevant and making calls autonomously. Use when you want the full planning pass without manual hand-offs.', outcome: 'Approved Plan', isCoreFlow: false },
  { id: 'ceo-review', name: 'CEO Review', skill: '/plan-ceo-review', summary: 'Pressure-test the idea and make sure the scope is worth shipping.', detail: 'Strategy review: challenge the plan, sharpen the product call, and decide whether to expand, hold, or cut scope.', outcome: 'Scope Decision', isCoreFlow: false },
  { id: 'eng-review', name: 'Eng Review', skill: '/plan-eng-review', summary: 'Lock architecture, edge cases, tests, and performance expectations.', detail: 'Engineering review validates the execution plan so implementation starts with the right shape, not guesses.', outcome: 'Engineering Plan', isCoreFlow: true },
  { id: 'design-review', name: 'Design Review', skill: '/plan-design-review', summary: 'Critique the UX direction and tighten the interaction model.', detail: 'Design review closes the gaps in hierarchy, states, responsiveness, and trust before pixels get coded.', outcome: 'Design Critique', isCoreFlow: false },
  { id: 'design', name: 'Design', skill: '/design-consultation', summary: 'Define the design system: typography, color, layout, spacing, motion.', detail: 'This stage produces the shared visual language so the implementation feels intentional instead of improvised.', outcome: 'DESIGN.md', isCoreFlow: false },
  { id: 'implementation', name: 'Implementation', skill: 'Start implementation from plan if it exists', summary: 'Write the code for the chosen plan.', detail: 'This is where the approved plan turns into working product changes in the codebase.', outcome: 'Code', isCoreFlow: true },
  { id: 'code-review', name: 'Code Review', skill: '/review', summary: 'Catch structural issues before landing.', detail: 'Pre-landing review looks for correctness, safety, and quality issues while the change is still cheap to fix.', outcome: 'Review Verdict', isCoreFlow: true },
  { id: 'debug', name: 'Debug', skill: '/investigate', summary: 'Investigate what broke and why.', detail: 'Use this when behavior is wrong, unclear, or flaky and the team needs a root-cause pass instead of more guessing.', outcome: 'Fix + Root Cause', isCoreFlow: false },
  { id: 'qa', name: 'QA', skill: '/qa', summary: 'Test the feature like a user and verify fixes.', detail: 'QA checks the real user flow, finds regressions, and confirms the implementation actually works outside the happy path.', outcome: 'QA Report', isCoreFlow: true },
  { id: 'benchmark', name: 'Benchmark', skill: '/benchmark', summary: 'Detect performance regressions before they reach production.', detail: 'Establishes baselines for page load times, Core Web Vitals, and resource sizes. Compares before/after and flags regressions.', outcome: 'Performance Report', isCoreFlow: false },
  { id: 'security', name: 'Security Audit', skill: '/cso', summary: 'Audit for vulnerabilities before shipping.', detail: 'Full security audit: OWASP Top 10, STRIDE threat modeling, attack surface mapping, dependency CVEs, and secrets scanning. Each finding is independently verified before reporting.', outcome: 'Security Report', isCoreFlow: false },
  { id: 'ship', name: 'Ship', skill: '/ship', summary: 'Merge, version, changelog, push, and open the PR.', detail: 'This is the release step: package the work cleanly so it is ready to land and move forward with confidence.', outcome: 'Merged PR', isCoreFlow: true },
  { id: 'land-and-deploy', name: 'Land & Deploy', skill: '/land-and-deploy', summary: 'Merge the PR, wait for CI, and verify production health.', detail: 'Takes over after Ship creates the PR — merges, waits for the deploy pipeline, and confirms the app is healthy in production.', outcome: 'Live Deploy', isCoreFlow: true },
  { id: 'canary', name: 'Canary', skill: '/canary', summary: 'Watch the live app for errors and regressions post-deploy.', detail: 'Post-deploy monitoring watches for console errors, performance regressions, and page failures. Compares against pre-deploy baselines and alerts on anomalies.', outcome: 'Canary Report', isCoreFlow: false },
  { id: 'visual-review', name: 'Visual Review', skill: '/design-review', summary: 'Audit the live site for visual issues and fix them.', detail: 'Designer\'s eye QA on the running app: finds spacing issues, hierarchy problems, AI slop patterns, and interaction inconsistencies — then fixes them with before/after evidence.', outcome: 'Visual Fixes', isCoreFlow: false },
  { id: 'docs', name: 'Docs', skill: '/document-release', summary: 'Update project docs to match what shipped.', detail: 'Sync README, architecture notes, and release documentation so future readers see the truth, not stale intent.', outcome: 'Updated Docs', isCoreFlow: false },
  { id: 'retro', name: 'Retro', skill: '/retro', summary: 'Capture lessons from the work and the process.', detail: 'Use retrospective time to distill what worked, what hurt, and what should change next time.', outcome: 'Retro Report', isCoreFlow: false },
  { id: 'done', name: 'Done', skill: null, summary: 'Finished work that is ready to archive visually.', detail: 'Completed cards live here so the active pipeline stays focused on work still in motion.', outcome: null, isCoreFlow: false },
] as const;

export type ColumnId = (typeof COLUMNS)[number]['id'];
export type CardStatus = 'idle' | 'pending' | 'running' | 'complete' | 'failed' | 'awaiting_human';
export type AttentionMode = 'none' | 'waiting_on_human';
export type ActivityActor = 'system' | 'agent' | 'human';
export type ActivityType =
  | 'card_created'
  | 'session_linked'
  | 'run_started'
  | 'run_completed'
  | 'run_failed'
  | 'run_cancelled'
  | 'stage_changed'
  | 'status_changed'
  | 'agent_comment'
  | 'human_comment'
  | 'agent_question'
  | 'human_reply'
  | 'unknown_event';

const VALID_CARD_STATUSES = new Set<CardStatus>([
  'idle',
  'pending',
  'running',
  'complete',
  'failed',
  'awaiting_human',
]);

const VALID_ACTIVITY_TYPES = new Set<ActivityType>([
  'card_created',
  'session_linked',
  'run_started',
  'run_completed',
  'run_failed',
  'run_cancelled',
  'stage_changed',
  'status_changed',
  'agent_comment',
  'human_comment',
  'agent_question',
  'human_reply',
  'unknown_event',
]);

const VALID_ACTIVITY_ACTORS = new Set<ActivityActor>(['system', 'agent', 'human']);

export interface ActivityEntry {
  id: string;
  type: ActivityType;
  actor: ActivityActor;
  timestamp: string;
  text: string;
  column?: string;
  skill?: string;
  fromColumn?: string;
  toColumn?: string;
  fromStatus?: string;
  toStatus?: string;
  sessionId?: string;
  sessionKey?: string;
  exitCode?: number;
  reason?: string;
}

export interface CardAttachment {
  id: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  lastUsedAt: string | null;
}

export interface Card {
  id: string;
  projectId: string | null;
  title: string;
  description: string;
  column: ColumnId;
  createdAt: string;
  movedAt: string;
  skillTriggered: string | null;
  status: CardStatus;
  logFile: string | null;
  designDocs: string[];
  tags: string[];
  attachments: CardAttachment[];
  lastViewedAt: string | null;
  attentionMode: AttentionMode;
  attentionReason: string | null;
  attentionUpdatedAt: string | null;
  activity: ActivityEntry[];
}

export interface Project {
  id: string;
  name: string;
  directory: string;
  createdAt: string;
  aiCli?: 'claude' | 'gemini';
}

export interface BoardState {
  version: 1;
  projects: Project[];
  cards: Card[];
}

const DEFAULT_STATE: BoardState = {
  version: 1,
  projects: [],
  cards: [],
};

export function isCardStatus(raw: unknown): raw is CardStatus {
  return typeof raw === 'string' && VALID_CARD_STATUSES.has(raw as CardStatus);
}

function normalizeAttentionMode(raw: unknown): AttentionMode {
  return raw === 'waiting_on_human' ? 'waiting_on_human' : 'none';
}

function defaultActorForActivityType(type: ActivityType): ActivityActor {
  switch (type) {
    case 'agent_comment':
    case 'agent_question':
      return 'agent';
    case 'human_comment':
    case 'human_reply':
      return 'human';
    default:
      return 'system';
  }
}

function columnIdFromNameOrId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  if (!value) return undefined;
  const direct = COLUMNS.find((column) => column.id === value);
  if (direct) return direct.id;
  const byName = COLUMNS.find((column) => column.name.toLowerCase() === value.toLowerCase());
  return byName?.id;
}

function legacyActivityType(raw: any): ActivityType {
  const rawType = typeof raw?.type === 'string' ? raw.type : '';
  if (VALID_ACTIVITY_TYPES.has(rawType as ActivityType)) {
    return rawType as ActivityType;
  }

  switch (rawType) {
    case 'created':
      return 'card_created';
    case 'moved':
      return 'stage_changed';
    case 'skill_start':
      return 'run_started';
    case 'skill_complete':
      return 'run_completed';
    case 'skill_failed':
      return 'run_failed';
    case 'question':
      return 'agent_question';
    case 'reply':
      return 'human_reply';
    case 'comment': {
      const text = typeof raw?.text === 'string' ? raw.text : '';
      if (/^Linked durable OpenClaw session\s+/i.test(text)) {
        return 'session_linked';
      }
      const actor = typeof raw?.actor === 'string' ? raw.actor : '';
      return actor === 'agent' ? 'agent_comment' : 'human_comment';
    }
    default:
      return 'unknown_event';
  }
}

function normalizeActivityActor(raw: unknown, type: ActivityType): ActivityActor {
  if (typeof raw === 'string' && VALID_ACTIVITY_ACTORS.has(raw as ActivityActor)) {
    return raw as ActivityActor;
  }
  return defaultActorForActivityType(type);
}

function normalizeStatusValue(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

function normalizeActivityEntry(raw: any): ActivityEntry {
  const type = legacyActivityType(raw);
  const text = typeof raw?.text === 'string' ? raw.text : '';
  const column = typeof raw?.column === 'string' && raw.column ? raw.column : undefined;

  let fromColumn = columnIdFromNameOrId(raw?.fromColumn);
  let toColumn = columnIdFromNameOrId(raw?.toColumn) || columnIdFromNameOrId(column);
  if (type === 'stage_changed' && (!fromColumn || !toColumn)) {
    const match = text.match(/^Moved from\s+(.+?)\s+to\s+(.+)$/i);
    if (match) {
      fromColumn = fromColumn || columnIdFromNameOrId(match[1]);
      toColumn = toColumn || columnIdFromNameOrId(match[2]);
    }
  }

  let sessionId = typeof raw?.sessionId === 'string' && raw.sessionId ? raw.sessionId : undefined;
  let sessionKey = typeof raw?.sessionKey === 'string' && raw.sessionKey ? raw.sessionKey : undefined;
  if (type === 'session_linked' && !sessionId) {
    const match = text.match(/session\s+([a-f0-9]{8})/i);
    if (match) sessionId = match[1];
  }

  let exitCode = typeof raw?.exitCode === 'number' && Number.isFinite(raw.exitCode) ? raw.exitCode : undefined;
  if ((type === 'run_failed' || type === 'unknown_event') && exitCode == null) {
    const match = text.match(/\(exit\s+(-?\d+)\)/i);
    if (match) exitCode = Number(match[1]);
  }

  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    type,
    actor: normalizeActivityActor(raw?.actor, type),
    timestamp: typeof raw?.timestamp === 'string' && raw.timestamp ? raw.timestamp : new Date().toISOString(),
    text,
    ...(column ? { column } : {}),
    ...(typeof raw?.skill === 'string' && raw.skill ? { skill: String(raw.skill) } : {}),
    ...(fromColumn ? { fromColumn } : {}),
    ...(toColumn ? { toColumn } : {}),
    ...(normalizeStatusValue(raw?.fromStatus) ? { fromStatus: normalizeStatusValue(raw?.fromStatus)! } : {}),
    ...(normalizeStatusValue(raw?.toStatus) ? { toStatus: normalizeStatusValue(raw?.toStatus)! } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(sessionKey ? { sessionKey } : {}),
    ...(typeof exitCode === 'number' && Number.isFinite(exitCode) ? { exitCode } : {}),
    ...(typeof raw?.reason === 'string' && raw.reason ? { reason: raw.reason } : {}),
  } as ActivityEntry;
}

function normalizeAttachment(raw: any): CardAttachment | null {
  if (!raw || typeof raw !== 'object') return null;
  const originalName = typeof raw.originalName === 'string' && raw.originalName.trim() ? raw.originalName.trim() : null;
  const storedName = typeof raw.storedName === 'string' && raw.storedName.trim() ? raw.storedName.trim() : null;
  const mimeType = typeof raw.mimeType === 'string' && raw.mimeType.trim() ? raw.mimeType.trim() : null;
  const sizeBytes = typeof raw.sizeBytes === 'number' && Number.isFinite(raw.sizeBytes) && raw.sizeBytes >= 0
    ? raw.sizeBytes
    : null;
  if (!originalName || !storedName || !mimeType || sizeBytes == null) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    originalName,
    storedName,
    mimeType,
    sizeBytes,
    uploadedAt: typeof raw.uploadedAt === 'string' && raw.uploadedAt ? raw.uploadedAt : new Date().toISOString(),
    lastUsedAt: typeof raw.lastUsedAt === 'string' && raw.lastUsedAt ? raw.lastUsedAt : null,
  };
}

function normalizeProject(raw: any): Project | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : null;
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : null;
  const directory = typeof raw.directory === 'string' && raw.directory.trim() ? raw.directory.trim() : null;
  const createdAt = typeof raw.createdAt === 'string' && raw.createdAt.trim() ? raw.createdAt.trim() : new Date().toISOString();
  const aiCli = raw.aiCli === 'gemini' ? 'gemini' : 'claude';
  if (!id || !name || !directory) return null;
  return { id, name, directory, createdAt, aiCli };
}

function normalizeCard(raw: any): Card {
  const now = new Date().toISOString();
  const column = COLUMNS.some((col) => col.id === raw?.column) ? raw.column : 'backlog';
  const status: CardStatus = isCardStatus(raw?.status) ? raw.status : 'idle';
  const attentionMode = normalizeAttentionMode(raw?.attentionMode);
  const attentionReason =
    typeof raw?.attentionReason === 'string' && raw.attentionReason.trim() ? raw.attentionReason.trim() : null;
  const projectId = typeof raw?.projectId === 'string' && raw.projectId.trim() ? raw.projectId.trim() : null;

  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    projectId,
    title: typeof raw?.title === 'string' ? raw.title : 'Untitled',
    description: typeof raw?.description === 'string' ? raw.description : '',
    column,
    createdAt: typeof raw?.createdAt === 'string' && raw.createdAt ? raw.createdAt : now,
    movedAt: typeof raw?.movedAt === 'string' && raw.movedAt ? raw.movedAt : now,
    skillTriggered:
      typeof raw?.skillTriggered === 'string' && raw.skillTriggered ? raw.skillTriggered : null,
    status,
    logFile: typeof raw?.logFile === 'string' && raw.logFile ? raw.logFile : null,
    designDocs: Array.isArray(raw?.designDocs) ? raw.designDocs.map(String) : [],
    tags: Array.isArray(raw?.tags) ? raw.tags.map(String) : [],
    attachments: Array.isArray(raw?.attachments) ? raw.attachments.map(normalizeAttachment).filter(Boolean) as CardAttachment[] : [],
    lastViewedAt: typeof raw?.lastViewedAt === 'string' && raw.lastViewedAt ? raw.lastViewedAt : null,
    attentionMode,
    attentionReason: attentionMode === 'waiting_on_human' ? attentionReason : null,
    attentionUpdatedAt:
      typeof raw?.attentionUpdatedAt === 'string' && raw.attentionUpdatedAt ? raw.attentionUpdatedAt : null,
    activity: Array.isArray(raw?.activity) ? raw.activity.map(normalizeActivityEntry) : [],
  };
}

/**
 * Read the board state from disk. Returns a default empty state if the file
 * is missing or unreadable.
 */
export function loadState(config: MCConfig): BoardState {
  try {
    const raw = fs.readFileSync(config.boardStateFile, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<BoardState>;
    return {
      version: 1,
      projects: Array.isArray(parsed?.projects) ? parsed.projects.map(normalizeProject).filter(Boolean) as Project[] : [],
      cards: Array.isArray(parsed?.cards) ? parsed.cards.map(normalizeCard) : [],
    };
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return { ...DEFAULT_STATE, projects: [], cards: [] };
    }
    throw err;
  }
}

/**
 * Write the board state to disk atomically (tmp file + rename) with mode 0o600.
 */
export function saveState(config: MCConfig, state: BoardState): void {
  const tmpFile = `${config.boardStateFile}.tmp`;
  const json = JSON.stringify(state, null, 2);
  fs.writeFileSync(tmpFile, json, { mode: 0o600 });
  fs.renameSync(tmpFile, config.boardStateFile);
}

type ActivityExtra = Omit<Partial<ActivityEntry>, 'id' | 'type' | 'timestamp' | 'text'>;

/**
 * Append an activity entry to a card (in-memory). Caller must saveState().
 */
function pushActivity(card: Card, type: ActivityType, text: string, extra?: ActivityExtra): void {
  if (!card.activity) card.activity = [];
  card.activity.push(
    normalizeActivityEntry({
      id: crypto.randomUUID(),
      type,
      actor: extra?.actor,
      timestamp: new Date().toISOString(),
      text,
      ...extra,
    }),
  );
}

/**
 * Add an activity entry to a persisted card by ID.
 */
export function addActivity(
  config: MCConfig,
  cardId: string,
  type: ActivityType,
  text: string,
  extra?: ActivityExtra,
): Card {
  const state = loadState(config);
  const idx = state.cards.findIndex((c) => c.id === cardId);
  if (idx === -1) throw new Error(`Card not found: ${cardId}`);
  const card = state.cards[idx];
  pushActivity(card, type, text, extra);
  saveState(config, state);
  return card;
}

/**
 * Create a new card in the backlog and persist it.
 */
export function createCard(
  config: MCConfig,
  title: string,
  projectId: string | null = null,
  description: string = '',
  tags: string[] = [],
): Card {
  const now = new Date().toISOString();
  const card: Card = {
    id: crypto.randomUUID(),
    projectId,
    title,
    description,
    column: 'backlog',
    createdAt: now,
    movedAt: now,
    skillTriggered: null,
    status: 'idle',
    logFile: null,
    designDocs: [],
    tags,
    attachments: [],
    lastViewedAt: null,
    attentionMode: 'none',
    attentionReason: null,
    attentionUpdatedAt: null,
    activity: [],
  };

  pushActivity(card, 'card_created', 'Card created');

  const state = loadState(config);
  state.cards.push(card);
  saveState(config, state);

  return card;
}

/**
 * Move a card to a target column. If the column has an associated skill,
 * sets status to "pending", records the skill, and creates a log file path.
 * Same-column moves are true no-ops.
 */
export interface MoveCardResult {
  card: Card;
  skill: string | null;
  changed: boolean;
}

export function moveCard(
  config: MCConfig,
  cardId: string,
  targetColumn: ColumnId,
): MoveCardResult {
  const state = loadState(config);
  const idx = state.cards.findIndex((c) => c.id === cardId);
  if (idx === -1) {
    throw new Error(`Card not found: ${cardId}`);
  }

  const columnDef = COLUMNS.find((col) => col.id === targetColumn);
  if (!columnDef) {
    throw new Error(`Unknown column: ${targetColumn}`);
  }

  const skill = columnDef.skill ?? null;
  const now = new Date().toISOString();
  const card = state.cards[idx];

  if (card.column === targetColumn) {
    return {
      card,
      skill: null,
      changed: false,
    };
  }

  const fromColumn = card.column;
  const previousStatus = card.status;
  card.column = targetColumn;
  card.movedAt = now;

  pushActivity(card, 'stage_changed', `Moved from ${fromColumn} to ${columnDef.name}`, {
    column: targetColumn,
    fromColumn,
    toColumn: targetColumn,
  });

  let nextStatus: CardStatus;
  if (skill) {
    nextStatus = 'pending';
    card.skillTriggered = skill;
    const timestamp = now.replace(/[:.]/g, '-');
    card.logFile = path.join(config.logsDir, `${cardId}-${timestamp}.log`);
  } else {
    nextStatus = 'idle';
    card.skillTriggered = null;
  }

  card.status = nextStatus;
  if (previousStatus !== nextStatus) {
    pushActivity(card, 'status_changed', `Status changed from ${previousStatus} to ${nextStatus}`, {
      column: targetColumn,
      fromStatus: previousStatus,
      toStatus: nextStatus,
    });
  }

  saveState(config, state);

  return { card, skill, changed: true };
}

/**
 * Update select fields on an existing card.
 */
export function updateCard(
  config: MCConfig,
  cardId: string,
  updates: Partial<
    Pick<
      Card,
      | 'projectId'
      | 'title'
      | 'description'
      | 'tags'
      | 'attachments'
      | 'status'
      | 'logFile'
      | 'designDocs'
      | 'skillTriggered'
      | 'lastViewedAt'
      | 'attentionMode'
      | 'attentionReason'
      | 'attentionUpdatedAt'
    >
  >,
): Card {
  const state = loadState(config);
  const idx = state.cards.findIndex((c) => c.id === cardId);
  if (idx === -1) {
    throw new Error(`Card not found: ${cardId}`);
  }

  const card = state.cards[idx];
  Object.assign(card, updates);
  saveState(config, state);

  return card;
}

export function setCardStatus(
  config: MCConfig,
  cardId: string,
  nextStatus: CardStatus,
  extra?: ActivityExtra,
): Card {
  const state = loadState(config);
  const idx = state.cards.findIndex((c) => c.id === cardId);
  if (idx === -1) {
    throw new Error(`Card not found: ${cardId}`);
  }

  const card = state.cards[idx];
  const previousStatus = card.status;
  if (previousStatus === nextStatus) {
    return card;
  }

  card.status = nextStatus;
  pushActivity(card, 'status_changed', `Status changed from ${previousStatus} to ${nextStatus}`, {
    ...extra,
    fromStatus: previousStatus,
    toStatus: nextStatus,
  });
  saveState(config, state);

  return card;
}

/**
 * Find any cards marked as "running" or "pending" and mark them as "failed"
 * with a reason. This should be called on server startup to handle
 * crashes or restarts that interrupted agent runs.
 */
export function recoverStaleCards(config: MCConfig): void {
  const state = loadState(config);
  let changed = false;
  const now = new Date().toISOString();

  for (const card of state.cards) {
    if (card.status === 'running' || card.status === 'pending') {
      const oldStatus = card.status;
      card.status = 'failed';
      pushActivity(
        card,
        'run_failed',
        `Interrupted: Server restarted while card was ${oldStatus}`,
        {
          fromStatus: oldStatus,
          toStatus: 'failed',
          column: card.column,
          skill: card.skillTriggered || undefined,
        },
      );
      changed = true;
    }
  }

  if (changed) {
    saveState(config, state);
  }
}

/**
 * Delete log files that are not associated with any current card and
 * are older than 7 days.
 */
export function cleanOldLogs(config: MCConfig): void {
  const state = loadState(config);
  const activeLogs = new Set(
    state.cards.map((c) => c.logFile).filter((f): f is string => !!f),
  );

  try {
    const files = fs.readdirSync(config.logsDir);
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (!file.endsWith('.log')) continue;
      const fullPath = path.join(config.logsDir, file);
      if (activeLogs.has(fullPath)) continue;

      try {
        const stats = fs.statSync(fullPath);
        if (stats.mtimeMs < weekAgo) {
          fs.unlinkSync(fullPath);
        }
      } catch {}
    }
  } catch {}
}

/**
 * Delete a card by ID.
 */
export function deleteCard(config: MCConfig, cardId: string): void {
  const state = loadState(config);
  const idx = state.cards.findIndex((c) => c.id === cardId);
  if (idx === -1) {
    throw new Error(`Card not found: ${cardId}`);
  }

  state.cards.splice(idx, 1);
  saveState(config, state);
}

/**
 * Look up a single card by ID. Returns null if not found.
 */
export function getCard(config: MCConfig, cardId: string): Card | null {
  const state = loadState(config);
  return state.cards.find((c) => c.id === cardId) ?? null;
}

/**
 * Return all cards with status "pending".
 */
export function getPendingCards(config: MCConfig): Card[] {
  const state = loadState(config);
  return state.cards.filter((c) => c.status === 'pending');
}

export function createProject(config: MCConfig, name: string, directory: string, aiCli: 'claude' | 'gemini' = 'claude'): Project {
  const state = loadState(config);
  const project: Project = {
    id: crypto.randomUUID(),
    name,
    directory,
    createdAt: new Date().toISOString(),
    aiCli,
  };
  state.projects.push(project);
  saveState(config, state);
  return project;
}

export function updateProject(config: MCConfig, projectId: string, updates: Partial<Pick<Project, 'name' | 'directory' | 'aiCli'>>): Project {
  const state = loadState(config);
  const idx = state.projects.findIndex((p) => p.id === projectId);
  if (idx === -1) throw new Error(`Project not found: ${projectId}`);
  Object.assign(state.projects[idx], updates);
  saveState(config, state);
  return state.projects[idx];
}

export function deleteProject(config: MCConfig, projectId: string): void {
  const state = loadState(config);
  const idx = state.projects.findIndex((p) => p.id === projectId);
  if (idx === -1) throw new Error(`Project not found: ${projectId}`);
  state.projects.splice(idx, 1);
  // Cascade delete cards
  state.cards = state.cards.filter((c) => c.projectId !== projectId);
  saveState(config, state);
}

export function getProject(config: MCConfig, projectId: string): Project | null {
  const state = loadState(config);
  return state.projects.find((p) => p.id === projectId) ?? null;
}
