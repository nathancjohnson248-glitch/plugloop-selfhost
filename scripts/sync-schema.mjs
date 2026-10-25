// Writes migrations/0001_init.sql from the SCHEMA string in src/schema.ts.
import { readFileSync, writeFileSync } from "node:fs";
const src = readFileSync(new URL("../src/schema.ts", import.meta.url), "utf8");
const sql = src.match(/SCHEMA = `([\s\S]*?)`;/)[1];
writeFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "-- Generated from src/schema.ts. Edit there, then run: npm run schema:sync\n" + sql.trimStart());
