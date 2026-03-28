import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadState,
  saveState,
  createCard,
  getCard,
  addPlan,
  createProject,
  updateProject,
  deleteProject,
  getProject,
  type BoardState
} from './state';
import type { MCConfig } from './config';

describe('state.ts - Project CRUD and Cascade Delete', () => {
  let tmpDir: string;
  let config: MCConfig;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlanes-test-'));
    config = {
      projectDir: tmpDir,
      stateDir: path.join(tmpDir, '.gstack'),
      logsDir: path.join(tmpDir, '.gstack', 'logs'),
      uploadsDir: path.join(tmpDir, '.gstack', 'uploads'),
      serverStateFile: path.join(tmpDir, '.gstack', 'server.json'),
      boardStateFile: path.join(tmpDir, '.gstack', 'board.json'),
    };
    fs.mkdirSync(config.stateDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('creates a project', () => {
    const project = createProject(config, 'Test Project', './test-dir');
    expect(project.id).toBeDefined();
    expect(project.name).toBe('Test Project');
    expect(project.directory).toBe('./test-dir');

    const state = loadState(config);
    expect(state.projects).toHaveLength(1);
    expect(state.projects[0].id).toBe(project.id);
  });

  test('updates a project', () => {
    const project = createProject(config, 'Test Project', './test-dir');
    
    const updated = updateProject(config, project.id, { name: 'Updated Name' });
    expect(updated.name).toBe('Updated Name');
    expect(updated.directory).toBe('./test-dir'); // Should remain unchanged

    const state = loadState(config);
    expect(state.projects[0].name).toBe('Updated Name');
  });

  test('deletes a project and cascade deletes associated cards', () => {
    // Create projects
    const p1 = createProject(config, 'Project 1', './p1');
    const p2 = createProject(config, 'Project 2', './p2');

    // Create cards
    const card1 = createCard(config, 'Card 1', p1.id);
    const card2 = createCard(config, 'Card 2', p1.id);
    const card3 = createCard(config, 'Card 3', p2.id); // Different project
    const card4 = createCard(config, 'Card 4', null);  // Global lane

    let state = loadState(config);
    expect(state.projects).toHaveLength(2);
    expect(state.cards).toHaveLength(4);

    // Delete p1
    deleteProject(config, p1.id);

    state = loadState(config);
    
    // Project 1 should be gone
    expect(state.projects).toHaveLength(1);
    expect(state.projects[0].id).toBe(p2.id);

    // Cards associated with Project 1 should be gone
    expect(state.cards).toHaveLength(2);
    const cardIds = state.cards.map(c => c.id);
    expect(cardIds).not.toContain(card1.id);
    expect(cardIds).not.toContain(card2.id);
    expect(cardIds).toContain(card3.id);
    expect(cardIds).toContain(card4.id);
  });

  test('getProject retrieves correct project', () => {
    const project = createProject(config, 'Test Project', './test-dir');
    const retrieved = getProject(config, project.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(project.id);

    const nonExistent = getProject(config, 'does-not-exist');
    expect(nonExistent).toBeNull();
  });

  test('addPlan saves and replaces plans correctly', () => {
    const card = createCard(config, 'Test Card');
    const planText = '### Initial Plan';
    
    // Add first plan
    addPlan(config, card.id, 'autoplan', '/autoplan', planText);
    let updated = getCard(config, card.id)!;
    expect(updated.plans).toHaveLength(1);
    expect(updated.plans[0].column).toBe('autoplan');
    expect(updated.plans[0].text).toBe(planText);
    
    // Replace same stage plan
    const newPlanText = '### Updated Plan';
    addPlan(config, card.id, 'autoplan', '/autoplan', newPlanText);
    updated = getCard(config, card.id)!;
    expect(updated.plans).toHaveLength(1);
    expect(updated.plans[0].text).toBe(newPlanText);
    
    // Add second stage plan
    addPlan(config, card.id, 'eng-review', '/plan-eng-review', '### Eng Plan');
    updated = getCard(config, card.id)!;
    expect(updated.plans).toHaveLength(2);
  });
});
