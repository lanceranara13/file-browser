import { spawn } from "node:child_process";

export interface RunResult {
  /** null when the binary could not be started or was killed. */
  code: number | null;
  stdout: string;
  stderr: string;
  /** Whether stdout hit `maxStdout` and the command was cut short. */
  truncated: boolean;
}

/**
 * Runs a short-lived command to completion. Never throws; a missing binary is
 * `code: null`. `maxStdout` caps what is kept in memory — past it the child is
 * killed, which is how listing an archive with a million entries stays cheap.
 */
export function run(command: string, args: string[], timeoutMs = 15_000, maxStdout = Infinity) {
  return new Promise<RunResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let truncated = false;
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => {
      if (truncated) return;
      stdout += chunk;
      if (stdout.length <= maxStdout) return;
      stdout = stdout.slice(0, maxStdout);
      truncated = true;
      child.kill("SIGKILL");
    });
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: error.message, truncated });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, truncated });
    });
  });
}
