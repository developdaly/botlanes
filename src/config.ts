/**
 * Shared config for botlanes CLI + server.
 *
 * Resolution:
 *   1. BOTLANES_STATE_FILE env → derive stateDir from parent
 *   2. git rev-parse --show-toplevel → projectDir/.gstack/
 *   3. process.cwd() fallback (non-git environments)
 *
 * The CLI computes the config and passes BOTLANES_STATE_FILE to the
 * spawned server. The server derives all paths from that env var.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface MCConfig {
  projectDir: string;
  stateDir: string;
  serverStateFile: string;  // .gstack/botlanes-server.json (pid, port, token)
  boardStateFile: string;   // .gstack/botlanes.json (cards) - DEPRECATED
  dbFile: string;           // .gstack/botlanes.db (SQLite state)
  logsDir: string;          // .gstack/botlanes-logs
  uploadsDir: string;       // .gstack/botlanes-uploads
  logsSymlinkDir: string;   // botlanes-logs
  uploadsSymlinkDir: string; // botlanes-uploads
  designReportsDir: string;  // .gstack/design-reports
  qaReportsDir: string;      // .gstack/qa-reports
  designReportsSymlinkDir: string; // design-reports
  qaReportsSymlinkDir: string;     // qa-reports
}

/**
 * Detect the git repository root, or null if not in a repo / git unavailable.
 */
export function getGitRoot(): string | null {
  try {
    const proc = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 2_000, // Don't hang if .git is broken
    });
    if (proc.exitCode !== 0) return null;
    return proc.stdout.toString().trim() || null;
  } catch {
    return null;
  }
}

/**
 * Resolve all botlanes config paths.
 *
 * If BOTLANES_STATE_FILE is set (e.g. by CLI when spawning server, or by
 * tests for isolation), all paths are derived from it. Otherwise, the
 * project root is detected via git or cwd.
 */
export function resolveConfig(
  env: Record<string, string | undefined> = process.env,
): MCConfig {
  let serverStateFile: string;
  let stateDir: string;
  let projectDir: string;

  if (env.BOTLANES_STATE_FILE) {
    serverStateFile = env.BOTLANES_STATE_FILE;
    stateDir = path.dirname(serverStateFile);
    projectDir = path.dirname(stateDir); // parent of .gstack/
  } else {
    projectDir = getGitRoot() || process.cwd();
    stateDir = path.join(projectDir, '.gstack');
    serverStateFile = path.join(stateDir, 'botlanes-server.json');
  }

  return {
    projectDir,
    stateDir,
    serverStateFile,
    boardStateFile: path.join(stateDir, 'botlanes.json'),
    dbFile: path.join(stateDir, 'botlanes.db'),
    logsDir: path.join(stateDir, 'botlanes-logs'),
    uploadsDir: path.join(stateDir, 'botlanes-uploads'),
    logsSymlinkDir: path.join(projectDir, 'botlanes-logs'),
    uploadsSymlinkDir: path.join(projectDir, 'botlanes-uploads'),
    designReportsDir: path.join(stateDir, 'design-reports'),
    qaReportsDir: path.join(stateDir, 'qa-reports'),
    designReportsSymlinkDir: path.join(projectDir, 'design-reports'),
    qaReportsSymlinkDir: path.join(projectDir, 'qa-reports'),
  };
}

/**
 * Create the .gstack/ state directory and botlanes-logs/ if they don't exist.
 * Throws with a clear message on permission errors.
 */
export function ensureStateDir(config: MCConfig): void {
  try {
    fs.mkdirSync(config.stateDir, { recursive: true });
  } catch (err: any) {
    if (err.code === 'EACCES') {
      throw new Error(`Cannot create state directory ${config.stateDir}: permission denied`);
    }
    if (err.code === 'ENOTDIR') {
      throw new Error(`Cannot create state directory ${config.stateDir}: a file exists at that path`);
    }
    throw err;
  }

  const dirs = [config.logsDir, config.uploadsDir, config.designReportsDir, config.qaReportsDir];
  for (const dir of dirs) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err: any) {
      if (err.code === 'EACCES') {
        throw new Error(`Cannot create directory ${dir}: permission denied`);
      }
      if (err.code === 'ENOTDIR') {
        throw new Error(`Cannot create directory ${dir}: a file exists at that path`);
      }
      throw err;
    }
  }

  // Ensure symlinks exist for agent access (bypassing CLI dot-directory ignore)
  const symlinks = [
    [config.logsDir, config.logsSymlinkDir],
    [config.uploadsDir, config.uploadsSymlinkDir],
    [config.designReportsDir, config.designReportsSymlinkDir],
    [config.qaReportsDir, config.qaReportsSymlinkDir],
  ];
  for (const [target, link] of symlinks) {
    try {
      if (!fs.existsSync(link)) {
        // Use relative path for symlink if possible
        const relTarget = path.relative(path.dirname(link), target);
        fs.symlinkSync(relTarget, link);
      }
    } catch (err: any) {
      // Non-fatal if symlink fails
      console.error(`[botlanes] Warning: could not create symlink ${link} -> ${target}: ${err.message}`);
    }
  }

  // Ensure .gstack/ and symlinks are in the project's .gitignore
  const gitignorePath = path.join(config.projectDir, '.gitignore');
  try {
    let content = '';
    try {
      content = fs.readFileSync(gitignorePath, 'utf-8');
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }

    const required = ['.gstack/', 'botlanes-logs/', 'botlanes-uploads/', 'design-reports/', 'qa-reports/'];
    let changed = false;
    for (const item of required) {
      if (!content.includes(item)) {
        if (!content.endsWith('\n') && content.length > 0) content += '\n';
        content += `${item}\n`;
        changed = true;
      }
    }

    if (changed) {
      fs.writeFileSync(gitignorePath, content, 'utf-8');
    }
  } catch (err: any) {
    // Write warning to server log (visible even in daemon mode)
    const logPath = path.join(config.stateDir, 'botlanes-server.log');
    try {
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] Warning: could not update .gitignore at ${gitignorePath}: ${err.message}\n`);
    } catch {
      // stateDir write failed too — nothing more we can do
    }
  }
}

/**
 * Derive a slug from the git remote origin URL (owner-repo format).
 * Falls back to the directory basename if no remote is configured.
 */
export function getRemoteSlug(): string {
  try {
    const proc = Bun.spawnSync(['git', 'remote', 'get-url', 'origin'], {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 2_000,
    });
    if (proc.exitCode !== 0) throw new Error('no remote');
    const url = proc.stdout.toString().trim();
    // SSH:   git@github.com:owner/repo.git → owner-repo
    // HTTPS: https://github.com/owner/repo.git → owner-repo
    const match = url.match(/[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (match) return `${match[1]}-${match[2]}`;
    throw new Error('unparseable');
  } catch {
    const root = getGitRoot();
    return path.basename(root || process.cwd());
  }
}

/**
 * Read the binary version (git SHA) from botlanes/dist/.version.
 * Returns null if the file doesn't exist or can't be read.
 */
export function readVersionHash(execPath: string = process.execPath): string | null {
  try {
    const versionFile = path.resolve(path.dirname(execPath), '.version');
    return fs.readFileSync(versionFile, 'utf-8').trim() || null;
  } catch {
    return null;
  }
}
