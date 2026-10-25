# /self-host section for plugloop.app (draft, not merged)

**Eyebrow:** Self-host

**Heading:** Run Plugloop in your own Cloudflare account

1. One click deploys the tracker, your payment webhooks and the money ledger to a Worker and D1 database you own.
2. No cookies, IPs hashed with a salt that changes daily, and your data never leaves your account.
3. Fits Cloudflare's free tier, with unlimited sites and events.

**Button:** Deploy to Cloudflare
→ `https://deploy.workers.cloudflare.com/?url=https://github.com/nathancjohnson248-glitch/plugloop-selfhost`
(use Cloudflare's official button image: `https://deploy.workers.cloudflare.com/button`)

**Small print under the button:** Stripe, Polar, Lemon Squeezy, Dodo and Paddle. Setup takes about five minutes.

---
Notes for whoever wires this in:
- The button only works once the repo is public. Until then, hide the section or link to the README instead.
- Pricing line is intentionally left out: licensing (free/open source vs $19 lifetime) isn't decided yet.
