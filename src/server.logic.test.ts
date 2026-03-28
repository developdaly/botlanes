import { expect, test, describe } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { isTerminalErrorInLog, isTerminalExitCode } from "./server";

// Mock log file creation
function createMockLog(content: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "botlanes-test-"));
  const logFile = path.join(tmpDir, "test.log");
  fs.writeFileSync(logFile, content);
  return logFile;
}

function cleanupLog(logFile: string) {
  try {
    fs.rmSync(path.dirname(logFile), { recursive: true, force: true });
  } catch {}
}

describe("isTerminalErrorInLog", () => {
  test("returns true for rate limit in stderr", () => {
    const logFile = createMockLog("[stderr] API Error: Rate limit reached\nSome other output");
    expect(isTerminalErrorInLog(logFile)).toBe(true);
    cleanupLog(logFile);
  });

  test("returns true for session terminated", () => {
    const logFile = createMockLog("[botlanes] session terminated abruptly");
    expect(isTerminalErrorInLog(logFile)).toBe(true);
    cleanupLog(logFile);
  });

  test("returns false for 'server error' in tool output (THE FIX)", () => {
    const logFile = createMockLog("Agent ran: grep 'server error' app.log\nMatch: [500] server error");
    // Now this should be FALSE, because it's not on a [botlanes] or [stderr] line
    expect(isTerminalErrorInLog(logFile)).toBe(false);
    cleanupLog(logFile);
  });

  test("returns false for tool error in stderr", () => {
    const logFile = createMockLog("[stderr] Traceback (most recent call last):\n[stderr]   File \"app.py\", line 10, in <module>\n[stderr]     raise Exception('some error')");
    expect(isTerminalErrorInLog(logFile)).toBe(false);
    cleanupLog(logFile);
  });

  test("returns false for regular tool output", () => {
    const logFile = createMockLog("All tests passed\nBuild successful");
    expect(isTerminalErrorInLog(logFile)).toBe(false);
    cleanupLog(logFile);
  });
});

describe("isTerminalExitCode", () => {
  test("returns true for SIGKILL (137)", () => {
    expect(isTerminalExitCode(137)).toBe(true);
  });

  test("returns false for null exit code", () => {
    expect(isTerminalExitCode(null)).toBe(false);
  });

  test("returns false for exit code 1", () => {
    expect(isTerminalExitCode(1)).toBe(false);
  });

  test("returns false for exit code 0", () => {
    expect(isTerminalExitCode(0)).toBe(false);
  });
});
