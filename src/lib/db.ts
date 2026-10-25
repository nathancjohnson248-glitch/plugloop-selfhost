import { SCHEMA_STATEMENTS } from "../schema";
import { randomHex } from "./crypto";

let ready: Promise<void> | null = null;

/**
 * Create the tables on first use. A Worker deployed with the Deploy button (or without running
 * migrations) still works; every statement is IF NOT EXISTS so this is a no-op afterwards.
 */
export function ensureSchema(db: D1Database): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const hit = await db.prepare("SELECT value FROM settings WHERE key = 'schema'").first<{ value: string }>().catch(() => null);
      if (hit?.value === "1") return;
      await db.batch(SCHEMA_STATEMENTS.map((s) => db.prepare(s)));
      await db.prepare("INSERT INTO settings (key, value) VALUES ('schema', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

/** For tests: forget that the schema was checked. */
export const resetSchemaFlag = () => {
  ready = null;
  saltCache = null;
};

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, value).run();
}

/** Insert only if missing; returns the value that ended up stored (first writer wins). */
export async function setSettingOnce(db: D1Database, key: string, value: string): Promise<string> {
  await db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING").bind(key, value).run();
  return (await getSetting(db, key)) ?? value;
}

let saltCache: { day: string; salt: string } | null = null;

/**
 * The visitor-hash salt for a UTC day. A new random salt replaces yesterday's the first time it is
 * needed, so yesterday's hashes can no longer be recomputed from an IP (same as hosted Plugloop).
 */
export async function dailySalt(db: D1Database, now = new Date()): Promise<string> {
  const day = now.toISOString().slice(0, 10);
  if (saltCache?.day === day) return saltCache.salt;
  const current = await getSetting(db, "salt");
  let parsed: { day: string; salt: string } | null = null;
  try {
    parsed = current ? (JSON.parse(current) as { day: string; salt: string }) : null;
  } catch {}
  if (!parsed || parsed.day < day) {
    const next = JSON.stringify({ day, salt: randomHex(32) });
    // Only replace an older day's salt, so concurrent isolates agree on one value.
    await db
      .prepare("INSERT INTO settings (key, value) VALUES ('salt', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1 WHERE json_extract(settings.value, '$.day') < ?2")
      .bind(next, day)
      .run();
    parsed = JSON.parse((await getSetting(db, "salt"))!) as { day: string; salt: string };
  }
  saltCache = parsed;
  return parsed.salt;
}
