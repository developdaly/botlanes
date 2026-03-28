import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadState,
  createCard,
  recoverStaleCards,
  cleanOldLogs,
  updateCard,
  type BoardState
} from './state';
import type { MCConfig } from './config';
import { appendLog, MAX_LOG_SIZE_BYTES } from './server';

describe('stability and troubleshooting', () => {
  let tmpDir: string;
  let config: MCConfig;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlanes-stability-test-'));
    const stateDir = path.join(tmpDir, '.gstack');
    config = {
      projectDir: tmpDir,
      stateDir,
      logsDir: path.join(stateDir, 'botlanes-logs'),
      uploadsDir: path.join(stateDir, 'botlanes-uploads'),
      serverStateFile: path.join(stateDir, 'server.json'),
      boardStateFile: path.join(stateDir, 'board.json'),
      dbFile: path.join(stateDir, 'board.db'),
      logsSymlinkDir: path.join(tmpDir, 'botlanes-logs'),
      uploadsSymlinkDir: path.join(tmpDir, 'botlanes-uploads'),
      designReportsDir: path.join(stateDir, 'design-reports'),
      qaReportsDir: path.join(stateDir, 'qa-reports'),
      designReportsSymlinkDir: path.join(tmpDir, 'design-reports'),
      qaReportsSymlinkDir: path.join(tmpDir, 'qa-reports'),
    };
    fs.mkdirSync(config.stateDir, { recursive: true });
    fs.mkdirSync(config.logsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('recoverStaleCards marks running/pending cards as idle', () => {
    const card1 = createCard(config, 'Running Card');
    updateCard(config, card1.id, { status: 'running', skillTriggered: '/qa' });
    
    const card2 = createCard(config, 'Pending Card');
    updateCard(config, card2.id, { status: 'pending', skillTriggered: '/ship' });

    const card3 = createCard(config, 'Idle Card');
    updateCard(config, card3.id, { status: 'idle' });

    const card4 = createCard(config, 'Complete Card');
    updateCard(config, card4.id, { status: 'complete' });

    recoverStaleCards(config);

    const state = loadState(config, true);
    const c1 = state.cards.find(c => c.id === card1.id)!;
    const c2 = state.cards.find(c => c.id === card2.id)!;
    const c3 = state.cards.find(c => c.id === card3.id)!;
    const c4 = state.cards.find(c => c.id === card4.id)!;

    expect(c1.status).toBe('idle');
    expect(c1.activity.some(a => a.type === 'run_cancelled' && a.text.includes('Server restarted'))).toBe(true);
    
    expect(c2.status).toBe('idle');
    expect(c2.activity.some(a => a.type === 'run_cancelled' && a.text.includes('Server restarted'))).toBe(true);
    
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

  test('appendLog respects log size limit', () => {
    const logFile = path.join(config.logsDir, 'truncated.log');
    
    // Fill it up just below the limit
    const nearlyFull = 'x'.repeat(MAX_LOG_SIZE_BYTES - 10);
    appendLog(logFile, nearlyFull);
    
    // This append should cross the limit and trigger truncation message
    appendLog(logFile, 'this should cause truncation');
    
    const content = fs.readFileSync(logFile, 'utf-8');
    expect(content).toContain('[botlanes] Log size limit reached');
    expect(content).not.toContain('this should cause truncation');
    
    // Subsequent appends should do nothing
    const sizeAfterTruncation = fs.statSync(logFile).size;
    appendLog(logFile, 'more data');
    expect(fs.statSync(logFile).size).toBe(sizeAfterTruncation);
  });
});
