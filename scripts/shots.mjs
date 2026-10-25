// Screenshots of the dashboard at 375 and 1440 against `wrangler dev` with seeded data.
// Usage: BASE=http://127.0.0.1:8799 PASSWORD=... CHROMIUM=/path/to/chromium node scripts/shots.mjs
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:8799";
const PASSWORD = process.env.PASSWORD ?? "local-demo-password";
const OUT = new URL("../shots/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox", "--disable-gpu"] });
const pages = (process.env.PAGES ?? "dashboard,setup,sites,login").split(",");
for (const width of [375, 1440]) {
  const ctx = await browser.newContext({ viewport: { width, height: width > 800 ? 900 : 812 }, deviceScaleFactor: width > 800 ? 1 : 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  if (pages.includes("login")) {
    await page.goto(`${BASE}/login`);
    await page.screenshot({ path: `${OUT}login-${width}.png`, fullPage: true });
  }
  await page.goto(`${BASE}/login`);
  await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("button[type=submit]")]);
  const targets = { dashboard: "/?period=30d", "dashboard-7d": "/?period=7d&tab=channel", setup: "/setup", sites: "/sites" };
  for (const [name, path] of Object.entries(targets)) {
    if (!pages.includes(name.split("-")[0])) continue;
    await page.goto(`${BASE}${path}`);
    await page.evaluate(() => document.fonts.ready);
    // Anything wider than the viewport is a layout bug.
    const overflow = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const bad = [];
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.width && (r.right > vw + 1 || r.left < -1)) bad.push(`${el.tagName.toLowerCase()}.${el.className?.baseVal ?? el.className}`.slice(0, 80));
      }
      return { scroll: document.documentElement.scrollWidth > vw, bad: bad.slice(0, 10) };
    });
    console.log(width, name, JSON.stringify(overflow));
    await page.screenshot({ path: `${OUT}${name}-${width}.png`, fullPage: true });
  }
  if (errors.length) console.log("console errors", width, errors);
  await ctx.close();
}
await browser.close();
