import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { MCConfig } from './config';

// Fixed pipeline columns from AGENTS.md
export const COLUMNS = [
  { id: 'backlog', name: 'Backlog', skill: null },
  { id: 'office-hours', name: 'Office Hours', skill: '/office-hours' },
  { id: 'ceo-review', name: 'CEO Review', skill: '/plan-ceo-review' },
  { id: 'eng-review', name: 'Eng Review', skill: '/plan-eng-review' },
  { id: 'design-review', name: 'Design Review', skill: '/plan-design-review' },
  { id: 'design', name: 'Design', skill: '/design-consultation' },
  { id: 'implementation', name: 'Implementation', skill: null },
  { id: 'code-review', name: 'Code Review', skill: '/review' },
  { id: 'debug', name: 'Debug', skill: '/debug' },
  { id: 'qa', name: 'QA', skill: '/qa' },
  { id: 'ship', name: 'Ship', skill: '/ship' },
  { id: 'docs', name: 'Docs', skill: '/document-release' },
  { id: 'retro', name: 'Retro', skill: '/retro' },
  { id: 'done', name: 'Done', skill: null },
] as const;

export type ColumnId = (typeof COLUMNS)[number]['id'];
export type CardStatus = 'idle' | 'pending' | 'running' | 'complete' | 'failed' | 'awaiting_human';
export type AttentionMode = 'none' | 'waiting_on_patrick';
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
  modelRef: string | null;
  lastViewedAt: string | null;
  attentionMode: AttentionMode;
  attentionReason: string | null;
  attentionUpdatedAt: string | null;
  activity: ActivityEntry[];
  sessionId: string | null;
  sessionKey: string | null;
  sessionFile: string | null;
}

export interface BoardState {
  version: 1;
  cards: Card[];
}

const DEFAULT_STATE: BoardState = {
  version: 1,
  cards: [],
};

export function isCardStatus(raw: unknown): raw is CardStatus {
  return typeof raw === 'string' && VALID_CARD_STATUSES.has(raw as CardStatus);
}

function normalizeAttentionMode(raw: unknown): AttentionMode {
  return raw === 'waiting_on_patrick' ? 'waiting_on_patrick' : 'none';
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

function normalizeCard(raw: any): Card {
  const now = new Date().toISOString();
  const column = COLUMNS.some((col) => col.id === raw?.column) ? raw.column : 'backlog';
  const status: CardStatus = isCardStatus(raw?.status) ? raw.status : 'idle';
  const attentionMode = normalizeAttentionMode(raw?.attentionMode);
  const attentionReason =
    typeof raw?.attentionReason === 'string' && raw.attentionReason.trim() ? raw.attentionReason.trim() : null;

  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
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
    modelRef: typeof raw?.modelRef === 'string' && raw.modelRef.trim() ? raw.modelRef.trim() : null,
    lastViewedAt: typeof raw?.lastViewedAt === 'string' && raw.lastViewedAt ? raw.lastViewedAt : null,
    attentionMode,
    attentionReason: attentionMode === 'waiting_on_patrick' ? attentionReason : null,
    attentionUpdatedAt:
      typeof raw?.attentionUpdatedAt === 'string' && raw.attentionUpdatedAt ? raw.attentionUpdatedAt : null,
    activity: Array.isArray(raw?.activity) ? raw.activity.map(normalizeActivityEntry) : [],
    sessionId: typeof raw?.sessionId === 'string' && raw.sessionId ? raw.sessionId : null,
    sessionKey: typeof raw?.sessionKey === 'string' && raw.sessionKey ? raw.sessionKey : null,
    sessionFile: typeof raw?.sessionFile === 'string' && raw.sessionFile ? raw.sessionFile : null,
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
      cards: Array.isArray(parsed?.cards) ? parsed.cards.map(normalizeCard) : [],
    };
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return { ...DEFAULT_STATE, cards: [] };
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
  description: string = '',
  tags: string[] = [],
): Card {
  const now = new Date().toISOString();
  const card: Card = {
    id: crypto.randomUUID(),
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
    modelRef: null,
    lastViewedAt: null,
    attentionMode: 'none',
    attentionReason: null,
    attentionUpdatedAt: null,
    activity: [],
    sessionId: null,
    sessionKey: null,
    sessionFile: null,
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
      | 'title'
      | 'description'
      | 'tags'
      | 'attachments'
      | 'modelRef'
      | 'status'
      | 'logFile'
      | 'designDocs'
      | 'skillTriggered'
      | 'sessionId'
      | 'sessionKey'
      | 'sessionFile'
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
