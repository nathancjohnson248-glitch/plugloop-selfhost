import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { main, parseArgs, resolveRelease, STATE_FILE } from "../src/cli.js";
import { parseJsonc } from "../src/config.js";
import { DB_ID, fakeDeps, makeRelease, tmp, wranglerCalls } from "./helpers.js";

const cfgOf = (dir) => parseJsonc(fs.readFileSync(path.join(dir, "wrangler.jsonc"), "utf8"));

test("parseArgs: default command, subcommand and flags", () => {
  assert.deepEqual(parseArgs([]), { command: "install", flags: {} });
  assert.deepEqual(parseArgs(["update", "--dir", "x", "--force"]), { command: "update", flags: { dir: "x", force: true } });
  assert.deepEqual(parseArgs(["--name=shop"]), { command: "install", flags: { name: "shop" } });
});

test("install: full happy path in order", async () => {
  const cwd = tmp();
  const deps = fakeDeps({ cwd, release: makeRelease("v0.2.0") });
  assert.equal(await main([], deps), 0);
  const dir = path.join(cwd, "plugloop");

  assert.deepEqual(wranglerCalls(deps), [
    "whoami --json",
    "d1 list --json",
    "d1 create plugloop --update-config=false",
    "d1 migrations apply DB --remote",
    `deploy --secrets-file ${deps.secretsSeen[0].file}`,
  ]);
  // npm install runs before any wrangler call, inside the project folder
  const npmIdx = deps.calls.findIndex((c) => c.cmd === "npm");
  const firstWrangler = deps.calls.findIndex((c) => c.cmd === "wrangler");
  assert.ok(npmIdx >= 0 && npmIdx < firstWrangler);
  assert.equal(deps.calls[npmIdx].opts.cwd, dir);

  assert.equal(cfgOf(dir).d1_databases[0].database_id, DB_ID);
  assert.deepEqual(deps.secretsSeen[0].data, { ADMIN_PASSWORD: "hunter2hunter2" });
  assert.equal(fs.existsSync(deps.secretsSeen[0].file), false, "secrets file is deleted after deploy");

  const state = JSON.parse(fs.readFileSync(path.join(dir, STATE_FILE), "utf8"));
  assert.equal(state.databaseId, DB_ID);
  assert.equal(state.version, "v0.2.0");
  assert.ok(deps.logs.some((l) => l.includes("Dashboard: https://plugloop.nathan.workers.dev")));
});

test("install: runs wrangler login when not logged in", async () => {
  const deps = fakeDeps({ cwd: tmp(), release: makeRelease(), wrangler: { loggedIn: false } });
  assert.equal(await main([], deps), 0);
  const login = deps.calls.find((c) => c.args?.[0] === "login");
  assert.ok(login, "login was called");
  assert.equal(login.opts.interactive, true, "login gets the terminal so the browser flow works");
  assert.deepEqual(wranglerCalls(deps).slice(0, 3), ["whoami --json", "login", "whoami --json"]);
});

test("install: fails cleanly when login is abandoned", async () => {
  const deps = fakeDeps({ cwd: tmp(), release: makeRelease(), wrangler: { loggedIn: false, login: { code: 1, stdout: "", stderr: "cancelled" } } });
  assert.equal(await main([], deps), 1);
  assert.ok(deps.logs.some((l) => /wrangler login did not finish/.test(l)));
  assert.ok(!wranglerCalls(deps).some((c) => c.startsWith("d1")));
});

test("install: reuses an existing D1 database instead of creating one", async () => {
  const existing = "99999999-8888-4777-8666-555555555555";
  const deps = fakeDeps({ cwd: tmp(), release: makeRelease(), wrangler: { databases: [{ uuid: existing, name: "plugloop" }] } });
  assert.equal(await main([], deps), 0);
  assert.ok(!wranglerCalls(deps).some((c) => c.startsWith("d1 create")));
  assert.equal(cfgOf(path.join(deps.cwd, "plugloop")).d1_databases[0].database_id, existing);
});

test("install: declining reuse of an existing database stops before deploy", async () => {
  const deps = fakeDeps({ cwd: tmp(), release: makeRelease(), answers: { confirm: false }, wrangler: { databases: [{ uuid: DB_ID, name: "plugloop" }] } });
  assert.equal(await main([], deps), 1);
  assert.ok(!wranglerCalls(deps).some((c) => c.startsWith("deploy")));
});

test("install: falls back to d1 list when create output has no id", async () => {
  let listed = 0;
  const deps = fakeDeps({
    cwd: tmp(), release: makeRelease(),
    wrangler: {
      "d1 create": { code: 0, stdout: "Created!", stderr: "" },
      "d1 list": () => ({ code: 0, stdout: JSON.stringify(listed++ ? [{ uuid: DB_ID, name: "plugloop" }] : []), stderr: "" }),
    },
  });
  assert.equal(await main([], deps), 0);
  assert.equal(cfgOf(path.join(deps.cwd, "plugloop")).d1_databases[0].database_id, DB_ID);
});

test("install: --name renames the Worker and the database", async () => {
  const deps = fakeDeps({ cwd: tmp(), release: makeRelease() });
  assert.equal(await main(["--name", "shop-stats", "--dir", "here"], deps), 0);
  const cfg = cfgOf(path.join(deps.cwd, "here"));
  assert.equal(cfg.name, "shop-stats");
  assert.equal(cfg.d1_databases[0].database_name, "shop-stats");
  assert.ok(wranglerCalls(deps).includes("d1 create shop-stats --update-config=false"));
});

test("install: rejects a bad --name before touching anything", async () => {
  const deps = fakeDeps({ cwd: tmp(), release: makeRelease() });
  assert.equal(await main(["--name", "Bad Name"], deps), 1);
  assert.equal(deps.calls.length, 0);
});

test("install: several Cloudflare accounts asks which one and pins it", async () => {
  const deps = fakeDeps({
    cwd: tmp(), release: makeRelease(),
    answers: { select: "acc2" },
    wrangler: { accounts: [{ id: "acc1", name: "Personal" }, { id: "acc2", name: "Work" }] },
  });
  assert.equal(await main([], deps), 0);
  assert.ok(deps.calls.some((c) => c.select));
  const create = deps.calls.find((c) => c.args?.[1] === "create");
  assert.equal(create.opts.env.CLOUDFLARE_ACCOUNT_ID, "acc2");
  assert.equal(cfgOf(path.join(deps.cwd, "plugloop")).account_id, "acc2");
});

test("install: password must match and be 8+ characters", async () => {
  const deps = fakeDeps({ cwd: tmp(), release: makeRelease(), answers: { passwords: ["short", "longenough1", "different1", "longenough1", "longenough1"] } });
  assert.equal(await main([], deps), 0);
  assert.deepEqual(deps.secretsSeen[0].data, { ADMIN_PASSWORD: "longenough1" });
});

test("install: PLUGLOOP_ADMIN_PASSWORD skips the prompt", async () => {
  const deps = fakeDeps({ cwd: tmp(), release: makeRelease(), env: { PLUGLOOP_ADMIN_PASSWORD: "from-env-123" } });
  assert.equal(await main([], deps), 0);
  assert.ok(!deps.calls.some((c) => c.password));
  assert.deepEqual(deps.secretsSeen[0].data, { ADMIN_PASSWORD: "from-env-123" });
});

test("install: refuses a non-empty folder and an existing install", async () => {
  const cwd = tmp();
  fs.mkdirSync(path.join(cwd, "plugloop"));
  fs.writeFileSync(path.join(cwd, "plugloop", "x.txt"), "x");
  const deps = fakeDeps({ cwd, release: makeRelease() });
  assert.equal(await main([], deps), 1);
  assert.ok(deps.logs.some((l) => /not empty/.test(l)));

  fs.writeFileSync(path.join(cwd, "plugloop", STATE_FILE), "{}");
  const deps2 = fakeDeps({ cwd, release: makeRelease() });
  assert.equal(await main([], deps2), 1);
  assert.ok(deps2.logs.some((l) => /npx plugloop@latest update/.test(l)));
});

test("install: migration failure stops before the deploy and shows wrangler's error", async () => {
  const deps = fakeDeps({ cwd: tmp(), release: makeRelease(), wrangler: { "d1 migrations": { code: 1, stdout: "", stderr: "D1_ERROR: boom" } } });
  assert.equal(await main([], deps), 1);
  assert.ok(deps.logs.some((l) => /D1_ERROR: boom/.test(l)));
  assert.ok(!wranglerCalls(deps).some((c) => c.startsWith("deploy")));
});

test("install: deploy failure still deletes the secrets file", async () => {
  const deps = fakeDeps({ cwd: tmp(), release: makeRelease(), wrangler: { deploy: { code: 1, stdout: "", stderr: "auth error" } } });
  assert.equal(await main([], deps), 1);
  assert.equal(fs.existsSync(deps.secretsSeen[0].file), false);
});

test("resolveRelease: latest release tag, else main's commit", async () => {
  const withRel = fakeDeps({ latest: "v1.2.3" });
  assert.deepEqual(await resolveRelease(withRel), { ref: "v1.2.3", version: "v1.2.3" });
  const noRel = fakeDeps({ latest: null });
  assert.deepEqual(await resolveRelease(noRel), { ref: "0123456789abcdef0123456789abcdef01234567", version: "main@0123456" });
  assert.deepEqual(await resolveRelease(noRel, "v0.9.0"), { ref: "v0.9.0", version: "v0.9.0" });
});

async function installed(version = "v0.1.0") {
  const cwd = tmp();
  const deps = fakeDeps({ cwd, release: makeRelease(version), latest: version });
  assert.equal(await main([], deps), 0);
  return cwd;
}

test("update: pulls the new release, keeps DB/name/vars, migrates and redeploys without a password", async () => {
  const cwd = await installed("v0.1.0");
  const dir = path.join(cwd, "plugloop");
  // the user customised their config and has local files
  const cfgPath = path.join(dir, "wrangler.jsonc");
  fs.writeFileSync(cfgPath, fs.readFileSync(cfgPath, "utf8").replace('"CURRENCY": "USD"', '"CURRENCY": "EUR"'));
  fs.writeFileSync(path.join(dir, ".dev.vars"), "ADMIN_PASSWORD=local");
  fs.mkdirSync(path.join(dir, "src", "old"), { recursive: true });

  const release = makeRelease("v0.2.0", { "migrations/0002_more.sql": "select 1;" });
  const deps = fakeDeps({ cwd: dir, release, latest: "v0.2.0" });
  assert.equal(await main(["update"], deps), 0);

  assert.deepEqual(wranglerCalls(deps), ["whoami --json", "d1 migrations apply DB --remote", "deploy"]);
  assert.equal(deps.secretsSeen.length, 0, "no password prompt or secret on update");
  assert.ok(!deps.calls.some((c) => c.password));
  const cfg = cfgOf(dir);
  assert.equal(cfg.d1_databases[0].database_id, DB_ID);
  assert.equal(cfg.vars.CURRENCY, "EUR");
  assert.match(fs.readFileSync(path.join(dir, "src", "index.ts"), "utf8"), /v0\.2\.0/);
  assert.equal(fs.existsSync(path.join(dir, "src", "old")), false, "stale source removed");
  assert.ok(fs.existsSync(path.join(dir, "migrations", "0002_more.sql")));
  assert.equal(fs.readFileSync(path.join(dir, ".dev.vars"), "utf8"), "ADMIN_PASSWORD=local");
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, STATE_FILE), "utf8")).version, "v0.2.0");
});

test("update: finds ./plugloop from the parent folder", async () => {
  const cwd = await installed("v0.1.0");
  const deps = fakeDeps({ cwd, release: makeRelease("v0.2.0"), latest: "v0.2.0" });
  assert.equal(await main(["update"], deps), 0);
  assert.ok(wranglerCalls(deps).includes("deploy"));
});

test("update: already on latest does nothing unless --force", async () => {
  const cwd = await installed("v0.1.0");
  const deps = fakeDeps({ cwd, release: makeRelease("v0.1.0"), latest: "v0.1.0" });
  assert.equal(await main(["update"], deps), 0);
  assert.deepEqual(wranglerCalls(deps), []);
  const forced = fakeDeps({ cwd, release: makeRelease("v0.1.0"), latest: "v0.1.0" });
  assert.equal(await main(["update", "--force"], forced), 0);
  assert.ok(wranglerCalls(forced).includes("deploy"));
});

test("update: keeps the pinned Cloudflare account without asking again", async () => {
  const cwd = tmp();
  const accounts = [{ id: "acc1", name: "Personal" }, { id: "acc2", name: "Work" }];
  assert.equal(await main([], fakeDeps({ cwd, release: makeRelease("v0.1.0"), latest: "v0.1.0", answers: { select: "acc2" }, wrangler: { accounts } })), 0);
  const deps = fakeDeps({ cwd, release: makeRelease("v0.2.0"), latest: "v0.2.0", wrangler: { accounts } });
  assert.equal(await main(["update"], deps), 0);
  assert.ok(!deps.calls.some((c) => c.select));
  assert.equal(deps.calls.find((c) => c.args?.[0] === "deploy").opts.env.CLOUDFLARE_ACCOUNT_ID, "acc2");
  assert.equal(cfgOf(path.join(cwd, "plugloop")).account_id, "acc2");
});

test("update: no install found gives a helpful error", async () => {
  const deps = fakeDeps({ cwd: tmp(), release: makeRelease() });
  assert.equal(await main(["update"], deps), 1);
  assert.ok(deps.logs.some((l) => /No Plugloop install found/.test(l)));
});

test("unknown command and --help", async () => {
  const deps = fakeDeps({ cwd: tmp() });
  assert.equal(await main(["frobnicate"], deps), 1);
  assert.equal(await main(["--help"], deps), 0);
  assert.ok(deps.logs.some((l) => l.includes("npx plugloop@latest update")));
});
