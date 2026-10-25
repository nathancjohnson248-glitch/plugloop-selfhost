import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyUserSettings, parseCreatedId, parseDeployUrl, parseJsonc, setDatabase, setTopLevel, setVars, setWorkerName, stripJsonc, userSettings,
} from "../src/config.js";

const real = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../wrangler.jsonc"), "utf8");
const ID = "11111111-2222-4333-8444-555555555555";

test("parses the repo's real wrangler.jsonc (comments included)", () => {
  const cfg = parseJsonc(real);
  assert.equal(cfg.name, "plugloop");
  assert.equal(cfg.d1_databases[0].binding, "DB");
});

test("stripJsonc keeps // inside strings and drops trailing commas", () => {
  const out = JSON.parse(stripJsonc('{ "u": "https://x.dev/a", // c\n /* b */ "a": [1,2,], }'));
  assert.deepEqual(out, { u: "https://x.dev/a", a: [1, 2] });
});

test("setDatabase writes the id and keeps comments", () => {
  const t = setDatabase(real, { id: ID, name: "pl2" });
  const db = parseJsonc(t).d1_databases[0];
  assert.equal(db.database_id, ID);
  assert.equal(db.database_name, "pl2");
  assert.match(t, /One D1 database holds sites/);
});

test("setDatabase refuses a config without a DB binding", () => {
  assert.throws(() => setDatabase('{ "name": "x" }', { id: ID }), /DB/);
});

test("setWorkerName only changes the top-level name", () => {
  const cfg = parseJsonc(setWorkerName(real, "my-analytics"));
  assert.equal(cfg.name, "my-analytics");
  assert.equal(cfg.d1_databases[0].database_name, "plugloop");
});

test("setTopLevel inserts and then replaces a key", () => {
  let t = setTopLevel(real, "account_id", "acc9");
  assert.equal(parseJsonc(t).account_id, "acc9");
  t = setTopLevel(t, "account_id", "acc10");
  assert.equal(parseJsonc(t).account_id, "acc10");
  t = setTopLevel(t, "routes", [{ pattern: "a.example.com/*", zone_name: "example.com" }]);
  assert.equal(parseJsonc(t).routes[0].zone_name, "example.com");
});

test("setVars changes known vars and ignores unknown ones", () => {
  const cfg = parseJsonc(setVars(real, { CURRENCY: "EUR", NOPE: "x" }));
  assert.equal(cfg.vars.CURRENCY, "EUR");
  assert.equal(cfg.vars.NOPE, undefined);
});

test("userSettings + applyUserSettings round-trip onto a fresh config", () => {
  let mine = setDatabase(setWorkerName(real, "shop-stats"), { id: ID, name: "shop-stats" });
  mine = setVars(mine, { CURRENCY: "GBP", RETENTION_DAYS: "90" });
  mine = setTopLevel(mine, "account_id", "acc7");
  const merged = parseJsonc(applyUserSettings(real, userSettings(mine)));
  assert.equal(merged.name, "shop-stats");
  assert.equal(merged.account_id, "acc7");
  assert.equal(merged.d1_databases[0].database_id, ID);
  assert.equal(merged.vars.CURRENCY, "GBP");
  assert.equal(merged.vars.RETENTION_DAYS, "90");
});

test("parseCreatedId reads JSON and TOML style output", () => {
  assert.equal(parseCreatedId(`"database_id": "${ID}"`), ID);
  assert.equal(parseCreatedId(`database_id = "${ID}"`), ID);
  assert.equal(parseCreatedId("nothing here"), null);
});

test("parseDeployUrl finds the workers.dev URL", () => {
  assert.equal(parseDeployUrl("Uploaded\n  https://plugloop.me.workers.dev\n"), "https://plugloop.me.workers.dev");
  assert.equal(parseDeployUrl("no url"), null);
});
