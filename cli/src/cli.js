// plugloop: one-command install and update for Plugloop self-host on Cloudflare.
// Every side effect goes through `deps` so the whole flow can be tested with fakes.
import fs from "node:fs";
import path from "node:path";
import {
  PLACEHOLDER_ID, applyUserSettings, parseCreatedId, parseDeployUrl,
  setDatabase, setTopLevel, setWorkerName, userSettings,
} from "./config.js";

export const REPO = "nathancjohnson248-glitch/plugloop-selfhost";
export const STATE_FILE = ".plugloop.json";
const DEFAULT_NAME = "plugloop";
// Kept across updates: never overwritten by a new release.
const PRESERVE = new Set([".git", ".wrangler", "node_modules", ".dev.vars", STATE_FILE, "wrangler.jsonc"]);

export class CliError extends Error {}

export function parseArgs(argv) {
  const out = { command: "install", flags: {} };
  const rest = [...argv];
  if (rest[0] && !rest[0].startsWith("-")) out.command = rest.shift();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith("--")) { out.flags._ = a; continue; }
    const [k, v] = a.slice(2).split("=", 2);
    if (v !== undefined) out.flags[k] = v;
    else if (rest[i + 1] && !rest[i + 1].startsWith("--")) out.flags[k] = rest[++i];
    else out.flags[k] = true;
  }
  return out;
}

const HELP = `plugloop: self-host Plugloop on your own Cloudflare account

Usage
  npx plugloop@latest                 install: download, log in, create D1, migrate, set password, deploy
  npx plugloop@latest update          pull the latest release and redeploy (keeps your database)

Options
  --dir <path>      where the project lives (default: ./plugloop)
  --name <name>     Worker and D1 database name (install only, default: plugloop)
  --ref <tag>       use a specific release tag or branch instead of the latest release
  --force           update: redeploy even if already on the latest release
  -h, --help        show this help

Non-interactive: set PLUGLOOP_ADMIN_PASSWORD to skip the password prompt.`;

export async function main(argv, deps) {
  const { command, flags } = parseArgs(argv);
  if (flags.help || flags.h || command === "help" || argv.includes("-h")) { deps.log(HELP); return 0; }
  if (flags.version || argv.includes("-v")) { deps.log(deps.version || "0.0.0"); return 0; }
  try {
    if (command === "install" || command === "init") await install(flags, deps);
    else if (command === "update" || command === "upgrade") await update(flags, deps);
    else throw new CliError(`Unknown command "${command}". Run: npx plugloop@latest --help`);
    return 0;
  } catch (e) {
    deps.log(`\n✗ ${e.message}`);
    return 1;
  }
}

// ── steps ────────────────────────────────────────────────────────────────

/** Latest GitHub release, or the default branch when there are no releases yet. */
export async function resolveRelease(deps, ref, repo = REPO) {
  if (ref && ref !== true) return { ref, version: ref };
  const res = await deps.fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { accept: "application/vnd.github+json", "user-agent": "plugloop-cli" } });
  if (res.ok) {
    const r = await res.json();
    return { ref: r.tag_name, version: r.tag_name };
  }
  if (res.status !== 404) throw new CliError(`Could not reach GitHub (HTTP ${res.status}). Check your connection and try again.`);
  const c = await deps.fetch(`https://api.github.com/repos/${repo}/commits/main`, { headers: { accept: "application/vnd.github+json", "user-agent": "plugloop-cli" } });
  if (!c.ok) throw new CliError(`Could not reach GitHub (HTTP ${c.status}).`);
  const sha = (await c.json()).sha;
  return { ref: sha, version: `main@${sha.slice(0, 7)}` };
}

async function download(deps, release, dest, repo = REPO) {
  const url = `https://codeload.github.com/${repo}/tar.gz/${release.ref}`;
  await deps.extract(url, dest);
  if (!fs.existsSync(path.join(dest, "wrangler.jsonc"))) throw new CliError(`Downloaded ${release.version} but it has no wrangler.jsonc.`);
}

async function npmInstall(deps, dir) {
  deps.step("Installing dependencies (wrangler and friends)");
  const r = await deps.run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: dir });
  if (r.code !== 0) throw new CliError(`npm install failed:\n${tail(r)}`);
}

/** Make sure wrangler is logged in; returns the account id to use (or undefined for the only one). */
export async function ensureLogin(deps, dir, preferAccount) {
  deps.step("Checking your Cloudflare login");
  let who = await whoami(deps, dir);
  if (!who.loggedIn) {
    deps.log("  A browser window will open. Click \"Allow\" to let Wrangler use your Cloudflare account.");
    const r = await deps.run("wrangler", ["login"], { cwd: dir, interactive: true });
    if (r.code !== 0) throw new CliError("wrangler login did not finish. Run the command again when you are ready.");
    who = await whoami(deps, dir);
    if (!who.loggedIn) throw new CliError("Still not logged in to Cloudflare after wrangler login.");
  }
  deps.log(`  Logged in${who.email ? ` as ${who.email}` : ""}.`);
  const accounts = who.accounts || [];
  if (deps.env.CLOUDFLARE_ACCOUNT_ID) return deps.env.CLOUDFLARE_ACCOUNT_ID;
  if (preferAccount && accounts.some((a) => a.id === preferAccount)) return preferAccount;
  if (accounts.length <= 1) return accounts[0]?.id;
  const pick = await deps.select("Which Cloudflare account should Plugloop live in?", accounts.map((a) => ({ label: `${a.name} (${a.id})`, value: a.id })));
  return pick;
}

async function whoami(deps, dir) {
  const r = await deps.run("wrangler", ["whoami", "--json"], { cwd: dir });
  try {
    const j = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
    return { loggedIn: !!j.loggedIn, email: j.email, accounts: (j.accounts || []).map((a) => ({ id: a.id, name: a.name })) };
  } catch {
    return { loggedIn: false };
  }
}

/** Reuse a D1 database with this name or create it; returns its id. */
export async function ensureDatabase(deps, dir, name, env) {
  deps.step(`Setting up the D1 database "${name}"`);
  const existing = await findDatabase(deps, dir, name, env);
  if (existing) {
    const reuse = await deps.confirm(`A D1 database called "${name}" already exists. Use it (keeps its data)?`, true);
    if (!reuse) throw new CliError(`Pick another name with --name, or delete the database "${name}" first.`);
    deps.log(`  Using existing database ${existing}.`);
    return existing;
  }
  const r = await deps.run("wrangler", ["d1", "create", name, "--update-config=false"], { cwd: dir, env });
  if (r.code !== 0) throw new CliError(`Could not create the D1 database:\n${tail(r)}`);
  const id = parseCreatedId(r.stdout + r.stderr) || (await findDatabase(deps, dir, name, env));
  if (!id) throw new CliError("Created the database but could not read its id. Run `npx wrangler d1 list` and paste it into wrangler.jsonc.");
  deps.log(`  Created database ${id}.`);
  return id;
}

async function findDatabase(deps, dir, name, env) {
  const r = await deps.run("wrangler", ["d1", "list", "--json"], { cwd: dir, env });
  if (r.code !== 0) return null;
  try {
    const list = JSON.parse(r.stdout.slice(r.stdout.indexOf("[")));
    const hit = list.find((d) => d.name === name);
    return hit ? hit.uuid || hit.id || hit.database_id : null;
  } catch {
    return null;
  }
}

async function migrate(deps, dir, env) {
  deps.step("Applying database migrations");
  // stdin is not a TTY here, so wrangler skips its confirmation prompt (it still takes a backup).
  const r = await deps.run("wrangler", ["d1", "migrations", "apply", "DB", "--remote"], { cwd: dir, env });
  if (r.code !== 0) throw new CliError(`Migrations failed:\n${tail(r)}`);
}

export async function askPassword(deps) {
  const fromEnv = deps.env.PLUGLOOP_ADMIN_PASSWORD;
  if (fromEnv) {
    if (fromEnv.length < 8) throw new CliError("PLUGLOOP_ADMIN_PASSWORD must be at least 8 characters.");
    return fromEnv;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const a = await deps.password("Choose a dashboard password (8+ characters)");
    if (!a || a.length < 8) { deps.log("  Too short, use at least 8 characters."); continue; }
    const b = await deps.password("Type it again");
    if (a !== b) { deps.log("  Those didn't match, try again."); continue; }
    return a;
  }
  throw new CliError("No password set. Run the command again to retry.");
}

async function deploy(deps, dir, env, secrets) {
  deps.step("Deploying the Worker");
  let file;
  const args = ["deploy"];
  if (secrets) {
    file = path.join(deps.tmpdir(), `plugloop-secrets-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
    args.push("--secrets-file", file);
  }
  try {
    const r = await deps.run("wrangler", args, { cwd: dir, env });
    if (r.code !== 0) throw new CliError(`Deploy failed:\n${tail(r)}`);
    return parseDeployUrl(r.stdout + "\n" + r.stderr);
  } finally {
    if (file) fs.rmSync(file, { force: true });
  }
}

// ── commands ─────────────────────────────────────────────────────────────

export async function install(flags, deps) {
  const dir = path.resolve(deps.cwd, typeof flags.dir === "string" ? flags.dir : typeof flags._ === "string" ? flags._ : "plugloop");
  const name = typeof flags.name === "string" ? flags.name : DEFAULT_NAME;
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) throw new CliError("--name must be lowercase letters, digits and dashes.");
  deps.intro("Plugloop self-host · about 2 minutes");

  if (fs.existsSync(path.join(dir, STATE_FILE))) {
    throw new CliError(`Plugloop is already installed in ${dir}. To get the latest version run: npx plugloop@latest update${flags.dir ? ` --dir ${flags.dir}` : ""}`);
  }
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new CliError(`${dir} already exists and is not empty. Use --dir to pick another folder.`);

  deps.step("Downloading the latest Plugloop release");
  const release = await resolveRelease(deps, flags.ref, flags.repo || REPO);
  fs.mkdirSync(dir, { recursive: true });
  await download(deps, release, dir, flags.repo || REPO);
  deps.log(`  Got ${release.version}.`);

  await npmInstall(deps, dir);
  const accountId = await ensureLogin(deps, dir);
  const env = accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : {};

  const databaseId = await ensureDatabase(deps, dir, name, env);
  const cfgPath = path.join(dir, "wrangler.jsonc");
  let cfg = fs.readFileSync(cfgPath, "utf8");
  cfg = setDatabase(setWorkerName(cfg, name), { id: databaseId, name });
  if (accountId && !deps.env.CLOUDFLARE_ACCOUNT_ID) cfg = setTopLevel(cfg, "account_id", accountId);
  fs.writeFileSync(cfgPath, cfg);
  deps.log("  Wrote the database id into wrangler.jsonc.");

  await migrate(deps, dir, env);
  const password = await askPassword(deps);
  const url = await deploy(deps, dir, env, { ADMIN_PASSWORD: password });

  writeState(dir, { name, databaseId, accountId, version: release.version, installedAt: new Date().toISOString() });
  finish(deps, url, dir, "Plugloop is live");
}

export function findProjectDir(flags, deps) {
  const candidates = typeof flags.dir === "string" ? [path.resolve(deps.cwd, flags.dir)] : [deps.cwd, path.join(deps.cwd, "plugloop")];
  for (const d of candidates) {
    if (fs.existsSync(path.join(d, STATE_FILE))) return d;
    const w = path.join(d, "wrangler.jsonc");
    if (fs.existsSync(w) && fs.existsSync(path.join(d, "migrations")) && /plugloop/i.test(fs.readFileSync(path.join(d, "package.json"), "utf8").slice(0, 200))) return d;
  }
  throw new CliError(`No Plugloop install found${flags.dir ? ` in ${flags.dir}` : " here or in ./plugloop"}. Run it from your Plugloop folder, pass --dir, or install first with: npx plugloop@latest`);
}

export async function update(flags, deps) {
  const dir = findProjectDir(flags, deps);
  deps.intro("Plugloop update");
  const state = readState(dir);
  const cfgPath = path.join(dir, "wrangler.jsonc");
  const settings = userSettings(fs.readFileSync(cfgPath, "utf8"));
  if (!settings.databaseId || settings.databaseId === PLACEHOLDER_ID) {
    throw new CliError("wrangler.jsonc has no database id yet, so there is nothing to update. Install first with: npx plugloop@latest");
  }

  deps.step("Checking for a new release");
  const release = await resolveRelease(deps, flags.ref, flags.repo || REPO);
  if (state.version && state.version === release.version && !flags.force) {
    deps.log(`  Already on ${release.version}. Nothing to do (use --force to redeploy anyway).`);
    return;
  }
  deps.log(`  ${state.version || "unknown"} → ${release.version}`);

  const tmp = fs.mkdtempSync(path.join(deps.tmpdir(), "plugloop-update-"));
  try {
    await download(deps, release, tmp, flags.repo || REPO);
    for (const entry of fs.readdirSync(tmp)) {
      if (PRESERVE.has(entry)) continue;
      fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
      fs.cpSync(path.join(tmp, entry), path.join(dir, entry), { recursive: true });
    }
    fs.writeFileSync(cfgPath, applyUserSettings(fs.readFileSync(path.join(tmp, "wrangler.jsonc"), "utf8"), settings));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  deps.log(`  Files updated; kept your database (${settings.databaseId}), Worker name and settings.`);

  await npmInstall(deps, dir);
  const accountId = await ensureLogin(deps, dir, settings.keep.account_id || state.accountId);
  const env = accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : {};
  await migrate(deps, dir, env);
  const url = await deploy(deps, dir, env, null);

  writeState(dir, { ...state, name: settings.name, databaseId: settings.databaseId, accountId: accountId || state.accountId, version: release.version, updatedAt: new Date().toISOString() });
  finish(deps, url, dir, `Updated to ${release.version}`);
}

// ── helpers ──────────────────────────────────────────────────────────────

function finish(deps, url, dir, title) {
  deps.log("");
  deps.log(`✓ ${title}`);
  if (url) deps.log(`\n  Dashboard: ${url}\n`);
  else deps.log("\n  Deployed. Find the URL under Workers & Pages in your Cloudflare dashboard.\n");
  deps.log(`  Project folder: ${dir}`);
  deps.log("  Next: add a site, paste the snippet into your <head>, then connect a payment provider under Setup.");
  deps.log("  Update later with: npx plugloop@latest update");
}

function readState(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, STATE_FILE), "utf8")); } catch { return {}; }
}

function writeState(dir, state) {
  const clean = Object.fromEntries(Object.entries(state).filter(([, v]) => v !== undefined));
  fs.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify(clean, null, 2) + "\n");
}

function tail(r) {
  return (r.stderr || r.stdout || "").trim().split("\n").slice(-15).join("\n");
}

