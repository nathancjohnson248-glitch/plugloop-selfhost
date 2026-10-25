# Plugloop Self-Host on Cloudflare

Revenue-first web analytics that runs entirely in **your own Cloudflare account**: one Worker, one D1 database, free-tier friendly. See which sources, pages and checkouts turn into money you actually *kept*, after refunds, chargebacks and cancellations.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/nathancjohnson248-glitch/plugloop-selfhost)

> The Deploy button only works once this repository is public (Cloudflare can't clone private repos). Until then, use the manual steps below.

## What you get

- **`/js/script.js`**: a ~3 KB tracker. No cookies, no localStorage, no consent banner. Tags Stripe Payment Links, Lemon Squeezy, Dodo and Polar checkout links so sales match the visit that made them.
- **`/api/collect`**: accepts events only from each site's own domain; drops bots.
- **`/api/webhooks/<provider>`**: signed webhooks for **Stripe, Polar, Lemon Squeezy, Dodo Payments and Paddle**, with signature checks, a 5-minute replay window and de-duplication. Sales, refunds, chargebacks and cancelled subscriptions.
- **Dashboard**: "You kept $X", what changed, money flow (sources → pages → checkout → kept / refunded / never paid), sources ranked by money kept, leaks, traffic, pages, recent sales. Unlimited sites and events.
- **Single owner**: password from a Worker secret or picked on first visit; signed HttpOnly session cookie.
- **`/api/stats?site=KEY&period=7d`**: the same numbers as JSON (signed-in owner only).

## Privacy

- Visitors get **no cookies**. A random session id lives in `sessionStorage` and disappears when the tab closes.
- The visitor id is `sha256(daily random salt + site + IP + user agent)`. The **IP is never stored**, and the salt is replaced every day (and deleted by the daily cron), so old ids can't be linked back to anyone.
- Country comes from Cloudflare's edge, not from an IP lookup.
- Events older than `RETENTION_DAYS` (default 400) are deleted daily.

## Deploy with the button

1. Click **Deploy to Cloudflare** above. Cloudflare copies the repo into your GitHub, creates the D1 database, runs the migrations and deploys.
2. When it asks for `ADMIN_PASSWORD`, set your dashboard password (or leave it empty and pick one on first visit).
3. Open `https://plugloop.<your-subdomain>.workers.dev`, add a site, paste the snippet into your `<head>`.
4. Go to **Setup** and add a webhook for each payment provider you use (see below).

## Deploy manually

```bash
git clone https://github.com/nathancjohnson248-glitch/plugloop-selfhost && cd plugloop-selfhost
npm i
npx wrangler login
npx wrangler d1 create plugloop          # copy the database_id it prints into wrangler.jsonc
npx wrangler d1 migrations apply DB --remote
npx wrangler secret put ADMIN_PASSWORD   # optional: otherwise pick it on first visit
npx wrangler deploy
```

(`npm run deploy` runs the migration and the deploy together.)

> **First-run note:** if you skip `ADMIN_PASSWORD`, the first person to open `/first-run` on your new Worker chooses the password. Open it right after deploying, or set the secret.

## Connect payment providers

In the dashboard's **Setup** page each provider shows its exact endpoint URL and events. In short:

| Provider | Endpoint | Secret |
| --- | --- | --- |
| Stripe | `/api/webhooks/stripe` | `npx wrangler secret put STRIPE_WEBHOOK_SECRET` (the `whsec_…` signing secret) |
| Polar | `/api/webhooks/polar` | `POLAR_WEBHOOK_SECRET` |
| Lemon Squeezy | `/api/webhooks/lemonsqueezy` | `LEMONSQUEEZY_WEBHOOK_SECRET` (the signing secret you typed) |
| Dodo Payments | `/api/webhooks/dodo` | `DODO_WEBHOOK_SECRET` |
| Paddle | `/api/webhooks/paddle` | `PADDLE_WEBHOOK_SECRET` (notification destination secret) |

A webhook for a provider without its secret answers 404; a bad signature answers 401.

With your own checkout code (instead of payment links), pass `plugloop.metadata()` into the checkout's metadata (Stripe `metadata`, Paddle `customData`, Polar `customer_metadata`, Dodo `metadata`, Lemon Squeezy `checkout_data.custom`).

Several sites on one payment account: sales go to the site of the visit that made them. Add `?site=KEY` to a webhook URL to pin sales with no tracked visit to one site.

## Configuration

`wrangler.jsonc` → `vars`:

| Var | Default | |
| --- | --- | --- |
| `CURRENCY` | `USD` | Display currency. Amounts are not converted between currencies. |
| `RETENTION_DAYS` | `400` | Raw events older than this are deleted daily (minimum 30). |
| `INCLUDE_TEST_SALES` | `false` | Show test-mode sales in the dashboard. |

Optional secret `SESSION_SECRET` signs the session cookie; without it a random key is generated and kept in D1.

## Free tier

Each pageview is one event row plus one session upsert. D1's free plan (100k rows written and 5M rows read per day) comfortably covers a few thousand pageviews a day; the 30-day dashboard reads scale with your traffic, so very busy sites should move to Workers Paid ($5/month). Static files (fonts, logo) are served by Workers Assets at no cost.

## Develop

```bash
npm i
cp .dev.vars.example .dev.vars           # set ADMIN_PASSWORD for local
npm run db:migrate:local
npm run seed:local                       # 60 days of demo data
npm run dev                              # http://localhost:8787
npm test                                 # vitest inside workerd (miniflare) with a real local D1
npm run typecheck
```

Screenshots: `CHROMIUM=/path/to/chromium npm run shots` with `wrangler dev` running (writes `shots/`).

## Architecture

- **Hono** on a single Worker, server-rendered with `hono/jsx`. No client framework; the page works without JavaScript.
- The dashboard math (`src/lib/dash/*`: derive, insights, money-flow model and Sankey layout, source names) is copied **unchanged** from the hosted Plugloop app, so numbers and wording match.
- Provider webhook parsing (`src/lib/providers/*`) is ported from the hosted adapters, minus API-key connect/backfill; signatures are checked with Web Crypto.
- `src/schema.ts` is the schema; the Worker creates its tables on first request if migrations were never run, and `migrations/0001_init.sql` is generated from it (`npm run schema:sync`). Both are idempotent.

## Licence

Undecided. See `LICENSE`.
