import { raw } from "hono/html";
import type { Child } from "hono/jsx";

/** Plugloop's paper-and-ink look: no gradients, no dark mode, no orange. */
export const CSS = `
@font-face{font-family:Geist;src:url(/fonts/Geist-Variable.woff2) format("woff2");font-weight:100 900;font-display:swap}
@font-face{font-family:"Geist Mono";src:url(/fonts/GeistMono-Variable.woff2) format("woff2");font-weight:100 900;font-display:swap}
:root{--paper:#faf8f5;--paper-2:#f4f1ec;--card:#fff;--line:#ece8e1;--line-strong:#ddd7cd;--ink:#14130f;--ink-2:#6b675f;--ink-3:#726d64;
--cobalt:#2b4bff;--cobalt-ink:#1f38c7;--cobalt-wash:#eef1ff;--money:#0f7b4f;--money-wash:#e9f5ef;--danger:#b4321f;--danger-wash:#fbeeeb;
--sans:Geist,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;--mono:"Geist Mono",ui-monospace,"SF Mono",Menlo,monospace;color-scheme:light}
*{box-sizing:border-box}html,body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.45;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
a{color:inherit}::selection{background:var(--cobalt-wash);color:var(--cobalt-ink)}
:focus-visible{outline:2px solid var(--cobalt);outline-offset:2px;border-radius:4px}
.num{font-family:var(--mono);font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.wrap{max-width:1120px;margin:0 auto;padding-left:20px;padding-right:20px}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.top{border-bottom:1px solid var(--line);background:var(--paper)}
.top .wrap{display:flex;align-items:center;gap:16px;min-height:60px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:8px;text-decoration:none;font-weight:650;font-size:17px;letter-spacing:-.02em}
.brand img{width:26px;height:26px}
.brand small{font-weight:500;font-size:11px;color:var(--ink-3);border:1px solid var(--line-strong);border-radius:999px;padding:1px 7px;letter-spacing:0}
.nav{display:flex;gap:4px;margin-left:auto;align-items:center;flex-wrap:wrap}
.nav a,.nav button{font:inherit;font-size:13.5px;color:var(--ink-2);text-decoration:none;padding:8px 10px;border-radius:8px;background:none;border:0;cursor:pointer;min-height:36px}
.nav a:hover,.nav button:hover{color:var(--ink);background:var(--paper-2)}
.nav a[aria-current=page]{color:var(--ink);font-weight:550}
main{padding:28px 0 64px}
h1,h2,h3{margin:0;letter-spacing:-.02em}
.muted{color:var(--ink-2)}.faint{color:var(--ink-3)}.money{color:var(--money)}.danger{color:var(--danger)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;font:inherit;font-size:14px;font-weight:550;min-height:42px;padding:0 16px;border-radius:10px;border:1px solid var(--ink);background:var(--ink);color:#fff;text-decoration:none;cursor:pointer}
.btn:hover{background:#2a2924}.btn.ghost{background:var(--card);color:var(--ink);border-color:var(--line-strong)}.btn.ghost:hover{border-color:var(--ink)}
.btn.blue{background:var(--cobalt);border-color:var(--cobalt)}.btn.blue:hover{background:var(--cobalt-ink)}
label{display:block;font-size:13px;font-weight:550;margin:0 0 6px}
input[type=text],input[type=password],input[type=url],select{width:100%;font:inherit;font-size:15px;min-height:44px;padding:0 12px;border:1px solid var(--line-strong);border-radius:10px;background:var(--card);color:var(--ink)}
input:focus,select:focus{outline:2px solid var(--cobalt);outline-offset:0;border-color:var(--cobalt)}
.field{margin-bottom:16px}.hint{font-size:12.5px;color:var(--ink-2);margin-top:6px}
.alert{border:1px solid var(--line-strong);background:var(--paper-2);border-radius:10px;padding:10px 12px;font-size:13.5px;margin-bottom:16px}
.alert.bad{border-color:#e9c4bd;background:var(--danger-wash);color:var(--danger)}
.alert.good{border-color:#bfe0cf;background:var(--money-wash);color:var(--money)}
pre,code{font-family:var(--mono);font-size:12.5px}
pre{background:var(--paper-2);border:1px solid var(--line);border-radius:10px;padding:12px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;margin:8px 0 0}
code{background:var(--paper-2);border-radius:5px;padding:1px 5px;word-break:break-word}
pre code{background:none;padding:0}
.narrow{max-width:420px;margin:8vh auto 0}
.dotted{border-bottom:1px dotted var(--line-strong)}
.pill{display:inline-block;font-family:var(--mono);font-size:10.5px;border-radius:99px;padding:1px 7px;border:1px solid var(--line-strong);color:var(--ink-2)}
.small{font-size:12.5px}
`;

export function Layout(props: { title: string; children: Child; nav?: Child; bodyClass?: string }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>{props.title} · Plugloop</title>
        <link rel="icon" href="/mark.svg" type="image/svg+xml" />
        <link rel="preload" href="/fonts/Geist-Variable.woff2" as="font" type="font/woff2" crossorigin="anonymous" />
        <style>{raw(CSS)}</style>
      </head>
      <body class={props.bodyClass}>
        {props.nav}
        {props.children}
      </body>
    </html>
  );
}

export function TopBar(props: { current: "dash" | "sites" | "setup"; children?: Child }) {
  const link = (href: string, id: typeof props.current, label: string) => (
    <a href={href} aria-current={props.current === id ? "page" : undefined}>
      {label}
    </a>
  );
  return (
    <header class="top">
      <div class="wrap">
        <a class="brand" href="/">
          <img src="/mark.svg" alt="" width="26" height="26" />
          plugloop <small>self-hosted</small>
        </a>
        {props.children}
        <nav class="nav" aria-label="Main">
          {link("/", "dash", "Dashboard")}
          {link("/sites", "sites", "Sites")}
          {link("/setup", "setup", "Setup")}
          <form method="post" action="/logout" style="margin:0">
            <button type="submit">Log out</button>
          </form>
        </nav>
      </div>
    </header>
  );
}
