// AEO/GEO checks: can AI crawlers reach the site, does it publish llms.txt, and do
// pages state answers plainly enough to be quoted. Static checks only; no model calls.
import type { CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { isAllowed, visibleText, type RobotsRules } from "./crawl";

// ---------------------------------------------------------------------------
// AI crawlers in robots.txt

export const AI_CRAWLERS = ["GPTBot", "ClaudeBot", "Google-Extended", "PerplexityBot", "anthropic-ai"] as const;

export interface RobotsGroup {
  agents: string[];
  allow: string[];
  disallow: string[];
}

export function parseRobotsGroups(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let inRules = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const match = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (key === "user-agent") {
      if (!current || inRules) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
        inRules = false;
      }
      current.agents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && current) {
      inRules = true;
      if (value) current[key].push(value);
    }
  }
  return groups;
}

export type CrawlerStatus = "allowed" | "partial" | "blocked";

export interface CrawlerAccess {
  agent: string;
  status: CrawlerStatus;
  // True when robots.txt has a group naming this crawler; otherwise the * rules apply.
  namedGroup: boolean;
  // Crawled pages this crawler may not fetch.
  blockedPages: string[];
}

// robotsText null means there's no robots.txt, so everything is allowed.
export function aiCrawlerAccess(robotsText: string | null, pageUrls: string[]): CrawlerAccess[] {
  const groups = robotsText ? parseRobotsGroups(robotsText) : [];
  return AI_CRAWLERS.map((agent) => {
    const named = groups.filter((g) => g.agents.includes(agent.toLowerCase()));
    const applicable = named.length ? named : groups.filter((g) => g.agents.includes("*"));
    const rules: RobotsRules = {
      sitemaps: [],
      allow: applicable.flatMap((g) => g.allow),
      disallow: applicable.flatMap((g) => g.disallow),
    };
    const blockedPages = pageUrls.filter((u) => !isAllowed(rules, new URL(u)));
    const home = pageUrls[0] ? new URL("/", pageUrls[0]) : null;
    const homeBlocked = home ? !isAllowed(rules, home) : rules.disallow.includes("/");
    return {
      agent,
      status: homeBlocked ? "blocked" : blockedPages.length ? "partial" : "allowed",
      namedGroup: named.length > 0,
      blockedPages,
    };
  });
}

// ---------------------------------------------------------------------------
// llms.txt

export interface LlmsTxtCheck {
  url: string;
  statusCode: number | null;
  present: boolean;
  title: string | null;
  hasSummary: boolean;
  sections: number;
  links: number;
  bytes: number;
  fullVersion: boolean;
  issues: string[];
}

// Follows the llms.txt proposal: an H1 name, a "> " summary, then "## " sections of links.
export function checkLlmsTxt(
  url: string,
  res: { statusCode: number | null; contentType: string | null; body: string },
  fullVersion: boolean,
): LlmsTxtCheck {
  const looksHtml = /html/i.test(res.contentType ?? "") || /^\s*<(!doctype|html)/i.test(res.body);
  const present = res.statusCode === 200 && !looksHtml && res.body.trim().length > 0;
  const lines = present ? res.body.split(/\r?\n/) : [];
  const title = lines.find((l) => /^#\s+\S/.test(l))?.replace(/^#\s+/, "").trim() ?? null;
  const check: LlmsTxtCheck = {
    url,
    statusCode: res.statusCode,
    present,
    title,
    hasSummary: lines.some((l) => /^>\s*\S/.test(l)),
    sections: lines.filter((l) => /^##\s+\S/.test(l)).length,
    links: present ? (res.body.match(/\[[^\]]+\]\([^)\s]+\)/g) ?? []).length : 0,
    bytes: present ? Buffer.byteLength(res.body) : 0,
    fullVersion,
    issues: [],
  };
  if (!present) {
    check.issues.push(
      res.statusCode === 200 ? "llms.txt returns a web page, not a text file." : "No llms.txt at the site root.",
    );
  } else {
    if (!title) check.issues.push("No '# Name' title line.");
    if (!check.hasSummary) check.issues.push("No '> ' summary line.");
    if (check.links === 0) check.issues.push("No links to key pages.");
  }
  return check;
}

// ---------------------------------------------------------------------------
// Answer extractability

export type AnswerSource = "lead" | "heading" | "details" | "definition" | "inline" | "schema";

export interface AnswerItem {
  source: AnswerSource;
  question: string;
  answerStart: string;
  // Words in the first block of the answer, and in its first sentence.
  words: number;
  firstSentenceWords: number;
  score: number;
  issues: string[];
}

export interface AnswerCheck {
  // 0-100 average over the lead and every question found; null when there's nothing to score.
  score: number | null;
  questions: number;
  faqSchema: boolean;
  items: AnswerItem[];
}

const QUESTION_START =
  /^(how|what|why|when|where|who|whom|which|can|could|do|does|did|is|are|was|were|should|will|would|may|much|many)\b/i;
const DANGLING_START = /^(this|that|these|those|it|they|them|he|she|here|there|above|below|as (mentioned|noted|above))\b/i;

const clean = (t: string) => t.replace(/\s+/g, " ").trim();
const countWords = (t: string) => t.split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const firstSentence = (t: string) => t.split(/(?<=[.!?])\s+(?=["“'(]?[A-Z0-9])/)[0] ?? t;

export function isQuestion(text: string): boolean {
  const t = clean(text).replace(/[+\-–—›»▸▾]\s*$/, "").trim();
  return t.endsWith("?") || (QUESTION_START.test(t) && countWords(t) <= 14);
}

// Headings are stricter: "What good looks like" is a statement. A heading counts when
// it asks something ("?") or is a how-to.
export function isQuestionHeading(text: string): boolean {
  const t = clean(text);
  return t.includes("?") || /^how to\b/i.test(t);
}

// How quotable one answer is: a short first block, a short first sentence, and a
// first sentence that stands alone without the question around it.
export function scoreAnswer(source: AnswerSource, question: string, answer: string, isList = false): AnswerItem {
  const text = clean(answer);
  const words = countWords(text);
  const lead = firstSentence(text);
  const leadWords = countWords(lead);
  const issues: string[] = [];
  let score = 0;

  if (isList || (words >= 10 && words <= 60)) score += 40;
  else if (words > 60 && words <= 100) {
    score += 20;
    issues.push(`Opening paragraph is ${words} words; 60 or fewer is easier to quote.`);
  } else if (words > 100) issues.push(`Answer is buried in a ${words}-word paragraph.`);
  else if (words === 0) issues.push("No answer text follows the question.");
  else {
    score += 20;
    issues.push(`Opening is only ${words} words.`);
  }

  if (leadWords > 0 && leadWords <= 25) score += 30;
  else if (leadWords > 25 && leadWords <= 40) {
    score += 15;
    issues.push(`First sentence is ${leadWords} words; 25 or fewer reads as a direct answer.`);
  } else if (leadWords > 40) issues.push(`First sentence is ${leadWords} words.`);

  if (words > 0 && !DANGLING_START.test(lead)) score += 30;
  else if (words > 0) issues.push(`Starts with "${lead.split(" ")[0]}", so it doesn't stand alone when quoted.`);

  return {
    source,
    question: clean(question).replace(/[+\-–—›»▸▾]\s*$/, "").trim(),
    answerStart: text.length > 160 ? `${text.slice(0, 157)}…` : text,
    words,
    firstSentenceWords: leadWords,
    score,
    issues,
  };
}

const HEADING = /^h[1-6]$/;
const BLOCK_TEXT = new Set(["p", "ul", "ol", "dl", "blockquote", "table", "div", "section"]);

// The first block of text after a heading, before the next heading.
function answerAfterHeading($: CheerioAPI, heading: Element): { text: string; isList: boolean } | null {
  let node = heading.nextSibling;
  // Headings wrapped in a container (e.g. <div><h2/></div><p/>): continue after the wrapper.
  if (!node && heading.parent && heading.parent.type === "tag" && heading.parent.children.filter((c) => c.type === "tag").length === 1) {
    node = heading.parent.nextSibling;
  }
  for (let hops = 0; node && hops < 6; node = node.nextSibling, hops++) {
    if (node.type !== "tag") continue;
    const el = node as Element;
    if (HEADING.test(el.tagName) || $(el).find("h1,h2,h3,h4,h5,h6").length) return null;
    if (!BLOCK_TEXT.has(el.tagName)) continue;
    const block = el.tagName === "div" || el.tagName === "section" ? $(el).find("p, ul, ol").first() : $(el);
    const text = clean(block.text());
    if (text) return { text, isList: block.is("ul, ol") };
  }
  return null;
}

function firstBlock($: CheerioAPI, nodes: AnyNode[]): { text: string; isList: boolean } {
  const wrapper = $(nodes);
  const block = wrapper.find("p, ul, ol").addBack("p, ul, ol").first();
  if (block.length) return { text: clean(block.text()), isList: block.is("ul, ol") };
  return { text: clean(wrapper.text()), isList: false };
}

function schemaQuestions(jsonLd: unknown[]): { question: string; answer: string }[] {
  const out: { question: string; answer: string }[] = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (!v || typeof v !== "object") return;
    const node = v as Record<string, unknown>;
    if (Array.isArray(node["@graph"])) visit(node["@graph"]);
    if ([node["@type"]].flat().includes("FAQPage")) {
      for (const q of [node.mainEntity].flat()) {
        const item = q as { name?: string; acceptedAnswer?: { text?: string } } | undefined;
        if (item?.name && item.acceptedAnswer?.text) {
          out.push({ question: item.name, answer: item.acceptedAnswer.text.replace(/<[^>]+>/g, " ") });
        }
      }
    }
  };
  visit(jsonLd);
  return out;
}

export function checkAnswers($: CheerioAPI, jsonLd: unknown[]): AnswerCheck {
  const root = $("main").first().length ? $("main").first() : $("body");
  const content = root.clone();
  content.find("script, style, noscript, template, svg, nav, footer, [hidden], [aria-hidden='true']").remove();
  // Site headers go; a hero <header> holding the H1 stays.
  content.find("header").filter((_, el) => $(el).find("h1").length === 0).remove();

  const items: AnswerItem[] = [];
  const seen = new Set<string>();
  const add = (item: AnswerItem) => {
    const key = item.question.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };

  // The page's opening: the first paragraph after the H1 should say what the page answers.
  const h1 = content.find("h1").first();
  let afterH1 = !h1.length;
  let leadText = "";
  content.find("h1, p").each((_, el) => {
    if (el === h1[0]) afterH1 = true;
    // Skip bylines and eyebrows ("By Jake · Sep 2026") on the way to the first real paragraph.
    else if (afterH1 && el.tagName === "p" && !leadText && countWords(clean($(el).text())) >= 8) leadText = clean($(el).text());
  });
  if (leadText) {
    items.push(scoreAnswer("lead", visibleText(h1.toArray()) || "Opening paragraph", leadText));
  }

  content.find("details").each((_, el) => {
    const summary = $(el).children("summary").first();
    if (!summary.length || !isQuestion(visibleText(summary.toArray()))) return;
    const rest = $(el).contents().toArray().filter((n) => n !== summary[0]);
    const { text, isList } = firstBlock($, rest);
    add(scoreAnswer("details", visibleText(summary.toArray()), text, isList));
  });

  content.find("dt").each((_, el) => {
    const dd = $(el).nextAll("dd").first();
    const question = visibleText([el]);
    if (!dd.length || !isQuestion(question)) return;
    const { text, isList } = firstBlock($, dd.toArray());
    add(scoreAnswer("definition", question, text, isList));
  });

  content.find("h2, h3, h4, h5").each((_, el) => {
    const question = visibleText([el]);
    if (!isQuestionHeading(question)) return;
    const answer = answerAfterHeading($, el as Element);
    add(scoreAnswer("heading", question, answer?.text ?? "", answer?.isList));
  });

  // <p><strong>Question?</strong> Answer…</p>
  content.find("p").each((_, el) => {
    const lead = $(el).children("strong, b").first();
    if (!lead.length || !clean(lead.text()).endsWith("?") || !clean($(el).text()).startsWith(clean(lead.text()))) return;
    const answer = clean($(el).text()).slice(clean(lead.text()).length);
    add(scoreAnswer("inline", lead.text(), answer));
  });

  const schema = schemaQuestions(jsonLd);
  // Schema Q&As count only when they aren't already visible on the page.
  schema.forEach((q) => add(scoreAnswer("schema", q.question, q.answer)));

  const questions = items.filter((i) => i.source !== "lead").length;
  const score = items.length ? Math.round(items.reduce((sum, i) => sum + i.score, 0) / items.length) : null;
  return { score, questions, faqSchema: schema.length > 0, items: items.slice(0, 40) };
}

// ---------------------------------------------------------------------------
// Site-level checks, run once per crawl

export interface SiteAeo {
  robotsStatus: number | null;
  aiCrawlers: CrawlerAccess[];
  llmsTxt: LlmsTxtCheck;
  checkedAt: string;
}

async function fetchPlain(fetchImpl: typeof fetch, url: string, userAgent: string, timeoutMs: number) {
  try {
    const res = await fetchImpl(url, { redirect: "follow", headers: { "User-Agent": userAgent }, signal: AbortSignal.timeout(timeoutMs) });
    return { statusCode: res.status, contentType: res.headers.get("content-type"), body: await res.text() };
  } catch {
    return { statusCode: null, contentType: null, body: "" };
  }
}

export async function checkSiteAeo(
  origin: string,
  pageUrls: string[],
  options: { fetchImpl?: typeof fetch; userAgent: string; timeoutMs?: number },
): Promise<SiteAeo> {
  const { fetchImpl = fetch, userAgent, timeoutMs = 15_000 } = options;
  const at = (path: string) => new URL(path, origin).href;
  const [robots, llms, llmsFull] = await Promise.all([
    fetchPlain(fetchImpl, at("/robots.txt"), userAgent, timeoutMs),
    fetchPlain(fetchImpl, at("/llms.txt"), userAgent, timeoutMs),
    fetchPlain(fetchImpl, at("/llms-full.txt"), userAgent, timeoutMs),
  ]);
  const fullVersion = checkLlmsTxt(at("/llms-full.txt"), llmsFull, false).present;
  return {
    robotsStatus: robots.statusCode,
    aiCrawlers: aiCrawlerAccess(robots.statusCode === 200 ? robots.body : null, pageUrls),
    llmsTxt: checkLlmsTxt(at("/llms.txt"), llms, fullVersion),
    checkedAt: new Date().toISOString(),
  };
}
