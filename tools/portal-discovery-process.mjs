import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

export class ProcessSupervisionTimeoutError extends Error {
  constructor(scriptPath, timeoutMs) {
    super(`${scriptPath} exceeded the ${timeoutMs} ms supervision deadline.`);
    this.name = "ProcessSupervisionTimeoutError";
    this.scriptPath = scriptPath;
    this.timeoutMs = timeoutMs;
  }

}

export async function writeParentSupervisionFailure(outputPath, timeoutMs, detail) {
  const failure = {
    detail,
    phase: "parent-supervision",
    schemaVersion: 2,
    source: "run-portal-discovery",
    timeoutMs,
  };
  await writeFile(outputPath, `${JSON.stringify(failure, null, 2)}\n`, "utf8");
  return failure;
}

export async function runNode(scriptPath, argumentsList, timeoutMs, { cwd, stdio = "inherit" } = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...argumentsList], {
      cwd,
      stdio,
    });
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill();
      reject(new ProcessSupervisionTimeoutError(scriptPath, timeoutMs));
    }, timeoutMs);
    const finish = (callback) => (value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    child.on("error", finish(reject));
    child.on("exit", finish((code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        signal
          ? `${scriptPath} exited after signal ${signal}.`
          : `${scriptPath} exited with code ${code}.`,
      ));
    }));
  });
}
