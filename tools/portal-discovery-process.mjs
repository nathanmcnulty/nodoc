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

export async function runNodeJson(scriptPath, argumentsList, timeoutMs, { cwd, maxOutputBytes = 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...argumentsList], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;
    let stdout = "";
    let stderr = "";
    const append = (current, chunk) => {
      const next = current + String(chunk);
      if (Buffer.byteLength(next, "utf8") > maxOutputBytes) {
        child.kill();
        throw new Error(`${scriptPath} exceeded the bounded output limit.`);
      }
      return next;
    };
    child.stdout.on("data", (chunk) => {
      try { stdout = append(stdout, chunk); } catch (error) { finish(reject)(error); }
    });
    child.stderr.on("data", (chunk) => {
      try { stderr = append(stderr, chunk); } catch (error) { finish(reject)(error); }
    });
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new ProcessSupervisionTimeoutError(scriptPath, timeoutMs));
    }, timeoutMs);
    const finish = (callback) => (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    child.on("error", finish(reject));
    child.on("exit", finish((code, signal) => {
      if (code !== 0) {
        reject(new Error(signal
          ? `${scriptPath} exited after signal ${signal}.`
          : `${scriptPath} exited with code ${code}${stderr.trim() ? " during bounded JSON capture" : ""}.`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        reject(new Error(`${scriptPath} returned invalid bounded JSON output.`));
      }
    }));
  });
}
