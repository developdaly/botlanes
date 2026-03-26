import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadState,
  saveState,
  createCard,
  recoverStaleCards,
  cleanOldLogs,
  updateCard,
  type BoardState
} from './state';
import type { MCConfig } from './config';

describe('stability and troubleshooting', () => {
  let tmpDir: string;
  let config: MCConfig;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlanes-stability-test-'));
    config = {
      projectDir: tmpDir,
      stateDir: path.join(tmpDir, '.gstack'),
      logsDir: path.join(tmpDir, '.gstack', 'logs'),
      uploadsDir: path.join(tmpDir, '.gstack', 'uploads'),
      serverStateFile: path.join(tmpDir, '.gstack', 'server.json'),
      boardStateFile: path.join(tmpDir, '.gstack', 'board.json'),
    };
    fs.mkdirSync(config.stateDir, { recursive: true });
    fs.mkdirSync(config.logsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('recoverStaleCards marks running/pending cards as failed', () => {
    const card1 = createCard(config, 'Running Card');
    updateCard(config, card1.id, { status: 'running', skillTriggered: '/qa' });
    
    const card2 = createCard(config, 'Pending Card');
    updateCard(config, card2.id, { status: 'pending', skillTriggered: '/ship' });

    const card3 = createCard(config, 'Idle Card');
    updateCard(config, card3.id, { status: 'idle' });

    const card4 = createCard(config, 'Complete Card');
    updateCard(config, card4.id, { status: 'complete' });

    recoverStaleCards(config);

    const state = loadState(config);
    const c1 = state.cards.find(c => c.id === card1.id)!;
    const c2 = state.cards.find(c => c.id === card2.id)!;
    const c3 = state.cards.find(c => c.id === card3.id)!;
    const c4 = state.cards.find(c => c.id === card4.id)!;

    expect(c1.status).toBe('failed');
    expect(c1.activity.some(a => a.type === 'run_failed' && a.text.includes('Server restarted'))).toBe(true);
    
    expect(c2.status).toBe('failed');
    expect(c2.activity.some(a => a.type === 'run_failed' && a.text.includes('Server restarted'))).toBe(true);
    
    expect(c3.status).toBe('idle');
    expect(c4.status).toBe('complete');
  });

  test('cleanOldLogs removes orphaned logs older than 7 days', () => {
    const activeLog = path.join(config.logsDir, 'active.log');
    fs.writeFileSync(activeLog, 'active');
    
    const card = createCard(config, 'Card with log');
    updateCard(config, card.id, { logFile: activeLog });

    const orphanedNewLog = path.join(config.logsDir, 'orphaned-new.log');
    fs.writeFileSync(orphanedNewLog, 'orphaned new');

    const orphanedOldLog = path.join(config.logsDir, 'orphaned-old.log');
    fs.writeFileSync(orphanedOldLog, 'orphaned old');
    
    const now = Date.now();
    const tenDaysAgo = new Date(now - 10 * 24 * 60 * 60 * 1000);
    fs.utimesSync(orphanedOldLog, tenDaysAgo, tenDaysAgo);

    cleanOldLogs(config);

    expect(fs.existsSync(activeLog)).toBe(true);
    expect(fs.existsSync(orphanedNewLog)).toBe(true);
    expect(fs.existsSync(orphanedOldLog)).toBe(false);
  });
});
