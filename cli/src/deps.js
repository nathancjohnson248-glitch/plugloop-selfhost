// Real implementations of the side effects the CLI uses. Tests replace all of these.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const isWin = process.platform === "win32";
const tty = process.stdout.isTTY;
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const cyan = c(36), dim = c(2), bold = c(1);

/**
 * Run a command. "wrangler" runs the project's own wrangler (node_modules/wrangler) with node,
 * so it works the same on every OS and never needs a global install.
 * interactive: share the terminal (used for `wrangler login`). Otherwise output is captured and
 * stdin is closed, which keeps wrangler non-interactive (no confirmation prompts).
 */
export function run(cmd, args, { cwd, env, interactive } = {}) {
  let file = cmd, argv = args, shell = false;
  if (cmd === "wrangler") {
    file = process.execPath;
    argv = [path.join(cwd, "node_modules", "wrangler", "bin", "wrangler.js"), ...args];
  } else if (isWin && cmd === "npm") {
    shell = true; // npm is a .cmd shim on Windows; its args here never contain spaces
  }
  return new Promise((resolve) => {
    const child = spawn(file, argv, {
      cwd,
      shell,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", ...env },
      stdio: interactive ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("error", (e) => resolve({ code: 1, stdout, stderr: stderr + e.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** Download a .tar.gz and unpack it into dest, dropping the top-level folder. Uses the system tar
 * (built into macOS, Linux and Windows 10+). */
export async function extract(url, dest) {
  const res = await fetch(url, { headers: { "user-agent": "plugloop-cli" } });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}): ${url}`);
  const tmp = path.join(os.tmpdir(), `plugloop-${process.pid}-${Date.now()}.tar.gz`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
  try {
    const r = await run("tar", ["-xzf", tmp, "-C", dest, "--strip-components=1"], { cwd: dest });
    if (r.code !== 0) throw new Error(`Could not unpack the download: ${r.stderr.trim()}`);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
}

export async function confirm(question, def = true) {
  if (!process.stdin.isTTY) return def;
  const a = (await ask(`${cyan("?")} ${question} ${dim(def ? "(Y/n)" : "(y/N)")} `)).trim().toLowerCase();
  return a ? a.startsWith("y") : def;
}

export async function select(question, options) {
  console.log(`${cyan("?")} ${question}`);
  options.forEach((o, i) => console.log(`  ${i + 1}) ${o.label}`));
  for (;;) {
    const a = parseInt(await ask(`  Number ${dim(`(1-${options.length})`)}: `), 10);
    if (a >= 1 && a <= options.length) return options[a - 1].value;
  }
}

/** Hidden input: echoes nothing while the password is typed. */
export function password(question) {
  const prompt = `${cyan("?")} ${question}: `;
  const stdin = process.stdin;
  if (!stdin.isTTY) return ask(prompt);
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") {
          stdin.setRawMode(false); stdin.pause(); stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(value);
        }
        if (ch === "\u0003") { stdin.setRawMode(false); process.stdout.write("\n"); process.exit(130); }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

export function realDeps(version) {
  return {
    version,
    cwd: process.cwd(),
    env: process.env,
    run,
    extract,
    fetch: (...a) => fetch(...a),
    confirm,
    select,
    password,
    tmpdir: () => os.tmpdir(),
    log: (s) => console.log(s),
    intro: (s) => console.log(`\n${bold(s)}\n`),
    step: (s) => console.log(`${cyan("◆")} ${s}`),
  };
}
