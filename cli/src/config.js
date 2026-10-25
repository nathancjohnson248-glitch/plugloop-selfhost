// Small helpers for reading and patching wrangler.jsonc without a JSONC dependency.
// Edits are done on the text so comments and formatting survive.

/** Remove // and /* *\/ comments and trailing commas, leaving strings untouched. */
export function stripJsonc(text) {
  let out = "";
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (inStr) {
      out += c;
      if (c === "\\") { out += n ?? ""; i++; }
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === "/" && n === "/") { while (i < text.length && text[i] !== "\n") i++; out += "\n"; continue; }
    if (c === "/" && n === "*") { i += 2; while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++; i++; continue; }
    out += c;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

export function parseJsonc(text) {
  return JSON.parse(stripJsonc(text));
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
export const PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000";

/** Point the DB binding at a database id (and optionally rename the database). */
export function setDatabase(text, { id, name } = {}) {
  const block = /\{[^{}]*"binding"\s*:\s*"DB"[^{}]*\}/;
  const m = text.match(block);
  if (!m) throw new Error('wrangler.jsonc has no D1 binding called "DB"');
  let b = m[0];
  if (id) b = b.replace(/("database_id"\s*:\s*)"[^"]*"/, `$1"${id}"`);
  if (name) b = b.replace(/("database_name"\s*:\s*)"[^"]*"/, `$1"${name}"`);
  return text.replace(m[0], b);
}

/** Change the top-level Worker name (the first "name" key in the file). */
export function setWorkerName(text, name) {
  return text.replace(/("name"\s*:\s*)"[^"]*"/, `$1"${name}"`);
}

/** Insert or replace a top-level key right after "name". value is any JSON value. */
export function setTopLevel(text, key, value) {
  const json = JSON.stringify(value);
  const existing = new RegExp(`("${key}"\\s*:\\s*)("[^"]*"|\\[[^\\]]*\\]|\\{[^{}]*\\}|[^,\\n]+)`);
  if (existing.test(text)) return text.replace(existing, `$1${json}`);
  return text.replace(/("name"\s*:\s*"[^"]*",?)/, (line) => `${line.endsWith(",") ? line : line + ","}\n  "${key}": ${json},`);
}

/** Set string vars that already exist in the file's "vars" block. Unknown keys are ignored. */
export function setVars(text, vars = {}) {
  const m = text.match(/"vars"\s*:\s*\{[^{}]*\}/);
  if (!m) return text;
  let b = m[0];
  for (const [k, v] of Object.entries(vars)) {
    b = b.replace(new RegExp(`("${k}"\\s*:\\s*)"[^"]*"`), `$1${JSON.stringify(String(v))}`);
  }
  return text.replace(m[0], b);
}

/** The settings a user owns in their config, which an update must carry over. */
export function userSettings(text) {
  const cfg = parseJsonc(text);
  const db = (cfg.d1_databases || []).find((d) => d.binding === "DB") || {};
  const keep = {};
  for (const k of ["account_id", "routes", "route"]) if (cfg[k] !== undefined) keep[k] = cfg[k];
  return { name: cfg.name, databaseId: db.database_id, databaseName: db.database_name, vars: cfg.vars || {}, keep };
}

/** Apply a user's settings onto a fresh release's wrangler.jsonc. */
export function applyUserSettings(text, s) {
  let t = text;
  if (s.name) t = setWorkerName(t, s.name);
  t = setDatabase(t, { id: s.databaseId, name: s.databaseName });
  t = setVars(t, s.vars);
  for (const [k, v] of Object.entries(s.keep || {})) t = setTopLevel(t, k, v);
  return t;
}

/** Pull the database id out of `wrangler d1 create` output. */
export function parseCreatedId(output) {
  const m = output.match(/"?database_id"?\s*[:=]\s*"([^"]+)"/) || output.match(UUID);
  return m ? (m[1] || m[0]) : null;
}

/** First workers.dev (or custom) https URL in `wrangler deploy` output. */
export function parseDeployUrl(output) {
  const m = output.match(/https:\/\/[A-Za-z0-9.-]+\.workers\.dev\b/) || output.match(/https:\/\/[^\s'"]+/);
  return m ? m[0] : null;
}
