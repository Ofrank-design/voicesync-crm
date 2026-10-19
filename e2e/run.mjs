
import { execFileSync, spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FRONTEND = path.join(ROOT, "frontend");
const BACKEND = path.join(ROOT, "backend");
const E2E = path.join(ROOT, "e2e");
const win = process.platform === "win32";
const children = [];
let stopping = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function executable(name) {
  return path.join(
    ROOT,
    "node_modules",
    ".bin",
    win ? `${name}.cmd` : name
  );
}

function packageExecutable(packageDir, relativePath) {
  return path.join(packageDir, "node_modules", relativePath);
}

const NEXT_BIN = packageExecutable(FRONTEND, "next/dist/bin/next");
const TSX_BIN = packageExecutable(BACKEND, "tsx/dist/cli.mjs");
const PLAYWRIGHT_BIN = packageExecutable(E2E, "playwright/cli.js");

const inUse = (port) =>
  new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });

async function waitFor(url, name, ms = 60000) {
  const startTime = Date.now();
  let lastError = "No response yet";

  while (Date.now() - startTime < ms) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }

    await sleep(500);
  }

  throw new Error(`${name} failed to start. Last check: ${lastError}`);
}

function start(name, command, args, cwd, env = {}) {
  console.log(`\n[${name}] Launching: ${command} ${args.join(" ")}`);

  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    shell: false,
    detached: !win,
  });

  let tail = "";

  for (const [stream, target] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr],
  ]) {
    stream.on("data", (data) => {
      const output = data.toString();
      tail = (tail + output).slice(-5000);
      target.write(`[${name}] ${output}`);
    });
  }

  child.on("error", (error) => {
    console.error(`\n[${name}] Process launch failed: ${error.message}`);
  });

  child.on("exit", (code, signal) => {
    if (!stopping) {
      console.error(
        `\n[${name}] Process exited. Code: ${code}, signal: ${signal}\n` +
          `Last output:\n${tail || "(No output captured)"}`
      );
    }
  });

  children.push(child);
  return child;
}

function stopAll() {
  if (stopping) return;
  stopping = true;

  for (const child of children) {
    if (!child.pid) continue;

    try {
      if (win) {
        const killer = spawn(
          "taskkill",
          ["/PID", String(child.pid), "/T", "/F"],
          { stdio: "ignore", windowsHide: true }
        );
        killer.on("error", () => {});
      } else {
        process.kill(-child.pid, "SIGTERM");
      }
    } catch {
      // Process may already have exited.
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopAll();
    process.exit(130);
  });
}

async function main() {
  for (const port of [3000, 8000]) {
    if (await inUse(port)) {
      throw new Error(
        `Port ${port} is already in use. Stop the process using it, then retry.`
      );
    }
  }

  execFileSync(
    process.execPath,
    [path.join(E2E, "fixtures", "make-audio.mjs")],
    { cwd: ROOT, stdio: "inherit" }
  );

  if (process.env.SKIP_BUILD !== "1") {
    console.log("\nBuilding the website in test mode...");

    execFileSync(
      process.execPath,
      [NEXT_BIN, "build"],
      {
        cwd: FRONTEND,
        stdio: "inherit",
        env: {
          ...process.env,
          VOICESYNC_ALLOW_LOCAL_BUILD: "1",
          NEXT_PUBLIC_AUTH_MODE: "local",
          NEXT_PUBLIC_API_BASE_URL: "http://localhost:8000",
        },
        windowsHide: true,
      }
    );
  }

  console.log("\nStarting the test API and website...");

  start(
    "test API",
    process.execPath,
    [TSX_BIN, "test/e2e-server.ts"],
    BACKEND,
    { FRONTEND_ORIGIN: "http://localhost:3000" }
  );

  start(
    "website",
    process.execPath,
    [NEXT_BIN, "start", "-p", "3000"],
    FRONTEND
  );

  await waitFor("http://127.0.0.1:8000/api/live", "Test API");
  await waitFor("http://127.0.0.1:3000/", "Website");

  console.log("\nBoth servers are ready. Running Playwright tests...\n");

  const playwright = spawn(
    process.execPath,
    [PLAYWRIGHT_BIN, "test", ...process.argv.slice(2)],
    {
      cwd: E2E,
      stdio: "inherit",
      windowsHide: true,
    }
  );

  const code = await new Promise((resolve, reject) => {
    playwright.on("error", reject);
    playwright.on("exit", (exitCode) => resolve(exitCode ?? 1));
  });

  return code;
}

main()
  .then((code) => {
    stopAll();
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`\nE2E FAILED: ${error.stack || error.message}`);
    stopAll();
    process.exitCode = 1;
  });
