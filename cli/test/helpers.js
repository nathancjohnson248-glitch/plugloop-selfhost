import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DB_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

export function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "plugloop-cli-test-"));
}

/** A fake release tarball's contents, built from the real repo's wrangler.jsonc and migrations. */
export function makeRelease(version = "v0.2.0", extra = {}) {
  const dir = tmp();
  fs.copyFileSync(path.join(ROOT, "wrangler.jsonc"), path.join(dir, "wrangler.jsonc"));
  fs.cpSync(path.join(ROOT, "migrations"), path.join(dir, "migrations"), { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "plugloop-selfhost", version }));
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "index.ts"), `export const VERSION = "${version}";\n`);
  for (const [f, body] of Object.entries(extra)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), body);
  }
  return dir;
}

function json(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/**
 * Fake deps. `wrangler` maps a command key ("whoami", "login", "d1 create", "d1 list",
 * "d1 migrations", "deploy", "npm") to a result or a function returning one.
 */
export function fakeDeps({ cwd, release, latest = "v0.2.0", wrangler = {}, answers = {}, env = {} } = {}) {
  const calls = [];
  const logs = [];
  let loggedIn = wrangler.loggedIn ?? true;
  const secretsSeen = [];
  const defaults = {
    whoami: () => ({ code: loggedIn ? 0 : 1, stdout: JSON.stringify(loggedIn ? { loggedIn: true, email: "nathan@example.com", accounts: wrangler.accounts ?? [{ id: "acc1", name: "Nathan" }] } : { loggedIn: false }), stderr: "" }),
    login: () => { loggedIn = true; return { code: 0, stdout: "", stderr: "" }; },
    "d1 list": { code: 0, stdout: JSON.stringify(wrangler.databases ?? []), stderr: "" },
    "d1 create": { code: 0, stdout: `✅ Successfully created DB 'plugloop'\n{\n  "d1_databases": [\n    {\n      "binding": "plugloop",\n      "database_name": "plugloop",\n      "database_id": "${DB_ID}"\n    }\n  ]\n}\n`, stderr: "" },
    "d1 migrations": { code: 0, stdout: "✅ 0001_init.sql", stderr: "" },
    deploy: { code: 0, stdout: "Uploaded plugloop\nDeployed plugloop triggers\n  https://plugloop.nathan.workers.dev\n  schedule: 7 0 * * *\n", stderr: "" },
    npm: { code: 0, stdout: "", stderr: "" },
  };
  const table = { ...defaults, ...wrangler };
  const keyOf = (cmd, args) => {
    if (cmd === "npm") return "npm";
    if (args[0] === "d1") return `d1 ${args[1]}`;
    return args[0];
  };
  const deps = {
    cwd,
    env,
    calls,
    logs,
    secretsSeen,
    tmpdir: () => os.tmpdir(),
    async run(cmd, args, opts = {}) {
      calls.push({ cmd, args, opts });
      const i = args.indexOf("--secrets-file");
      if (i >= 0) secretsSeen.push({ data: JSON.parse(fs.readFileSync(args[i + 1], "utf8")), file: args[i + 1] });
      const r = table[keyOf(cmd, args)];
      if (!r) throw new Error(`unexpected command ${cmd} ${args.join(" ")}`);
      return typeof r === "function" ? r(args, opts) : r;
    },
    async fetch(url) {
      calls.push({ fetch: url });
      if (url.endsWith("/releases/latest")) return latest ? json(200, { tag_name: latest }) : json(404, {});
      if (url.endsWith("/commits/main")) return json(200, { sha: "0123456789abcdef0123456789abcdef01234567" });
      return json(404, {});
    },
    async extract(url, dest) {
      calls.push({ extract: url, dest });
      fs.cpSync(release, dest, { recursive: true });
    },
    async confirm(q, def) { calls.push({ confirm: q }); return answers.confirm ?? def; },
    async select(q, options) { calls.push({ select: q, options }); return answers.select ?? options[0].value; },
    async password(q) {
      calls.push({ password: q });
      const list = answers.passwords ?? ["hunter2hunter2", "hunter2hunter2"];
      return list.shift();
    },
    log: (s) => logs.push(s),
    intro: (s) => logs.push(s),
    step: (s) => logs.push(`◆ ${s}`),
  };
  return deps;
}

export const wranglerCalls = (deps) => deps.calls.filter((c) => c.cmd === "wrangler").map((c) => c.args.join(" "));
