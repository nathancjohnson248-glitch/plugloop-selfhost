import type { WebhookAdapter } from "../lib/providers/types";
import { snippet, type SiteLite } from "./dashboard";
import { Layout, TopBar } from "./layout";

function Brand() {
  return (
    <a class="brand" href="/" style="margin-bottom:28px">
      <img src="/mark.svg" alt="" width="26" height="26" />
      plugloop <small>self-hosted</small>
    </a>
  );
}

export function LoginPage(props: { error?: string }) {
  return (
    <Layout title="Log in">
      <main class="wrap">
        <div class="narrow">
          <Brand />
          <h1 style="font-size:28px;margin-bottom:6px">Log in</h1>
          <p class="muted" style="margin:0 0 22px">Your dashboard, on your own Cloudflare account.</p>
          {props.error ? <p class="alert bad" role="alert">{props.error}</p> : null}
          <form method="post" action="/login">
            <div class="field">
              <label for="password">Password</label>
              <input id="password" name="password" type="password" autocomplete="current-password" required autofocus />
            </div>
            <button class="btn" type="submit" style="width:100%">Log in</button>
          </form>
          <p class="hint" style="margin-top:16px">Forgot it? Set a new one with <code>npx wrangler secret put ADMIN_PASSWORD</code>.</p>
        </div>
      </main>
    </Layout>
  );
}

export function FirstRunPage(props: { error?: string }) {
  return (
    <Layout title="Set up">
      <main class="wrap">
        <div class="narrow">
          <Brand />
          <h1 style="font-size:28px;margin-bottom:6px">Pick a password</h1>
          <p class="muted" style="margin:0 0 22px">This Plugloop has no owner yet. The password you choose here protects the dashboard. Only one person can do this, once.</p>
          {props.error ? <p class="alert bad" role="alert">{props.error}</p> : null}
          <form method="post" action="/first-run">
            <div class="field">
              <label for="password">Password</label>
              <input id="password" name="password" type="password" autocomplete="new-password" minlength={10} required autofocus />
              <p class="hint">At least 10 characters.</p>
            </div>
            <div class="field">
              <label for="confirm">Repeat it</label>
              <input id="confirm" name="confirm" type="password" autocomplete="new-password" minlength={10} required />
            </div>
            <button class="btn" type="submit" style="width:100%">Save and open the dashboard</button>
          </form>
          <p class="hint" style="margin-top:16px">Prefer a secret? Run <code>npx wrangler secret put ADMIN_PASSWORD</code> instead; it always wins over this one.</p>
        </div>
      </main>
    </Layout>
  );
}

export function SitesPage(props: { sites: (SiteLite & { events: number })[]; origin: string; error?: string; added?: string }) {
  return (
    <Layout title="Sites" nav={<TopBar current="sites" />}>
      <main class="wrap" style="max-width:820px">
        <h1 style="font-size:28px">Sites</h1>
        <p class="muted" style="margin:6px 0 24px">Add as many as you like. Each one gets its own key; events and sales never mix.</p>
        {props.error ? <p class="alert bad" role="alert">{props.error}</p> : null}
        {props.added ? <p class="alert good" role="status">Added {props.added}. Paste its snippet into your site's &lt;head&gt;.</p> : null}
        <div style="display:flex;flex-direction:column;gap:14px;margin-bottom:28px" data-testid="site-list">
          {props.sites.map((s) => (
            <section class="card">
              <div style="display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:6px 16px">
                <h2 style="font-size:17px">
                  <a href={`/?site=${s.id}`} style="text-decoration:none">{s.name}</a> <span class="num faint" style="font-size:13px;font-weight:400">{s.domain}</span>
                </h2>
                <span class="num faint" style="font-size:12px">{s.events ? `${s.events.toLocaleString("en-US")} events` : "no events yet"}</span>
              </div>
              <pre>
                <code>{snippet(props.origin, s.public_key)}</code>
              </pre>
              <details style="margin-top:10px">
                <summary class="small muted" style="cursor:pointer">Remove this site</summary>
                <form method="post" action={`/sites/${s.id}/delete`} style="margin-top:10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">
                  <input type="text" name="confirm" placeholder={`Type ${s.domain} to confirm`} style="max-width:280px" aria-label="Confirm domain" />
                  <button class="btn ghost" type="submit" style="color:var(--danger)">Delete site and its data</button>
                </form>
              </details>
            </section>
          ))}
        </div>
        <section class="card">
          <h2 style="font-size:17px;margin-bottom:14px">Add a site</h2>
          <form method="post" action="/sites">
            <div class="field">
              <label for="name">Name</label>
              <input id="name" name="name" type="text" placeholder="My SaaS" required maxlength={80} />
            </div>
            <div class="field">
              <label for="domain">Domain</label>
              <input id="domain" name="domain" type="text" placeholder="example.com" required maxlength={253} />
              <p class="hint">Events are only accepted from this domain and its subdomains.</p>
            </div>
            <button class="btn" type="submit">Add site</button>
          </form>
        </section>
      </main>
    </Layout>
  );
}

export function SetupPage(props: { origin: string; providers: { a: WebhookAdapter; configured: boolean; lastAt: string | null; lastType: string | null }[]; auth: "env" | "db"; sites: SiteLite[] }) {
  return (
    <Layout title="Setup" nav={<TopBar current="setup" />}>
      <main class="wrap" style="max-width:820px">
        <h1 style="font-size:28px">Setup</h1>
        <p class="muted" style="margin:6px 0 24px">
          Connect each payment provider you use with a webhook. Sales then appear next to the visit that made them; refunds and chargebacks come off what you kept.
        </p>

        <section class="card" style="margin-bottom:14px">
          <h2 style="font-size:17px">How sales get matched to visits</h2>
          <p class="small muted" style="margin:6px 0 0">
            The tracker tags Stripe Payment Links, Lemon Squeezy, Dodo and Polar checkout links automatically. With your own checkout code, pass <code>plugloop.metadata()</code> as the checkout's metadata (Stripe: <code>metadata</code>, Paddle: <code>customData</code>).
          </p>
        </section>

        <div style="display:flex;flex-direction:column;gap:14px" data-testid="providers">
          {props.providers.map(({ a, configured, lastAt, lastType }) => {
            const url = `${props.origin}/api/webhooks/${a.id}`;
            return (
              <section class="card" data-testid={`provider-${a.id}`}>
                <div style="display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:6px 16px">
                  <h2 style="font-size:17px">{a.label}</h2>
                  <span class={`pill ${configured ? "" : ""}`} style={configured ? "color:var(--money);border-color:#bfe0cf;background:var(--money-wash)" : ""}>
                    {configured ? (lastAt ? `connected · last event ${lastAt}` : "secret set · waiting for first event") : "not connected"}
                  </span>
                </div>
                <ol class="small" style="margin:10px 0 0;padding-left:18px;color:var(--ink-2);display:flex;flex-direction:column;gap:6px">
                  <li>{a.where}</li>
                  <li>
                    Endpoint URL:
                    <pre>
                      <code>{url}</code>
                    </pre>
                  </li>
                  <li>
                    Events: <span class="num" style="color:var(--ink);overflow-wrap:anywhere">{a.events.join(", ")}</span>
                  </li>
                  <li>
                    Save the signing secret as a Worker secret:
                    <pre>
                      <code>npx wrangler secret put {a.secretVar}</code>
                    </pre>
                    <span class="hint" style="display:block">Or in the Cloudflare dashboard: Workers → plugloop → Settings → Variables and Secrets → Add → Secret.</span>
                  </li>
                </ol>
                {lastType ? <p class="hint">Last event type: {lastType}</p> : null}
              </section>
            );
          })}
        </div>

        {props.sites.length > 1 ? (
          <section class="card" style="margin-top:14px">
            <h2 style="font-size:17px">Several sites, one payment account?</h2>
            <p class="small muted" style="margin:6px 0 0">
              Sales go to the site of the visit that made them. A sale with no tracked visit goes to the first site, unless you pin the webhook to a site by adding <code>?site=KEY</code> to its URL, for example <code>{props.origin}/api/webhooks/stripe?site={props.sites[0].public_key}</code>.
            </p>
          </section>
        ) : null}

        <section class="card" style="margin-top:14px">
          <h2 style="font-size:17px">Password</h2>
          <p class="small muted" style="margin:6px 0 0">
            {props.auth === "env" ? "Set by the ADMIN_PASSWORD secret." : "Chosen on first run and stored hashed in D1."} Change it with <code>npx wrangler secret put ADMIN_PASSWORD</code>; everyone is signed out when it changes.
          </p>
        </section>
      </main>
    </Layout>
  );
}
