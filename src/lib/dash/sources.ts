/**
 * Where a visit came from → which logo to draw. Pure and shared by the dashboard, the landing page
 * and tests. Keys match the inlined logos in `components/dash/logo-data.ts` (and the files in
 * public/logos/sources). Anything unknown returns null: the UI then fetches a favicon (app) or
 * draws a neutral monogram.
 */

export const LOGO_KEYS = [
  "google", "bing", "duckduckgo", "x", "reddit", "linkedin", "youtube", "facebook", "instagram", "tiktok", "hn", "producthunt",
  "github", "indiehackers", "chatgpt", "perplexity", "claude", "gemini", "gmail", "substack", "email", "direct",
] as const;
export type LogoKey = (typeof LOGO_KEYS)[number];

const NAMES: Record<LogoKey, string> = {
  google: "Google", bing: "Bing", duckduckgo: "DuckDuckGo", x: "X", reddit: "Reddit", linkedin: "LinkedIn", youtube: "YouTube",
  facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok", hn: "Hacker News", producthunt: "Product Hunt", github: "GitHub",
  indiehackers: "Indie Hackers", chatgpt: "ChatGPT", perplexity: "Perplexity", claude: "Claude", gemini: "Gemini", gmail: "Gmail",
  substack: "Substack", email: "Email", direct: "Direct",
};
export const logoName = (k: LogoKey) => NAMES[k];

/** Host suffix → logo. Checked as "host equals or ends with .suffix". */
const HOSTS: [string, LogoKey][] = [
  ["google.com", "google"], ["google.co.uk", "google"], ["google.de", "google"], ["google.fr", "google"], ["google.co.in", "google"], ["google.ca", "google"], ["google.com.au", "google"], ["google.com.br", "google"], ["google.es", "google"], ["google.co.jp", "google"], ["google.nl", "google"],
  ["bing.com", "bing"], ["duckduckgo.com", "duckduckgo"],
  ["x.com", "x"], ["t.co", "x"], ["twitter.com", "x"],
  ["reddit.com", "reddit"], ["redd.it", "reddit"],
  ["linkedin.com", "linkedin"], ["lnkd.in", "linkedin"],
  ["youtube.com", "youtube"], ["youtu.be", "youtube"],
  ["facebook.com", "facebook"], ["fb.com", "facebook"], ["instagram.com", "instagram"], ["tiktok.com", "tiktok"],
  ["news.ycombinator.com", "hn"], ["ycombinator.com", "hn"],
  ["producthunt.com", "producthunt"], ["github.com", "github"], ["indiehackers.com", "indiehackers"],
  ["chatgpt.com", "chatgpt"], ["chat.openai.com", "chatgpt"], ["openai.com", "chatgpt"],
  ["perplexity.ai", "perplexity"], ["claude.ai", "claude"], ["anthropic.com", "claude"], ["gemini.google.com", "gemini"],
  ["mail.google.com", "gmail"], ["substack.com", "substack"],
  ["beehiiv.com", "email"], ["buttondown.email", "email"], ["buttondown.com", "email"], ["convertkit.com", "email"], ["kit.com", "email"], ["mailchimp.com", "email"], ["outlook.live.com", "email"],
];

/** Normalise "https://www.Foo.com/bar" or "foo.com" to "foo.com". */
export function hostOf(input: string): string {
  let s = input.trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/^www\./, "").replace(/^m\./, "");
  return s;
}

/** Legacy icon keys (earlier dashboards stored these on rows). */
const LEGACY: Record<string, LogoKey> = { ph: "producthunt", ai: "chatgpt", mail: "email", search: "google", hn: "hn", newsletter: "substack", openai: "chatgpt", ycombinator: "hn", twitter: "x" };

/** A referrer host, a full URL, a source id ("google", "ph") or a legacy icon key → logo key, or null. */
export function logoFor(input: string | null | undefined): LogoKey | null {
  if (!input) return "direct";
  const raw = input.trim().toLowerCase();
  if (raw === "(direct)" || raw === "direct" || raw === "(none)") return "direct";
  if ((LOGO_KEYS as readonly string[]).includes(raw)) return raw as LogoKey;
  if (LEGACY[raw]) return LEGACY[raw];
  const host = hostOf(raw);
  if (host.startsWith("gemini.google.")) return "gemini";
  if (host.startsWith("mail.google.")) return "gmail";
  for (const [suffix, key] of HOSTS) if (host === suffix || host.endsWith(`.${suffix}`)) return key;
  if (/^google\.[a-z.]+$/.test(host)) return "google";
  return null;
}

/** Logos that stand for a channel when it has no specific referrers of its own (Search → Google, Bing, DDG). */
const CHANNEL_DEFAULTS: Record<string, LogoKey[]> = {
  Search: ["google", "bing", "duckduckgo"],
  Direct: ["direct"],
  Social: ["x", "linkedin", "youtube"],
  Communities: ["hn", "reddit", "indiehackers"],
  "Launch sites": ["producthunt"],
  Email: ["substack", "gmail"],
  AI: ["chatgpt", "perplexity", "claude"],
};

/**
 * The 2–3 logos shown for a channel row: its own top referrers first (by money), then the channel's
 * usual names to fill the cluster. Unknown referrer hosts are kept as hosts (favicon in the app).
 */
export function channelLogos(channel: string, referrers: string[] = [], max = 3): string[] {
  const out: string[] = [];
  for (const r of referrers) {
    const k = logoFor(r) ?? hostOf(r);
    if (k && !out.includes(k)) out.push(k);
    if (out.length >= max) return out;
  }
  for (const k of CHANNEL_DEFAULTS[channel] ?? []) {
    if (!out.includes(k)) out.push(k);
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}

/** Valid public hostname for the favicon route: letters, digits, dashes, at least one dot, no IPs. */
export function validFaviconDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  const h = hostOf(input);
  if (h.length > 253 || !h.includes(".")) return null;
  if (/^\d+(\.\d+){3}$/.test(h) || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost")) return null;
  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(h)) return null;
  return h;
}
