import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const copyFileIfNotExists = (src, dest) => {
  if (!fs.existsSync(src)) {
    return;
  }
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) {
    console.log(`[setup] Creating directory: ${destDir}`);
    fs.mkdirSync(destDir, { recursive: true });
  }
  if (!fs.existsSync(dest)) {
    // console.log(`[setup] Copying ${path.basename(src)} to ${destDir}`);
    fs.copyFileSync(src, dest);
  }
};

const setupConfigs = () => {
  const homeDir = os.homedir();
  const workspaceDev = path.join(homeDir, ".openclaw", "workspace-dev");
  const workspaceProd = path.join(homeDir, ".openclaw", "workspace");
  const repoRoot = path.resolve(process.cwd());

  // Assume script is run from jarvis/ root
  const autonomySrc = path.join(repoRoot, "AUTONOMY.yaml");
  const securitySrc = path.join(repoRoot, "SECURITY.md");
  const soulSrc = path.join(repoRoot, "SOUL.md");

  [workspaceDev, workspaceProd].forEach((ws) => {
    copyFileIfNotExists(autonomySrc, path.join(ws, "AUTONOMY.yaml"));
    copyFileIfNotExists(securitySrc, path.join(ws, "SECURITY.md"));
    copyFileIfNotExists(soulSrc, path.join(ws, "SOUL.md"));
  });
};

const checkAndKillPort = (port) => {
  try {
    const stdout = execSync(`lsof -i :${port} -t`).toString().trim();
    if (stdout) {
      const pids = stdout.split("\n").filter(Boolean);
      // console.log(`[doctor] Port ${port} is in use by PID(s): ${pids.join(", ")}`);
      pids.forEach((pid) => {
        try {
          // console.log(`[doctor] Killing PID ${pid}...`);
          process.kill(parseInt(pid), "SIGTERM");
        } catch (e) {
          // console.warn(`[doctor] Failed to kill ${pid}: ${e.message}`);
        }
      });
    }
  } catch (e) {
    // If lsof fails (exit status 1), it usually means no process found, which is good.
    if (e.status !== 1) {
      // console.warn(`[doctor] Warning checking port ${port}: ${e.message}`);
    }
  }
};

const run = () => {
  console.log("[setup] Checking configuration files...");
  setupConfigs();

  // Dev port is usually 19001, Prod 18789
  if (process.env.OPENCLAW_DOCTOR_PORT) {
    checkAndKillPort(parseInt(process.env.OPENCLAW_DOCTOR_PORT));
  } else {
    checkAndKillPort(19001);
    checkAndKillPort(18789);
  }
  console.log("[setup] Ready.");
};

run();
