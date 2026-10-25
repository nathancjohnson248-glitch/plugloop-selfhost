#!/usr/bin/env node
import { createRequire } from "node:module";
import { main } from "../src/cli.js";
import { realDeps } from "../src/deps.js";

const [major] = process.versions.node.split(".").map(Number);
if (major < 18) {
  console.error(`plugloop needs Node.js 18 or newer (you have ${process.versions.node}).`);
  process.exit(1);
}
const { version } = createRequire(import.meta.url)("../package.json");
process.exitCode = await main(process.argv.slice(2), realDeps(version));
