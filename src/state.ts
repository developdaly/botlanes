import { Database } from 'bun:sqlite';
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

export interface Plan {
  id: string;
  column: string;
  skill: string;
  text: string;
  timestamp: string;
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
  plans: Plan[];
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

// ─── Database ────────────────────────────────────────────────────────────────

// Module-level cache: dbFile path → Database instance
const DB_CACHE = new Map<string, Database>();

function openDb(config: MCConfig): Database {
  const cached = DB_CACHE.get(config.dbFile);
  if (cached) return cached;

  const db = new Database(config.dbFile, { create: true });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  initSchema(db);
  maybeMigrateFromJson(db, config);
  DB_CACHE.set(config.dbFile, db);
  return db;
}

function initSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      directory   TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      ai_cli      TEXT NOT NULL DEFAULT 'claude'
    );

    CREATE TABLE IF NOT EXISTS cards (
      id                   TEXT PRIMARY KEY,
      project_id           TEXT REFERENCES projects(id),
      title                TEXT NOT NULL DEFAULT 'Untitled',
      description          TEXT NOT NULL DEFAULT '',
      col                  TEXT NOT NULL DEFAULT 'backlog',
      created_at           TEXT NOT NULL,
      moved_at             TEXT NOT NULL,
      skill_triggered      TEXT,
      status               TEXT NOT NULL DEFAULT 'idle',
      log_file             TEXT,
      design_docs          TEXT NOT NULL DEFAULT '[]',
      tags                 TEXT NOT NULL DEFAULT '[]',
      last_viewed_at       TEXT,
      attention_mode       TEXT NOT NULL DEFAULT 'none',
      attention_reason     TEXT,
      attention_updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS activity (
      id          TEXT PRIMARY KEY,
      card_id     TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      type        TEXT NOT NULL,
      actor       TEXT NOT NULL,
      timestamp   TEXT NOT NULL,
      text        TEXT NOT NULL,
      col         TEXT,
      skill       TEXT,
      from_column TEXT,
      to_column   TEXT,
      from_status TEXT,
      to_status   TEXT,
      session_id  TEXT,
      session_key TEXT,
      exit_code   INTEGER,
      reason      TEXT
    );

    CREATE TABLE IF NOT EXISTS card_attachments (
      id            TEXT PRIMARY KEY,
      card_id       TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      stored_name   TEXT NOT NULL,
      mime_type     TEXT NOT NULL,
      size_bytes    INTEGER NOT NULL,
      uploaded_at   TEXT NOT NULL,
      last_used_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS plans (
      id        TEXT PRIMARY KEY,
      card_id   TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      col       TEXT NOT NULL,
      skill     TEXT NOT NULL,
      text      TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_activity_card_id        ON activity(card_id);
    CREATE INDEX IF NOT EXISTS idx_activity_timestamp      ON activity(card_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_cards_status            ON cards(status);
    CREATE INDEX IF NOT EXISTS idx_card_attachments_card   ON card_attachments(card_id);
  `);
}

// ─── JSON migration ──────────────────────────────────────────────────────────

function maybeMigrateFromJson(db: Database, config: MCConfig): void {
  if (!fs.existsSync(config.boardStateFile)) return;

  // Only migrate if the DB is empty
  const count = (db.prepare('SELECT COUNT(*) as n FROM cards').get() as { n: number }).n;
  if (count > 0) return;

  let raw: any;
  try {
    raw = JSON.parse(fs.readFileSync(config.boardStateFile, 'utf-8'));
  } catch {
    return;
  }

  const projects: any[] = Array.isArray(raw?.projects) ? raw.projects : [];
  const cards: any[] = Array.isArray(raw?.cards) ? raw.cards : [];

  const insertProject = db.prepare(`
    INSERT OR IGNORE INTO projects (id, name, directory, created_at, ai_cli)
    VALUES ($id, $name, $directory, $created_at, $ai_cli)
  `);

  const insertCard = db.prepare(`
    INSERT OR IGNORE INTO cards
      (id, project_id, title, description, col, created_at, moved_at,
       skill_triggered, status, log_file, design_docs, tags,
       last_viewed_at, attention_mode, attention_reason, attention_updated_at)
    VALUES
      ($id, $project_id, $title, $description, $col, $created_at, $moved_at,
       $skill_triggered, $status, $log_file, $design_docs, $tags,
       $last_viewed_at, $attention_mode, $attention_reason, $attention_updated_at)
  `);

  const insertActivity = db.prepare(`
    INSERT OR IGNORE INTO activity
      (id, card_id, type, actor, timestamp, text, col, skill,
       from_column, to_column, from_status, to_status,
       session_id, session_key, exit_code, reason)
    VALUES
      ($id, $card_id, $type, $actor, $timestamp, $text, $col, $skill,
       $from_column, $to_column, $from_status, $to_status,
       $session_id, $session_key, $exit_code, $reason)
  `);

  const insertAttachment = db.prepare(`
    INSERT OR IGNORE INTO card_attachments
      (id, card_id, original_name, stored_name, mime_type, size_bytes, uploaded_at, last_used_at)
    VALUES
      ($id, $card_id, $original_name, $stored_name, $mime_type, $size_bytes, $uploaded_at, $last_used_at)
  `);

  db.transaction(() => {
    for (const p of projects) {
      const norm = normalizeProject(p);
      if (!norm) continue;
      insertProject.run({
        $id: norm.id,
        $name: norm.name,
        $directory: norm.directory,
        $created_at: norm.createdAt,
        $ai_cli: norm.aiCli ?? 'claude',
      });
    }

    for (const c of cards) {
      const norm = normalizeCard(c);
      insertCard.run({
        $id: norm.id,
        $project_id: norm.projectId,
        $title: norm.title,
        $description: norm.description,
        $col: norm.column,
        $created_at: norm.createdAt,
        $moved_at: norm.movedAt,
        $skill_triggered: norm.skillTriggered,
        $status: norm.status,
        $log_file: norm.logFile,
        $design_docs: JSON.stringify(norm.designDocs),
        $tags: JSON.stringify(norm.tags),
        $last_viewed_at: norm.lastViewedAt,
        $attention_mode: norm.attentionMode,
        $attention_reason: norm.attentionReason,
        $attention_updated_at: norm.attentionUpdatedAt,
      });

      for (const a of norm.activity) {
        insertActivity.run({
          $id: a.id,
          $card_id: norm.id,
          $type: a.type,
          $actor: a.actor,
          $timestamp: a.timestamp,
          $text: a.text,
          $col: a.column ?? null,
          $skill: a.skill ?? null,
          $from_column: a.fromColumn ?? null,
          $to_column: a.toColumn ?? null,
          $from_status: a.fromStatus ?? null,
          $to_status: a.toStatus ?? null,
          $session_id: a.sessionId ?? null,
          $session_key: a.sessionKey ?? null,
          $exit_code: a.exitCode ?? null,
          $reason: a.reason ?? null,
        });
      }

      for (const att of norm.attachments) {
        insertAttachment.run({
          $id: att.id,
          $card_id: norm.id,
          $original_name: att.originalName,
          $stored_name: att.storedName,
          $mime_type: att.mimeType,
          $size_bytes: att.sizeBytes,
          $uploaded_at: att.uploadedAt,
          $last_used_at: att.lastUsedAt,
        });
      }
    }
  })();

  // Rename the JSON file so we don't re-migrate on next startup
  try {
    fs.renameSync(config.boardStateFile, config.boardStateFile + '.migrated');
  } catch {
    // Non-fatal — next startup will see count > 0 and skip migration
  }
}

// ─── Row → Type conversions ──────────────────────────────────────────────────

function rowToProject(row: any): Project {
  return {
    id: row.id,
    name: row.name,
    directory: row.directory,
    createdAt: row.created_at,
    aiCli: row.ai_cli === 'gemini' ? 'gemini' : 'claude',
  };
}

function rowToActivity(row: any): ActivityEntry {
  return {
    id: row.id,
    type: row.type as ActivityType,
    actor: row.actor as ActivityActor,
    timestamp: row.timestamp,
    text: row.text,
    ...(row.col ? { column: row.col } : {}),
    ...(row.skill ? { skill: row.skill } : {}),
    ...(row.from_column ? { fromColumn: row.from_column } : {}),
    ...(row.to_column ? { toColumn: row.to_column } : {}),
    ...(row.from_status ? { fromStatus: row.from_status } : {}),
    ...(row.to_status ? { toStatus: row.to_status } : {}),
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    ...(row.session_key ? { sessionKey: row.session_key } : {}),
    ...(row.exit_code != null ? { exitCode: row.exit_code } : {}),
    ...(row.reason ? { reason: row.reason } : {}),
  };
}

function rowToAttachment(row: any): CardAttachment {
  return {
    id: row.id,
    originalName: row.original_name,
    storedName: row.stored_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    uploadedAt: row.uploaded_at,
    lastUsedAt: row.last_used_at ?? null,
  };
}

function rowToPlan(row: any): Plan {
  return {
    id: row.id,
    column: row.col,
    skill: row.skill,
    text: row.text,
    timestamp: row.timestamp,
  };
}

function rowToCard(row: any, activities: ActivityEntry[], attachments: CardAttachment[], plans: Plan[]): Card {
  return {
    id: row.id,
    projectId: row.project_id ?? null,
    title: row.title,
    description: row.description,
    column: row.col as ColumnId,
    createdAt: row.created_at,
    movedAt: row.moved_at,
    skillTriggered: row.skill_triggered ?? null,
    status: row.status as CardStatus,
    logFile: row.log_file ?? null,
    designDocs: safeJsonArray(row.design_docs),
    plans,
    tags: safeJsonArray(row.tags),
    attachments,
    lastViewedAt: row.last_viewed_at ?? null,
    attentionMode: (row.attention_mode ?? 'none') as AttentionMode,
    attentionReason: row.attention_reason ?? null,
    attentionUpdatedAt: row.attention_updated_at ?? null,
    activity: activities,
  };
}

function safeJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

// ─── Legacy normalization (used during migration) ────────────────────────────

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

function normalizePlan(raw: any): Plan | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID();
  const column = typeof raw.column === 'string' ? raw.column : '';
  const skill = typeof raw.skill === 'string' ? raw.skill : '';
  const text = typeof raw.text === 'string' ? raw.text : '';
  const timestamp = typeof raw.timestamp === 'string' ? raw.timestamp : new Date().toISOString();
  if (!column || !text) return null;
  return { id, column, skill, text, timestamp };
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
    plans: Array.isArray(raw?.plans) ? raw.plans.map(normalizePlan).filter(Boolean) as Plan[] : [],
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

// ─── Internal helpers ────────────────────────────────────────────────────────

function fetchCard(db: Database, cardId: string): Card | null {
  const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId) as any;
  if (!row) return null;
  const activities = (db.prepare('SELECT * FROM activity WHERE card_id = ? ORDER BY timestamp ASC').all(cardId) as any[]).map(rowToActivity);
  const attachments = (db.prepare('SELECT * FROM card_attachments WHERE card_id = ?').all(cardId) as any[]).map(rowToAttachment);
  const plans = (db.prepare('SELECT * FROM plans WHERE card_id = ? ORDER BY timestamp ASC').all(cardId) as any[]).map(rowToPlan);
  return rowToCard(row, activities, attachments, plans);
}

const INSERT_ACTIVITY_STMT = `
  INSERT INTO activity
    (id, card_id, type, actor, timestamp, text, col, skill,
     from_column, to_column, from_status, to_status,
     session_id, session_key, exit_code, reason)
  VALUES
    ($id, $card_id, $type, $actor, $timestamp, $text, $col, $skill,
     $from_column, $to_column, $from_status, $to_status,
     $session_id, $session_key, $exit_code, $reason)
`;

type ActivityExtra = Omit<Partial<ActivityEntry>, 'id' | 'type' | 'timestamp' | 'text'>;

function insertActivityRow(db: Database, cardId: string, type: ActivityType, text: string, extra?: ActivityExtra): ActivityEntry {
  const entry = normalizeActivityEntry({
    id: crypto.randomUUID(),
    type,
    actor: extra?.actor,
    timestamp: new Date().toISOString(),
    text,
    ...extra,
    ...(extra?.column ? { column: extra.column } : {}),
  });

  db.prepare(INSERT_ACTIVITY_STMT).run({
    $id: entry.id,
    $card_id: cardId,
    $type: entry.type,
    $actor: entry.actor,
    $timestamp: entry.timestamp,
    $text: entry.text,
    $col: entry.column ?? null,
    $skill: entry.skill ?? null,
    $from_column: entry.fromColumn ?? null,
    $to_column: entry.toColumn ?? null,
    $from_status: entry.fromStatus ?? null,
    $to_status: entry.toStatus ?? null,
    $session_id: entry.sessionId ?? null,
    $session_key: entry.sessionKey ?? null,
    $exit_code: entry.exitCode ?? null,
    $reason: entry.reason ?? null,
  });

  return entry;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Return the full board state. Optimized to return an empty activity trail 
 * for cards by default to save memory and I/O. Individual activity trails 
 * are fetched per-card when needed.
 */
export function loadState(config: MCConfig, includeActivity = false): BoardState {
  const db = openDb(config);

  const projects = (db.prepare('SELECT * FROM projects ORDER BY created_at ASC').all() as any[]).map(rowToProject);

  const cardRows = db.prepare('SELECT * FROM cards ORDER BY created_at ASC').all() as any[];
  const attachmentRows = db.prepare('SELECT * FROM card_attachments').all() as any[];
  const planRows = db.prepare('SELECT * FROM plans ORDER BY timestamp ASC').all() as any[];

  const activitiesByCard = new Map<string, ActivityEntry[]>();
  if (includeActivity) {
    const activityRows = db.prepare('SELECT * FROM activity ORDER BY timestamp ASC').all() as any[];
    for (const row of activityRows) {
      const list = activitiesByCard.get(row.card_id) ?? [];
      list.push(rowToActivity(row));
      activitiesByCard.set(row.card_id, list);
    }
  }

  const attachmentsByCard = new Map<string, CardAttachment[]>();
  for (const row of attachmentRows) {
    const list = attachmentsByCard.get(row.card_id) ?? [];
    list.push(rowToAttachment(row));
    attachmentsByCard.set(row.card_id, list);
  }

  const plansByCard = new Map<string, Plan[]>();
  for (const row of planRows) {
    const list = plansByCard.get(row.card_id) ?? [];
    list.push(rowToPlan(row));
    plansByCard.set(row.card_id, list);
  }

  const cards = cardRows.map((row) =>
    rowToCard(row, activitiesByCard.get(row.id) ?? [], attachmentsByCard.get(row.id) ?? [], plansByCard.get(row.id) ?? [])
  );

  return { version: 1, projects, cards };
}

/**
 * Return the unread comment count for a card. 
 * Optimized to run directly in SQLite.
 */
export function getUnreadCommentCount(config: MCConfig, cardId: string): number {
  const db = openDb(config);
  const row = db.prepare(`
    SELECT COUNT(*) as count 
    FROM activity a
    JOIN cards c ON a.card_id = c.id
    WHERE a.card_id = ? 
      AND a.actor != 'system'
      AND (c.last_viewed_at IS NULL OR a.timestamp > c.last_viewed_at)
  `).get(cardId) as { count: number };
  return row?.count ?? 0;
}

/**
 * Return unread comment counts for all cards.
 * Optimized to run in a single SQL query.
 */
export function getAllUnreadCommentCounts(config: MCConfig): Map<string, number> {
  const db = openDb(config);
  const rows = db.prepare(`
    SELECT a.card_id, COUNT(*) as count 
    FROM activity a
    JOIN cards c ON a.card_id = c.id
    WHERE a.actor != 'system'
      AND (c.last_viewed_at IS NULL OR a.timestamp > c.last_viewed_at)
    GROUP BY a.card_id
  `).all() as { card_id: string; count: number }[];
  
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.card_id, row.count);
  }
  return map;
}

/**
 * Append an activity entry to a persisted card by ID.
 */
export function addActivity(
  config: MCConfig,
  cardId: string,
  type: ActivityType,
  text: string,
  extra?: ActivityExtra,
): Card {
  const db = openDb(config);
  const exists = db.prepare('SELECT id FROM cards WHERE id = ?').get(cardId);
  if (!exists) throw new Error(`Card not found: ${cardId}`);
  insertActivityRow(db, cardId, type, text, extra);
  return fetchCard(db, cardId)!;
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
  const db = openDb(config);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO cards
      (id, project_id, title, description, col, created_at, moved_at,
       skill_triggered, status, log_file, design_docs, tags,
       last_viewed_at, attention_mode, attention_reason, attention_updated_at)
    VALUES
      ($id, $project_id, $title, $description, 'backlog', $now, $now,
       NULL, 'idle', NULL, '[]', $tags,
       NULL, 'none', NULL, NULL)
  `).run({
    $id: id,
    $project_id: projectId,
    $title: title,
    $description: description,
    $now: now,
    $tags: JSON.stringify(tags),
  });

  insertActivityRow(db, id, 'card_created', 'Card created');

  return fetchCard(db, id)!;
}

export interface MoveCardResult {
  card: Card;
  skill: string | null;
  changed: boolean;
}

/**
 * Move a card to a target column. If the column has an associated skill,
 * sets status to "pending", records the skill, and creates a log file path.
 * Same-column moves are true no-ops.
 */
export function moveCard(
  config: MCConfig,
  cardId: string,
  targetColumn: ColumnId,
): MoveCardResult {
  const db = openDb(config);

  const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId) as any;
  if (!row) throw new Error(`Card not found: ${cardId}`);

  const columnDef = COLUMNS.find((col) => col.id === targetColumn);
  if (!columnDef) throw new Error(`Unknown column: ${targetColumn}`);

  if (row.col === targetColumn) {
    return { card: fetchCard(db, cardId)!, skill: null, changed: false };
  }

  const skill = columnDef.skill ?? null;
  const now = new Date().toISOString();
  const fromColumn = row.col;
  const previousStatus = row.status as CardStatus;

  let nextStatus: CardStatus;
  let skillTriggered: string | null;
  let logFile: string | null = row.log_file;

  if (skill) {
    nextStatus = 'pending';
    skillTriggered = skill;
    const timestamp = now.replace(/[:.]/g, '-');
    logFile = path.join(config.logsDir, `${cardId}-${timestamp}.log`);
  } else {
    nextStatus = 'idle';
    skillTriggered = null;
  }

  db.prepare(`
    UPDATE cards SET col = $col, moved_at = $now, skill_triggered = $skill_triggered,
      status = $status, log_file = $log_file WHERE id = $id
  `).run({
    $col: targetColumn,
    $now: now,
    $skill_triggered: skillTriggered,
    $status: nextStatus,
    $log_file: logFile,
    $id: cardId,
  });

  insertActivityRow(db, cardId, 'stage_changed', `Moved from ${fromColumn} to ${columnDef.name}`, {
    column: targetColumn,
    fromColumn,
    toColumn: targetColumn,
  });

  if (previousStatus !== nextStatus) {
    insertActivityRow(db, cardId, 'status_changed', `Status changed from ${previousStatus} to ${nextStatus}`, {
      column: targetColumn,
      fromStatus: previousStatus,
      toStatus: nextStatus,
    });
  }

  return { card: fetchCard(db, cardId)!, skill, changed: true };
}

export function addPlan(
  config: MCConfig,
  cardId: string,
  column: string,
  skill: string,
  text: string,
): Card {
  const db = openDb(config);
  const exists = db.prepare('SELECT id FROM cards WHERE id = ?').get(cardId);
  if (!exists) throw new Error(`Card not found: ${cardId}`);

  const now = new Date().toISOString();
  
  // Upsert plan for this column
  const existing = db.prepare('SELECT id FROM plans WHERE card_id = ? AND col = ?').get(cardId, column) as any;
  if (existing) {
    db.prepare('UPDATE plans SET skill = ?, text = ?, timestamp = ? WHERE id = ?').run(skill, text, now, existing.id);
  } else {
    db.prepare(`
      INSERT INTO plans (id, card_id, col, skill, text, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), cardId, column, skill, text, now);
  }

  return fetchCard(db, cardId)!;
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
  const db = openDb(config);
  const exists = db.prepare('SELECT id FROM cards WHERE id = ?').get(cardId);
  if (!exists) throw new Error(`Card not found: ${cardId}`);

  // Build SET clause dynamically for scalar fields
  const fieldMap: Record<string, string> = {
    projectId: 'project_id',
    title: 'title',
    description: 'description',
    tags: 'tags',
    status: 'status',
    logFile: 'log_file',
    designDocs: 'design_docs',
    skillTriggered: 'skill_triggered',
    lastViewedAt: 'last_viewed_at',
    attentionMode: 'attention_mode',
    attentionReason: 'attention_reason',
    attentionUpdatedAt: 'attention_updated_at',
  };

  const setClauses: string[] = [];
  const params: Record<string, any> = { $id: cardId };

  for (const [key, col] of Object.entries(fieldMap)) {
    if (key in updates && key !== 'attachments') {
      const val = (updates as any)[key];
      const serialized = (key === 'tags' || key === 'designDocs') ? JSON.stringify(val) : val;
      setClauses.push(`${col} = $${col}`);
      params[`$${col}`] = serialized;
    }
  }

  if (setClauses.length > 0) {
    db.prepare(`UPDATE cards SET ${setClauses.join(', ')} WHERE id = $id`).run(params);
  }

  // Handle attachments as separate table
  if ('attachments' in updates && updates.attachments !== undefined) {
    db.prepare('DELETE FROM card_attachments WHERE card_id = ?').run(cardId);
    const insertAtt = db.prepare(`
      INSERT INTO card_attachments
        (id, card_id, original_name, stored_name, mime_type, size_bytes, uploaded_at, last_used_at)
      VALUES ($id, $card_id, $original_name, $stored_name, $mime_type, $size_bytes, $uploaded_at, $last_used_at)
    `);
    for (const att of updates.attachments) {
      insertAtt.run({
        $id: att.id,
        $card_id: cardId,
        $original_name: att.originalName,
        $stored_name: att.storedName,
        $mime_type: att.mimeType,
        $size_bytes: att.sizeBytes,
        $uploaded_at: att.uploadedAt,
        $last_used_at: att.lastUsedAt,
      });
    }
  }

  return fetchCard(db, cardId)!;
}

export function setCardStatus(
  config: MCConfig,
  cardId: string,
  nextStatus: CardStatus,
  extra?: ActivityExtra,
): Card {
  const db = openDb(config);
  const row = db.prepare('SELECT status FROM cards WHERE id = ?').get(cardId) as any;
  if (!row) throw new Error(`Card not found: ${cardId}`);

  const previousStatus = row.status as CardStatus;
  if (previousStatus === nextStatus) return fetchCard(db, cardId)!;

  db.prepare('UPDATE cards SET status = ? WHERE id = ?').run(nextStatus, cardId);
  insertActivityRow(db, cardId, 'status_changed', `Status changed from ${previousStatus} to ${nextStatus}`, {
    ...extra,
    fromStatus: previousStatus,
    toStatus: nextStatus,
  });

  return fetchCard(db, cardId)!;
}

/**
 * Find any cards marked as "running" or "pending" and mark them as "failed"
 * with a reason. Called on server startup.
 */
export function recoverStaleCards(config: MCConfig): void {
  const db = openDb(config);
  const stale = db.prepare(`SELECT * FROM cards WHERE status IN ('running', 'pending')`).all() as any[];

  if (stale.length === 0) return;

  db.transaction(() => {
    for (const row of stale) {
      const oldStatus = row.status as CardStatus;
      db.prepare('UPDATE cards SET status = ? WHERE id = ?').run('failed', row.id);
      insertActivityRow(db, row.id, 'run_failed', `Interrupted: Server restarted while card was ${oldStatus}`, {
        fromStatus: oldStatus,
        toStatus: 'failed',
        column: row.col,
        skill: row.skill_triggered || undefined,
      });
    }
  })();
}

/**
 * Delete log files not associated with any current card and older than 7 days.
 */
export function cleanOldLogs(config: MCConfig): void {
  const db = openDb(config);
  const rows = db.prepare('SELECT log_file FROM cards WHERE log_file IS NOT NULL').all() as any[];
  const activeLogs = new Set(rows.map((r) => r.log_file as string));

  try {
    const files = fs.readdirSync(config.logsDir);
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

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
  const db = openDb(config);
  const exists = db.prepare('SELECT id FROM cards WHERE id = ?').get(cardId);
  if (!exists) throw new Error(`Card not found: ${cardId}`);
  // ON DELETE CASCADE handles activity and card_attachments
  db.prepare('DELETE FROM cards WHERE id = ?').run(cardId);
}

/**
 * Look up a single card by ID. Returns null if not found.
 */
export function getCard(config: MCConfig, cardId: string): Card | null {
  const db = openDb(config);
  return fetchCard(db, cardId);
}

/**
 * Return all cards with status "pending".
 */
export function getPendingCards(config: MCConfig): Card[] {
  const db = openDb(config);
  const rows = db.prepare(`SELECT id FROM cards WHERE status = 'pending'`).all() as any[];
  return rows.map((r) => fetchCard(db, r.id)!);
}

export function createProject(config: MCConfig, name: string, directory: string, aiCli: 'claude' | 'gemini' = 'claude'): Project {
  const db = openDb(config);
  const project: Project = {
    id: crypto.randomUUID(),
    name,
    directory,
    createdAt: new Date().toISOString(),
    aiCli,
  };
  db.prepare(`
    INSERT INTO projects (id, name, directory, created_at, ai_cli)
    VALUES ($id, $name, $directory, $created_at, $ai_cli)
  `).run({
    $id: project.id,
    $name: project.name,
    $directory: project.directory,
    $created_at: project.createdAt,
    $ai_cli: aiCli,
  });
  return project;
}

export function updateProject(config: MCConfig, projectId: string, updates: Partial<Pick<Project, 'name' | 'directory' | 'aiCli'>>): Project {
  const db = openDb(config);
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as any;
  if (!row) throw new Error(`Project not found: ${projectId}`);

  const name = updates.name ?? row.name;
  const directory = updates.directory ?? row.directory;
  const aiCli = updates.aiCli ?? row.ai_cli;

  db.prepare(`UPDATE projects SET name = ?, directory = ?, ai_cli = ? WHERE id = ?`).run(name, directory, aiCli, projectId);

  return rowToProject({ ...row, name, directory, ai_cli: aiCli });
}

export function deleteProject(config: MCConfig, projectId: string): void {
  const db = openDb(config);
  const exists = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (!exists) throw new Error(`Project not found: ${projectId}`);
  // Delete associated cards first (CASCADE handles activity + attachments)
  db.prepare('DELETE FROM cards WHERE project_id = ?').run(projectId);
  db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
}

export function getProject(config: MCConfig, projectId: string): Project | null {
  const db = openDb(config);
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as any;
  if (!row) return null;
  return rowToProject(row);
}
