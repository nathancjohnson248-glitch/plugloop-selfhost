/** Channel of a session from referrer host + UTM tags. Mirrors public.pl_channel in SQL. */
export function channelOf(ref: string | null | undefined, source?: string | null, medium?: string | null): string {
  const r = (ref || source || "").toLowerCase();
  const m = (medium || "").toLowerCase();
  if (["cpc", "ppc", "paid", "paidsearch", "paid_search", "paid_social", "paidsocial", "display", "cpm", "ads"].includes(m)) return "Paid";
  if (["email", "newsletter", "e-mail"].includes(m)) return "Email";
  if (!r || r === "(direct)") return "Direct";
  if (/(chatgpt|openai|perplexity|claude\.ai|gemini|copilot|you\.com|phind)/.test(r)) return "AI";
  if (/(^|\.)(google|bing|duckduckgo|yahoo|ecosia|brave|yandex|baidu|startpage|kagi|qwant)(\.|$)/.test(r)) return "Search";
  if (/(^|\.)(x\.com|t\.co|twitter\.com|facebook\.com|fb\.com|instagram\.com|linkedin\.com|lnkd\.in|threads\.net|bsky\.app|mastodon|youtube\.com|youtu\.be|tiktok\.com|pinterest\.com)/.test(r)) return "Social";
  if (/(ycombinator|reddit|indiehackers|lobste\.rs|dev\.to|hashnode|discord|slack|stackoverflow)/.test(r)) return "Communities";
  if (/(producthunt|betalist|uneed|microlaunch|launchingnext|peerlist|alternativeto|saashub)/.test(r)) return "Launch sites";
  if (/(mail\.|gmail|outlook|buttondown|substack|beehiiv|convertkit|mailchimp|newsletter)/.test(r)) return "Email";
  return "Referral";
}
