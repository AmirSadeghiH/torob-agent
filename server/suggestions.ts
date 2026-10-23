import type {
  AssistantContext,
  AssistantIntent,
  FilterPatch,
  FreshnessLevel,
  InquiryStatus,
  NextStep,
  NextStepAction,
  SearchParams,
} from "../shared/types";
import type { ToolArtifact } from "./ai-blocks";
import { inquiryNextStep } from "./inquiry";
import { toman } from "./lib/text";

/**
 * Contextual next steps.
 *
 * The deterministic engine builds these from what the tools actually returned,
 * the conditions the user is currently shopping under, and the inquiry state.
 * Every suggestion carries a runnable action plus the natural-language request
 * the client sends when the action has no dedicated page; nothing is echoed from
 * a fixed list, and no suggestion is shown for an action the UI cannot do.
 */

export interface SuggestionConditions {
  budgetMax?: number | null;
  budgetMin?: number | null;
  neighborhood?: string | null;
  radius_m?: number | null;
  category?: string | null;
  brand?: string | null;
  search?: string | null;
  sort?: SearchParams["sort"] | null;
}

export interface SuggestionInquiry {
  status: InquiryStatus;
  hasContact: boolean;
  product_id: string;
}

/** A product that is actually visible in the current UI. */
export interface ViewedProduct {
  product_id: string;
  title: string;
  min_price: number | null;
  offer_count: number;
  freshness: FreshnessLevel;
}

/** An action before the client-facing `request` text is attached. */
export type ActionDraft =
  | { type: "search"; patch?: FilterPatch }
  | { type: "compare"; product_ids: string[] }
  | { type: "inquiry"; offer_id?: string; product_id?: string }
  | { type: "plan" }
  | { type: "alternatives"; product_id: string }
  | { type: "stores"; product_id?: string; shop_id?: string; category?: string }
  | { type: "message"; text: string };

/** A suggestion before its client-facing `request` text is attached. */
export interface DraftStep {
  label: string;
  action: ActionDraft;
}

export interface SuggestionInput {
  intent: AssistantIntent;
  context: AssistantContext;
  conditions: SuggestionConditions;
  /** Either the artifacts the model ran, or an explicit product list + contact
   *  flag — so the deterministic engine can feed the same engine. */
  artifacts?: ToolArtifact[];
  products?: ViewedProduct[];
  contact?: boolean;
  /** The dominant artifact kind; derived from the last artifact when omitted. */
  kind?: ToolArtifact["kind"] | null;
  inquiry?: SuggestionInquiry | null;
  max?: number;
}

/**
 * The plain-language request behind an action. When the client has a real page
 * for the action it navigates instead; otherwise it sends this sentence, so a
 * suggestion never promises behaviour the app cannot perform.
 */
function requestFor(action: ActionDraft, conditions: SuggestionConditions): string {
  switch (action.type) {
    case "message":
      return action.text;
    case "plan":
      return "برنامهٔ خرید حضوری را بچین";
    case "compare":
      return "این کالاها را با هم مقایسه کن";
    case "inquiry":
      return "استعلام موجودی و قیمت از فروشنده آماده کن";
    case "alternatives":
      return "جایگزین واقعی برای این کالا پیدا کن";
    case "stores": {
      if (action.shop_id) return "فروشگاه‌های این کالا را ببین";
      if (action.category) return `فروشگاه‌های نزدیک برای ${action.category} را ببین`;
      return "فروشگاه‌های این کالا را ببین";
    }
    case "search": {
      const patch = (action.patch ?? {}) as {
        q?: string | null;
        category?: string | null;
        brand?: string | null;
        max_price?: number | null;
      };
      const q =
        patch.q ?? patch.category ?? patch.brand ?? conditions.search ?? conditions.category ?? "";
      const budget = patch.max_price ?? conditions.budgetMax ?? null;
      if (q && budget) return `${q} تا ${toman(budget)}`;
      if (q) return q;
      if (budget) return `کالا تا ${toman(budget)}`;
      return "الان چه چیزی بخرم؟";
    }
  }
}

/** Turns a draft action into the full client-facing action. */
export function withRequestAction(
  action: ActionDraft,
  conditions: SuggestionConditions = {},
): NextStepAction {
  return withRequest(action, conditions);
}

function withRequest(action: ActionDraft, conditions: SuggestionConditions): NextStepAction {
  const request = requestFor(action, conditions);
  switch (action.type) {
    case "search":
      return { type: "search", patch: action.patch, request };
    case "compare":
      return { type: "compare", product_ids: action.product_ids, request };
    case "inquiry":
      return { type: "inquiry", offer_id: action.offer_id, product_id: action.product_id, request };
    case "plan":
      return { type: "plan", request };
    case "alternatives":
      return { type: "alternatives", product_id: action.product_id, request };
    case "stores":
      return {
        type: "stores",
        product_id: action.product_id,
        shop_id: action.shop_id,
        category: action.category,
        request,
      };
    case "message":
      return { type: "message", text: action.text, request };
  }
}

function fromCard(card: {
  product_id: string;
  title: string;
  min_price: number | null;
  offer_count: number;
  freshness: FreshnessLevel;
}): ViewedProduct {
  return {
    product_id: card.product_id,
    title: card.title,
    min_price: card.min_price,
    offer_count: card.offer_count,
    freshness: card.freshness,
  };
}

/** Products actually visible in the current UI, most recent artifact first. */
function viewedProducts(artifacts: ToolArtifact[]): ViewedProduct[] {
  const out: ViewedProduct[] = [];
  for (const artifact of artifacts) {
    if (artifact.kind === "products") {
      out.push(...artifact.result.items.map(fromCard));
    } else if (artifact.kind === "compare") {
      out.push(...artifact.products.map(fromCard));
    } else if (artifact.kind === "alternatives") {
      out.push(...artifact.items.map(fromCard));
    } else if (artifact.kind === "product") {
      out.push(fromCard(artifact.product), ...artifact.product.alternatives.map(fromCard));
    }
  }
  return out;
}

/** True when some result the user can see has a registered contact channel. */
export function hasRecordedContact(artifacts: ToolArtifact[]): boolean {
  for (const artifact of artifacts) {
    if (artifact.kind === "product") {
      if (artifact.product.offers.some((o) => o.shop.website || o.shop.instagram)) return true;
    }
    if (artifact.kind === "inquiry" && artifact.contacts.length > 0) return true;
    if (artifact.kind === "products") {
      if (artifact.result.items.some((item) => item.best?.website || item.best?.instagram))
        return true;
    }
  }
  return false;
}

/** Builds the follow-up step implied by the inquiry state, or nothing. */
function inquiryStep(inquiry: SuggestionInput["inquiry"]): DraftStep | null {
  if (!inquiry) return null;
  if (!inquiry.hasContact) {
    return {
      label: "فروشنده‌ی دیگری با راه تماس ثبت‌شده پیدا کن",
      action: { type: "stores", product_id: inquiry.product_id },
    };
  }
  switch (inquiry.status) {
    case "not_found":
      return {
        label: "جایگزین واقعی در همان دسته پیدا کن",
        action: { type: "alternatives", product_id: inquiry.product_id },
      };
    case "no_response":
    case "failed":
      return {
        label: "فروشنده‌ی دیگر با راه تماس ثبت‌شده پیدا کن",
        action: { type: "stores", product_id: inquiry.product_id },
      };
    case "price_reported":
      return {
        label: "قیمت گزارش‌شده را با دیگر فروشنده‌ها مقایسه کن",
        action: { type: "message", text: "قیمت گزارش‌شده را با دیگر فروشنده‌ها مقایسه کن" },
      };
    case "stock_confirmed":
      return {
        label: "قیمت و گارانتی نهایی را تأیید کن",
        action: { type: "message", text: "قیمت و گارانتی نهایی این پیشنهاد را تأیید کن" },
      };
    default:
      return {
        label: "نتیجه‌ی تماس را گزارش کن",
        action: { type: "message", text: "نتیجه‌ی تماس این فروشنده را گزارش کن" },
      };
  }
}

export function contextualSuggestions(input: SuggestionInput): NextStep[] {
  const max = input.max ?? 4;
  const seen = new Set<string>();
  const out: NextStep[] = [];
  const add = (step: DraftStep | null): void => {
    if (!step || seen.has(step.label)) return;
    seen.add(step.label);
    out.push({ ...step, action: withRequest(step.action, input.conditions) });
  };

  const artifacts = input.artifacts ?? [];
  const products = input.products ?? viewedProducts(artifacts);
  const contact = input.contact ?? (artifacts.length > 0 ? hasRecordedContact(artifacts) : false);
  const subjectIds = products.slice(0, 3).map((p) => p.product_id);
  const first = products[0];
  const context = input.context;
  const kind = input.kind ?? artifacts.at(-1)?.kind ?? null;

  // 1. The inquiry state is the strongest signal: follow up on what the user
  //    reported before offering anything new.
  add(inquiryStep(input.inquiry));

  if (kind === "products" || kind === null) {
    if (subjectIds.length >= 2) {
      add({
        label: "مقایسهٔ این گزینه‌ها را ببین",
        action: { type: "compare", product_ids: subjectIds.slice(0, 2) },
      });
    }
    if (first) {
      add({
        label: "فروشگاه‌های این کالا را ببین",
        action: { type: "stores", product_id: first.product_id },
      });
    }
    if (products.length > 0 || input.conditions.category || input.conditions.search) {
      add({
        label: "ارزان‌ترین گزینه‌ها را نشان بده",
        action: { type: "search", patch: { sort: "price_asc" } },
      });
    }
    if (products.length > 0) {
      add({ label: "برنامهٔ خرید بچین", action: { type: "plan" } });
    }
  } else if (kind === "product") {
    const artifact = artifacts.at(-1);
    const detail = artifact && artifact.kind === "product" ? artifact.product : null;
    if (detail) {
      const alternative = detail.alternatives[0];
      if (alternative) {
        add({
          label: "مقایسه با گزینه‌ی دیگر",
          action: { type: "compare", product_ids: [detail.product_id, alternative.product_id] },
        });
      }
      add({
        label: "فروشگاه‌های این کالا را ببین",
        action: { type: "stores", product_id: detail.product_id },
      });
    } else if (first) {
      add({
        label: "فروشگاه‌های این کالا را ببین",
        action: { type: "stores", product_id: first.product_id },
      });
    }
    const cheapest = cheapestOfferId(artifacts);
    if (contact && cheapest) {
      add({
        label: "استعلام موجودی و قیمت آماده کن",
        action: { type: "inquiry", offer_id: cheapest },
      });
    }
    add({ label: "برنامهٔ خرید بچین", action: { type: "plan" } });
  } else if (kind === "compare") {
    add({ label: "برنامهٔ خرید بچین", action: { type: "plan" } });
    if (first) {
      add({
        label: "فروشگاه‌های نزدیک‌تر را ببین",
        action: { type: "stores", product_id: first.product_id },
      });
    }
    add({
      label: "ارزان‌ترین گزینه‌ها را نشان بده",
      action: { type: "search", patch: { sort: "price_asc" } },
    });
  } else if (kind === "stores") {
    add({ label: "برنامهٔ خرید بچین", action: { type: "plan" } });
    if (context.category) {
      add({
        label: "قیمت‌های این دسته را مقایسه کن",
        action: { type: "search", patch: { category: context.category, sort: "price_asc" } },
      });
    }
    if (first) {
      add({
        label: "فروشگاه‌های نزدیک‌تر را ببین",
        action: { type: "stores", product_id: first.product_id },
      });
    }
  } else if (kind === "plan") {
    add({
      label: "گزینهٔ ارزان‌تر جایگزین کن",
      action: { type: "search", patch: { sort: "price_asc" } },
    });
    add({
      label: "فروشگاه‌های نزدیک‌تر",
      action: { type: "stores", category: context.category },
    });
  } else if (kind === "alternatives") {
    if (context.product_id && subjectIds[0]) {
      add({
        label: "این گزینه را با کالای فعلی مقایسه کن",
        action: { type: "compare", product_ids: [context.product_id, subjectIds[0]] },
      });
    }
    add({
      label: "فروشگاه‌های این کالا را ببین",
      action: { type: "stores", product_id: subjectIds[0] ?? context.product_id },
    });
  } else if (kind === "inquiry") {
    if (contact) {
      add({ label: "فروشگاه‌های دیگر این کالا را ببین", action: { type: "stores" } });
    }
    add({ label: "برنامهٔ خرید بچین", action: { type: "plan" } });
  } else if (kind === "shop") {
    add({ label: "برنامهٔ خرید بچین", action: { type: "plan" } });
    add({
      label: "قیمت‌های این فروشگاه را ببین",
      action: { type: "search", patch: { sort: "price_asc" } },
    });
  }

  // 2. Budget is a real condition: offer the actions that make use of it.
  if (input.conditions.budgetMax && out.length < max) {
    add({
      label: "در بازهٔ بودجه فعلی گزینه‌های تازه نشان بده",
      action: {
        type: "search",
        patch: { sort: "price_asc", max_price: input.conditions.budgetMax ?? null },
      },
    });
  }

  return out.slice(0, max);
}

function cheapestOfferId(artifacts: ToolArtifact[]): string | null {
  for (const artifact of artifacts) {
    if (artifact.kind === "product") {
      const best =
        artifact.product.offers.find((o) => o.shop.website || o.shop.instagram) ??
        artifact.product.offers[0];
      if (best) return best.offer_id;
    }
  }
  return null;
}

/** Re-exported so the rules engine and the model path share one definition. */
export { inquiryNextStep };
