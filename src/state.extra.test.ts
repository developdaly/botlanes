import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadState,
  createCard,
  moveCard,
  addActivity,
  getUnreadCommentCount,
  getAllUnreadCommentCounts,
  updateCard,
  COLUMNS,
  type BoardState
} from './state';
import type { MCConfig } from './config';

describe('state.ts - Advanced Operations', () => {
  let tmpDir: string;
  let config: MCConfig;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlanes-advanced-test-'));
    config = {
      projectDir: tmpDir,
      stateDir: path.join(tmpDir, '.gstack'),
      logsDir: path.join(tmpDir, '.gstack', 'logs'),
      uploadsDir: path.join(tmpDir, '.gstack', 'uploads'),
      serverStateFile: path.join(tmpDir, '.gstack', 'server.json'),
      boardStateFile: path.join(tmpDir, '.gstack', 'board.json'),
      dbFile: path.join(tmpDir, '.gstack', 'board.db'),
    };
    fs.mkdirSync(config.stateDir, { recursive: true });
    fs.mkdirSync(config.logsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('moveCard triggers skill and status change', () => {
    const card = createCard(config, 'Test Card');
    expect(card.column).toBe('backlog');
    expect(card.status).toBe('idle');

    // Move to a column with a skill (e.g. Implementation -> /autoplan or Ship -> /ship)
    const shipCol = COLUMNS.find(c => c.skill === '/ship')!;
    const result = moveCard(config, card.id, shipCol.id);

    expect(result.changed).toBe(true);
    expect(result.skill).toBe('/ship');
    expect(result.card.column).toBe(shipCol.id);
    expect(result.card.status).toBe('pending');
    expect(result.card.skillTriggered).toBe('/ship');
    expect(result.card.logFile).toContain(card.id);

    // Verify activity
    const state = loadState(config, true);
    const updatedCard = state.cards.find(c => c.id === card.id)!;
    expect(updatedCard.activity.some(a => a.type === 'stage_changed')).toBe(true);
    expect(updatedCard.activity.some(a => a.type === 'status_changed')).toBe(true);
  });

  test('moveCard to same column is no-op', () => {
    const card = createCard(config, 'Test Card');
    const result = moveCard(config, card.id, 'backlog');
    expect(result.changed).toBe(false);
  });

  test('addActivity persists entries', () => {
    const card = createCard(config, 'Test Card');
    addActivity(config, card.id, 'human_comment', 'Hello world', { actor: 'human' });

    const state = loadState(config, true);
    const updatedCard = state.cards.find(c => c.id === card.id)!;
    const comment = updatedCard.activity.find(a => a.type === 'human_comment');
    expect(comment).toBeDefined();
    expect(comment?.text).toBe('Hello world');
    expect(comment?.actor).toBe('human');
  });

  test('unread comment counts', () => {
    const card = createCard(config, 'Test Card');
    
    // Initial count is 0
    expect(getUnreadCommentCount(config, card.id)).toBe(0);

    // Add a comment from human
    addActivity(config, card.id, 'human_comment', 'Unread', { actor: 'human' });
    expect(getUnreadCommentCount(config, card.id)).toBe(1);

    // Add a system activity (should not count as unread comment)
    addActivity(config, card.id, 'status_changed', 'System message', { actor: 'system' });
    expect(getUnreadCommentCount(config, card.id)).toBe(1);

    // Update lastViewedAt to a future timestamp
    const future = new Date(Date.now() + 1000).toISOString();
    updateCard(config, card.id, { lastViewedAt: future });
    expect(getUnreadCommentCount(config, card.id)).toBe(0);

    // Add another comment after viewing. 
    // To ensure it has a later timestamp than the future we set, 
    // we set lastViewedAt back to a past time instead.
    const past = new Date(Date.now() - 10000).toISOString();
    updateCard(config, card.id, { lastViewedAt: past });
    addActivity(config, card.id, 'human_comment', 'New unread', { actor: 'human' });
    expect(getUnreadCommentCount(config, card.id)).toBe(2); // The initial 'Unread' + this 'New unread'

    // Test bulk counts
    const counts = getAllUnreadCommentCounts(config);
    expect(counts.get(card.id)).toBe(2);
  });

  test('migration from JSON to SQLite', () => {
    // Create a legacy JSON file
    const legacyData = {
      projects: [{ id: 'p1', name: 'Legacy Project', directory: './p1', createdAt: new Date().toISOString() }],
      cards: [{
        id: 'c1',
        title: 'Legacy Card',
        column: 'backlog',
        status: 'idle',
        createdAt: new Date().toISOString(),
        movedAt: new Date().toISOString(),
        activity: [{ id: 'a1', type: 'comment', actor: 'human', text: 'Legacy comment', timestamp: new Date().toISOString() }],
        attachments: []
      }]
    };
    fs.writeFileSync(config.boardStateFile, JSON.stringify(legacyData));

    // loadState should trigger migration
    const state = loadState(config, true);
    expect(state.projects).toHaveLength(1);
    expect(state.projects[0].name).toBe('Legacy Project');
    expect(state.cards).toHaveLength(1);
    expect(state.cards[0].title).toBe('Legacy Card');
    expect(state.cards[0].activity).toHaveLength(1);
    expect(state.cards[0].activity[0].text).toBe('Legacy comment');

    // Verify file rename
    expect(fs.existsSync(config.boardStateFile)).toBe(false);
    expect(fs.existsSync(config.boardStateFile + '.migrated')).toBe(true);
  });
});
