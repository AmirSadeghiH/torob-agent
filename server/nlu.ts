import type { AssistantContext, AssistantIntent, SearchParams } from "../shared/types";
import { normalizeFa } from "./lib/text";

export interface NluVocabulary {
  categories: string[];
  brands: string[];
  neighborhoods: string[];
}

export interface ParsedQuery {
  intent: AssistantIntent;
  category: string | null;
  brand: string | null;
  neighborhood: string | null;
  min_price: number | null;
  max_price: number | null;
  q: string | null;
  sort: SearchParams["sort"] | null;
  limit: number;
  debug: Record<string, string | number | boolean | null>;
}

/** Colloquial → catalogue stems. Values are matched against real category names. */
const SYNONYMS: [string, string][] = [
  ["هدفون", "هدفون"],
  ["هندزفری", "هدفون"],
  ["هدست", "هدفون"],
  ["ایرپاد", "هدفون"],
  ["گوشی موبایل", "گوشی موبایل"],
  ["گوشی", "گوشی موبایل"],
  ["موبایل", "گوشی موبایل"],
  ["لپ‌تاپ", "لپ تاپ"],
  ["لپ تاپ", "لپ تاپ"],
  ["لپتاپ", "لپ تاپ"],
  ["نوت‌بوک", "لپ تاپ"],
  ["تبلت", "تبلت"],
  ["تلویزیون", "تلویزیون"],
  ["تی وی", "تلویزیون"],
  ["ساعت هوشمند", "ساعت و مچ بند هوشمند"],
  ["ساعت", "ساعت مچی"],
  ["دوربین مدار بسته", "دوربین مدار بسته"],
  ["دوربین مداربسته", "دوربین مدار بسته"],
  ["دوربین", "دوربین"],
  ["یخچال", "یخچال"],
  ["فریزر", "فریزر"],
  ["مبل", "مبل"],
  ["جارو", "جارو"],
  ["جاروبرقی", "جارو برقی"],
  ["پاوربانک", "پاوربانک"],
  ["شارژر", "شارژر"],
  ["کیبورد", "کیبورد"],
  ["ماوس", "ماوس"],
  ["موس", "ماوس"],
  ["پرینتر", "پرینتر"],
  ["چاپگر", "پرینتر"],
  ["کنسول", "کنسول"],
  ["پلی استیشن", "کنسول"],
  ["هارد", "هارد"],
  ["فلش", "فلش"],
  ["رم", "رم"],
  ["کارت گرافیک", "کارت گرافیک"],
  ["مودم", "مودم"],
  ["روتر", "مودم"],
  ["اسپیکر", "اسپیکر"],
  ["بلندگو", "اسپیکر"],
  ["پروژکتور", "پروژکتور"],
  ["کولر", "کولر"],
  ["اسپلیت", "کولر"],
  ["بخاری", "بخاری"],
  ["لباسشویی", "لباسشویی"],
  ["ظرفشویی", "ظرفشویی"],
  ["سرخ‌کن", "سرخ کن"],
  ["ایر فرایر", "سرخ کن"],
  ["چای‌ساز", "چای ساز"],
  ["سیم", "سیم و کابل"],
  ["کابل", "سیم و کابل"],
  ["لامپ", "لامپ"],
  ["کلید و پریز", "کلید و پریز"],
  ["دیلم", "ابزار"],
  ["دریل", "دریل"],
  ["پیچ گوشتی", "پیچ گوشتی"],
  ["ماشین حساب", "ماشین حساب"],
];

const STOPWORDS = new Set([
  "زیر", "کمتر", "بیشتر", "بالاتر", "تا", "حداکثر", "بودجه", "قیمت", "چند", "هزینه",
  "تومان", "تومن", "میلیون", "ملیون", "میلیارد", "هزار", "نزدیک", "نزدیکترین", "اطراف",
  "حوالی", "فاصله", "فروشگاه", "مغازه", "کجا", "بخرم", "پیدا", "کن", "کنم", "میخوام",
  "میخواهم", "میخواستم", "لطفا", "یه", "یک", "بهترین", "ارزانترین", "ارزونترین", "گرانترین", "تازه",
  "تازهترین", "جدید", "جدیدترین", "برنامه", "خرید", "حضوری", "مقایسه", "فرق", "تفاوت",
  "کدوم", "کدام", "بهتر", "بهتره", "محله", "من", "را", "از", "با", "و", "در", "برای",
  "هم", "این", "آن", "چی", "هست", "هستش", "داره", "دارد", "شو", "شود", "بده", "نشان",
  "نشون", "می", "خوام", "آره", "بله", "اوکی", "سلام", "درود", "لطفاً", "کالا", "است",
  "چنده", "چقدر", "قیمتش", "بگو", "ببینم", "میشه", "میشود", "مدل", "دو", "سه",
]);

/** Generic category words that must never pull an unrelated catalogue category. */
const CATEGORY_STOPWORDS = new Set([
  "قیمت", "خرید", "فروش", "کالا", "برنامه", "تازه", "جدید", "اصلی", "سایر", "لوازم",
  "دستگاه", "دستی", "صنعتی", "خانگی", "حرفه", "مدل", "طرح", "بسته", "عدد", "جعبه",
  "انواع", "نوع", "مخصوص", "مناسب", "بزرگ", "کوچک", "متوسط", "سری", "های", "ها",
]);

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word test in normalized Persian/Latin text (no substring false positives). */
function hasWord(text: string, token: string): boolean {
  if (!token) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(token)}([^\\p{L}\\p{N}]|$)`, "u").test(text);
}

const PLURAL_SUFFIXES = ["ها", "های", "هایی", "هائی"];

/** Best-effort singular used only for stopword checks («فروشگاه‌های» → «فروشگاه»). */
function singular(token: string): string {
  for (const suffix of ["هایی", "های", "ها"]) {
    if (token.endsWith(suffix) && token.length > suffix.length + 1) {
      return token.slice(0, -suffix.length);
    }
  }
  return token;
}

/**
 * Whole-word lookup that also accepts the everyday plural («هدفون‌ها»).
 * Returns the surface form actually present, so it can be stripped from the
 * free-text remainder instead of leaking into the FTS query.
 */
function findWord(text: string, token: string): string | null {
  if (!token) return null;
  if (hasWord(text, token)) return token;
  for (const suffix of PLURAL_SUFFIXES) {
    const plural = `${token}${suffix}`;
    if (hasWord(text, plural)) return plural;
  }
  return null;
}

function wordIndex(text: string, token: string): number {
  const m = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRe(token)})(?=[^\\p{L}\\p{N}]|$)`, "u").exec(text);
  return m ? m.index : -1;
}

const RE = {
  greeting: /^(سلام|درود|سلام علیکم|وقت بخیر|صبح بخیر|عصر بخیر|شب بخیر|های|هی)( |$)/,
  help: /(کمک|راهنما|چی کار|چه کار|چطور کار|چیکار|قابلیت|بلدی)/,
  plan: /(برنامه|مسیر|کجا برم|کدوم فروشگاه|چند فروشگاه|یک روز|یه روز|خرید حضوری|سبد)/,
  compare: /(مقایسه|فرق|تفاوت|کدوم بهتر|کدام بهتر|کدوم ارزون|کدام ارزون|کدوم تازه|بهتره کدوم)/,
  nearby: /(نزدیک|اطراف|حوالی|فاصله|همین جا|این محله|محله)/,
  stores: /(فروشگاه|مغازه|کجا بخرم|کجا پیدا|کجا هست|جایی هست|جایی داره|کجا بگیرم)/,
  alternatives: /(جایگزین|مشابه|ارزونتر از این|ارزانتر از این|بهتر از این|چیز دیگه|چیزی دیگه)/,
  freshness: /(تازه|قدیمی|اپدیت|آپدیت|به روز|بروز|کی تغییر|آخرین تغییر|اعتبار)/,
  inquiry: /(استعلام|پرسش|بپرس|پرسون|خبر|تماس|ارتباط|رسان|قیمت روز|قیمت فعلی|وجود دارد|پاسخ نداده|پاسخی نداد|جواب نداده)/,
  offers: /(قیمت|چند|هزینه|ارزون|ارزان|گرون|گران|موجود)/,
};

function parseAmount(raw: string, unit: string | undefined): number {
  const value = Number.parseFloat(raw.replace(/[٬,]/g, "").replace("٫", "."));
  if (!Number.isFinite(value)) return 0;
  const multiplier =
    unit === "میلیارد" || unit === "میلیاردی"
      ? 1_000_000_000
      : unit === "میلیون" || unit === "ملیون" || unit === "میلیونی"
        ? 1_000_000
        : unit === "هزار" || unit === "هزاری"
          ? 1_000
          : 1;
  return Math.round(value * multiplier);
}

interface Budget {
  min: number | null;
  max: number | null;
  matched: string[];
}

export function extractBudget(raw: string): Budget {
  const text = normalizeFa(raw);
  const matched: string[] = [];
  const range = text.match(
    /(?:بین|از)\s*([\d.,٬]+)\s*(هزار|میلیون|ملیون|میلیارد|تومان|تومن)?\s*(?:تا|الی)\s*([\d.,٬]+)\s*(هزار|میلیون|ملیون|میلیارد|تومان|تومن)?/,
  );
  if (range) {
    matched.push(range[0]);
    const lowUnit = range[2] ?? range[4];
    const highUnit = range[4] ?? range[2];
    return {
      min: parseAmount(range[1]!, lowUnit),
      max: parseAmount(range[3]!, highUnit),
      matched,
    };
  }

  const suffixed = text.match(/([\d.,٬]+)\s*(میلیونی|میلیاردی|هزاری)/);
  if (suffixed) {
    matched.push(suffixed[0]);
    return { min: null, max: parseAmount(suffixed[1]!, suffixed[2]), matched };
  }

  const withKeyword = text.match(
    /(?:زیر|کمتر از|پایین‌تر از|پایینتر از|تا|حداکثر|بودجه|حوالی|حدود|ارزون‌تر از|ارزونتر از|ارزان‌تر از|ارزانتر از)\s*([\d.,٬]+)\s*(هزار|میلیون|ملیون|میلیارد|تومان|تومن)?/,
  );
  if (withKeyword) {
    const value = parseAmount(withKeyword[1]!, withKeyword[2]);
    if (value >= 1000) {
      matched.push(withKeyword[0]);
      return { min: null, max: value, matched };
    }
  }

  const bare = [...text.matchAll(/([\d.,٬]+)\s*(میلیون|ملیون|میلیارد|هزار)\s*(تومان|تومن)?/g)];
  if (bare.length > 0) {
    const last = bare[bare.length - 1]!;
    matched.push(last[0]);
    return { min: null, max: parseAmount(last[1]!, last[2]), matched };
  }
  return { min: null, max: null, matched };
}

function findCategory(stem: string, vocab: NluVocabulary): string | null {
  const target = normalizeFa(stem);
  const exact = vocab.categories.find((c) => normalizeFa(c) === target);
  if (exact) return exact;
  const starts = vocab.categories.find((c) => normalizeFa(c).startsWith(`${target} `));
  if (starts) return starts;
  return vocab.categories.find((c) => normalizeFa(c).startsWith(target)) ?? null;
}

/**
 * Category resolution, strongest signal first:
 * 1. a full catalogue category name in the sentence,
 * 2. a colloquial synonym as a whole word,
 * 3. at least two significant category tokens as whole words.
 * Whole-word matching matters: «سلام» must not mean «سلامت», «بچین» not «سیم چین».
 */
function detectCategory(text: string, vocab: NluVocabulary) {
  let bestName: { category: string; phrase: string; length: number } | null = null;
  for (const category of vocab.categories) {
    const norm = normalizeFa(category);
    if (!norm) continue;
    const hasSpace = norm.includes(" ");
    const surface = hasSpace
      ? text.includes(norm)
        ? norm
        : null
      : norm.length >= 3
        ? findWord(text, norm)
        : null;
    if (surface && (!bestName || norm.length > bestName.length)) {
      bestName = { category, phrase: surface, length: norm.length };
    }
  }
  if (bestName) return { category: bestName.category, phrase: bestName.phrase };

  let bestSynonym: { index: number; key: string; category: string } | null = null;
  for (const [key, stem] of SYNONYMS) {
    const surface = findWord(text, normalizeFa(key));
    if (!surface) continue;
    const index = wordIndex(text, surface);
    if (index < 0) continue;
    if (bestSynonym === null || index < bestSynonym.index) {
      const category = findCategory(stem, vocab);
      if (category) bestSynonym = { index, key: surface, category };
    }
  }
  if (bestSynonym) return { category: bestSynonym.category, phrase: bestSynonym.key };

  let best: { score: number; category: string; phrase: string } | null = null;
  for (const category of vocab.categories) {
    const norm = normalizeFa(category);
    if (!norm) continue;
    const tokens = norm
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length >= 4 && !CATEGORY_STOPWORDS.has(t));
    const hits = tokens.filter((t) => hasWord(text, t));
    if (hits.length < 2) continue;
    const score = hits.length * 10 + hits.join("").length;
    if (!best || score > best.score) best = { score, category, phrase: hits.join(" ") };
  }
  return best ? { category: best.category, phrase: best.phrase } : null;
}

function detectBrand(text: string, vocab: NluVocabulary) {
  let best: { brand: string; phrase: string; length: number } | null = null;
  for (const brand of vocab.brands) {
    const norm = normalizeFa(brand);
    if (norm.length < 3) continue;
    const surface = findWord(text, norm);
    if (surface && (!best || norm.length > best.length)) {
      best = { brand, phrase: surface, length: norm.length };
    }
  }
  return best;
}

function detectNeighborhood(text: string, vocab: NluVocabulary) {
  let best: { neighborhood: string; phrase: string; length: number } | null = null;
  for (const hood of vocab.neighborhoods) {
    const norm = normalizeFa(hood);
    if (norm.length < 3) continue;
    const surface = findWord(text, norm);
    if (surface && (!best || norm.length > best.length)) {
      best = { neighborhood: hood, phrase: surface, length: norm.length };
    }
  }
  return best;
}

export function parseMessage(
  message: string,
  vocab: NluVocabulary,
  context: AssistantContext = {},
): ParsedQuery {
  const text = normalizeFa(message);
  const debug: ParsedQuery["debug"] = {};
  const consumed: string[] = [];

  const budget = extractBudget(text);
  consumed.push(...budget.matched);

  const categoryMatch = detectCategory(text, vocab);
  if (categoryMatch) consumed.push(categoryMatch.phrase);
  const brandMatch = detectBrand(text, vocab);
  if (brandMatch) consumed.push(brandMatch.phrase);
  const hoodMatch = detectNeighborhood(text, vocab);
  if (hoodMatch) consumed.push(hoodMatch.phrase);

  let intent: AssistantIntent = "search";
  if (RE.greeting.test(text) && !categoryMatch && !brandMatch) intent = "greeting";
  else if (RE.help.test(text)) intent = "help";
  else if (RE.plan.test(text)) intent = "plan";
  else if (RE.compare.test(text)) intent = "compare";
  else if (RE.alternatives.test(text)) intent = "alternatives";
  else if (RE.nearby.test(text) || RE.stores.test(text)) intent = "stores";
  else if (RE.freshness.test(text)) intent = "freshness";
  else if (RE.inquiry.test(text)) intent = "inquiry";
  else if (RE.offers.test(text) && (context.product_id || brandMatch)) intent = "offers";

  if (intent === "offers" && !context.product_id && !brandMatch && !categoryMatch) {
    intent = "search";
  }
  // With a product open, «ارزان‌تر» means «show me other models», not «other offers of this one».
  if (
    (intent === "offers" || intent === "search") &&
    context.product_id &&
    !categoryMatch &&
    !brandMatch &&
    /(ارزان‌تر|ارزانتر|ارزون‌تر|ارزونتر|گران‌تر|گرانتر|گرون‌تر|گرونتر|مشابه)/.test(text)
  ) {
    intent = "alternatives";
  }
  if (intent === "plan" && (context.offer_ids?.length ?? 0) === 0 && !categoryMatch) {
    // «برنامه» without a basket still means «what should I buy», keep it.
  }

  let sort: SearchParams["sort"] | null = null;
  if (/(ارزونترین|ارزانترین|کمترین قیمت|ارزونترین|ارزانترین)/.test(text)) sort = "price_asc";
  else if (/(گرانترین|بالاترین قیمت)/.test(text)) sort = "price_desc";
  else if (/(تازهترین|جدیدترین)/.test(text)) sort = "freshness";
  else if (/(بیشترین پیشنهاد|مقایسهپذیر|چند فروشنده)/.test(text)) sort = "offers";

  let limit = 6;
  if (/(سه|۳|3)\s*(تا|مورد|گزینه)/.test(text)) limit = 3;
  else if (/(دو|۲|2)\s*(تا|مورد|گزینه)/.test(text)) limit = 2;

  const stripped = consumed.filter(Boolean);
  // An empty alternation would match at every position and erase the whole sentence.
  const remaining = (stripped.length > 0 ? text.replace(new RegExp(stripped.map(escapeRe).join("|"), "g"), " ") : text)
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t) && !STOPWORDS.has(singular(t)));

  const q = remaining.join(" ").trim();

  if (
    (intent === "search" || intent === "offers") &&
    !q &&
    !categoryMatch &&
    !brandMatch &&
    !context.product_id
  ) {
    intent = "unknown";
  }

  debug.intent = intent;
  debug.category = categoryMatch?.category ?? null;
  debug.brand = brandMatch?.brand ?? null;
  debug.neighborhood = hoodMatch?.neighborhood ?? null;
  debug.max_price = budget.max;
  debug.min_price = budget.min;
  debug.q = q || null;
  debug.sort = sort;
  debug.words = text.split(" ").length;

  return {
    intent,
    category: categoryMatch?.category ?? null,
    brand: brandMatch?.brand ?? null,
    neighborhood: hoodMatch?.neighborhood ?? null,
    min_price: budget.min,
    max_price: budget.max,
    q: q.length >= 2 ? q : null,
    sort,
    limit,
    debug,
  };
}
