// Hämtar senaste Copilot-nyheterna från Microsofts officiella RSS-flöden
// och skriver dem till news.json. Körs i GitHub Actions före deploy.
// Inga beroenden – kräver bara Node 18+.

import { writeFile, readFile } from "node:fs/promises";

const FEEDS = [
  { url: "https://www.microsoft.com/en-us/microsoft-365/blog/feed/", source: "Microsoft 365 Blog" },
  { url: "https://blogs.microsoft.com/feed/", source: "Official Microsoft Blog" },
  { url: "https://www.microsoft.com/en-us/microsoft-copilot/blog/feed/", source: "Microsoft Copilot Blog" },
];

const MAX_ITEMS = 6;
const OUT = "news.json";
const KEYWORD = /copilot/i;

const decode = (s = "") =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : "";
};

const summarize = (desc) => {
  const clean = decode(desc).replace(/The post .*? appeared first on .*$/i, "").trim();
  if (clean.length <= 150) return clean;
  return clean.slice(0, 150).replace(/\s+\S*$/, "") + "…";
};

async function readFeed({ url, source }) {
  const res = await fetch(url, { headers: { "User-Agent": "adoptit-news-bot/1.0" } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const xml = await res.text();
  const items = xml.split(/<item[\s>]/i).slice(1).map((chunk) => {
    const title = decode(tag(chunk, "title"));
    const link = decode(tag(chunk, "link"));
    const date = new Date(decode(tag(chunk, "pubDate")));
    const desc = tag(chunk, "description");
    const cats = [...chunk.matchAll(/<category>([\s\S]*?)<\/category>/gi)].map((m) => decode(m[1])).join(" ");
    return { title, link, date, desc, cats, source };
  });
  return items.filter(
    (i) => i.title && i.link && !isNaN(i.date) && KEYWORD.test(`${i.title} ${decode(i.desc)} ${i.cats}`)
  );
}

const results = await Promise.allSettled(FEEDS.map(readFeed));
results.forEach((r, i) => r.status === "rejected" && console.warn("⚠️", FEEDS[i].source, r.reason.message));

const seen = new Set();
const items = results
  .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
  .sort((a, b) => b.date - a.date)
  .filter((i) => (seen.has(i.title) ? false : seen.add(i.title)))
  .slice(0, MAX_ITEMS)
  .map((i) => ({
    title: i.title,
    url: i.link,
    date: i.date.toISOString(),
    source: i.source,
    summary: summarize(i.desc),
  }));

if (items.length === 0) {
  // Behåll befintlig news.json om alla flöden fallerar – sajten ska aldrig bli tom.
  try {
    await readFile(OUT);
    console.warn("Inga nya nyheter hämtades – behåller befintlig news.json.");
  } catch {
    await writeFile(OUT, JSON.stringify({ updated: null, items: [] }, null, 2));
  }
  process.exit(0);
}

await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), items }, null, 2) + "\n");
console.log(`✅ Skrev ${items.length} nyheter till ${OUT}`);
