/** Persian text helpers shared by the API (search normalisation, digits, FTS). */

const ARABIC_MAP: Record<string, string> = {
  "ي": "ی", "ى": "ی", "ك": "ک", "ۀ": "ه", "ة": "ه",
  "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ؤ": "و", "ئ": "ی",
};
const DROP = /[\u200c\u200d\u200e\u200f\u0640\ufeff]/g;
const DIACRITICS = /[\u064b-\u065f\u0670]/g;
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function toLatinDigits(input: string): string {
  return input.replace(/[۰-۹٠-٩]/g, (ch) => {
    const p = PERSIAN_DIGITS.indexOf(ch);
    if (p >= 0) return String(p);
    return String(ARABIC_DIGITS.indexOf(ch));
  });
}

/** Same normal form the importer used for `search_text`. */
export function normalizeFa(input: string): string {
  let out = "";
  for (const ch of input) {
    if (DROP.test(ch)) continue;
    out += ARABIC_MAP[ch] ?? ch;
  }
  return toLatinDigits(out.replace(DIACRITICS, "").toLowerCase())
    .replace(/\s+/g, " ")
    .trim();
}

/** Build a safe FTS5 query: all tokens must match, the last one as a prefix. */
export function ftsQuery(input: string): string | null {
  const tokens = normalizeFa(input)
    .split(" ")
    .map((t) => t.replace(/["'^*:()\-]/g, "").trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens
    .map((t, i) => (i === tokens.length - 1 && tokens.length > 1 ? `"${t}"*` : `"${t}"*`))
    .join(" ");
}

const FA = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

export function fa(value: string | number): string {
  return String(value).replace(/\d/g, (d) => FA[Number(d)]);
}

export function faNumber(value: number): string {
  return fa(Math.round(value).toLocaleString("en-US")).replace(/,/g, "٬");
}

export function toman(value: number): string {
  return `${faNumber(value)} تومان`;
}

export function ageLabel(days: number | null): string {
  if (days === null) return "تاریخ نامشخص";
  if (days <= 0) return "همین امروز";
  if (days === 1) return "۱ روز پیش";
  if (days < 30) return `${fa(days)} روز پیش`;
  if (days < 365) {
    const months = Math.floor(days / 30);
    return months === 1 ? "۱ ماه پیش" : `${fa(months)} ماه پیش`;
  }
  const years = Math.floor(days / 365);
  return years === 1 ? "۱ سال پیش" : `${fa(years)} سال پیش`;
}

/** Clamp a free-text field so blocks never ship a wall of text. */
export function shorten(text: string | null, max = 160): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}
