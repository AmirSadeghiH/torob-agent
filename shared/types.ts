/**
 * Shared contract between the Express API and the React client.
 * Types only — nothing here reaches the browser as runtime code.
 */

export type FreshnessLevel = "fresh" | "recent" | "stale" | "old" | "unknown";

export interface Origin {
  lat: number;
  lon: number;
  label?: string;
  neighborhood?: string;
}

export type ShopIdentity = "registered" | "anonymized";

/**
 * Where a fact came from. Never inferred from a name, a category or the model.
 * `unknown` means «we have no reliable source», not «the field is false».
 */
export type Provenance =
  | "dataset"
  | "seller_reported"
  | "user_reported"
  | "verified_integration"
  | "unknown";

/**
 * Per-capability status. `unregistered` and `unknown` are deliberately kept
 * apart from `unsupported`: a missing field must never read as «does not
 * support it».
 */
export type CapabilityStatus = "recorded" | "unregistered" | "unsupported" | "unknown";

export interface ShopCapability {
  key:
    | "tebpi"
    | "installment"
    | "invoice"
    | "fast_delivery"
    | "payments"
    | "hours"
    | "contact";
  label: string;
  status: CapabilityStatus;
  source: Provenance;
  /** One honest Persian sentence, e.g. «ارسال سریع: ثبت‌شده در دیتاست». */
  detail: string;
}

export interface StoreRef {
  shop_id: string;
  name: string;
  /** «registered» فقط یعنی سایت/اینستاگرام در دیتاست ثبت شده؛ تأیید مستقل نیست. */
  identity: ShopIdentity;
  neighborhood: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  distance_m: number | null;
  website: string | null;
  instagram: string | null;
}

export interface Spec {
  key: string;
  value: string;
  section: string;
}

export interface ReliabilitySignal {
  key: string;
  label: string;
  detail: string;
  tone: "good" | "warn" | "bad" | "neutral";
  points: number;
}

export interface Reliability {
  score: number;
  level: "high" | "medium" | "low" | "unknown";
  label: string;
  summary: string;
  signals: ReliabilitySignal[];
}

export interface OfferView {
  offer_id: string;
  product_id: string;
  price: number;
  changed_at: string | null;
  age_days: number | null;
  freshness: FreshnessLevel;
  freshness_label: string;
  title: string | null;
  warranty: string | null;
  description: string | null;
  shop: StoreRef;
  reliability: Reliability;
}

export interface ProductBest {
  offer_id: string;
  price: number;
  shop_id: string;
  shop_name: string;
  neighborhood: string | null;
  changed_at: string | null;
  age_days: number | null;
  freshness: FreshnessLevel;
  distance_m: number | null;
  /** Public contact channels registered in the dataset (never a phone number). */
  website: string | null;
  instagram: string | null;
}

export interface ProductCard {
  product_id: string;
  title: string;
  brand: string | null;
  category: string;
  image: string | null;
  min_price: number | null;
  max_price: number | null;
  offer_count: number;
  best: ProductBest | null;
  newest_at: string | null;
  freshness: FreshnessLevel;
}

export interface ProductDetail extends ProductCard {
  images: string[];
  specs: Spec[];
  offers: OfferView[];
  market: {
    min: number | null;
    median: number | null;
    max: number | null;
    spread_percent: number | null;
    priced_offers: number;
    fresh_offers: number;
  };
  alternatives: ProductCard[];
}

export interface StoreCard extends StoreRef {
  categories: string[];
  website: string | null;
  instagram: string | null;
  fast_delivery: boolean;
  offer_count: number;
  hours_today: DayHours | null;
  open_now: boolean | null;
  /** Buying capabilities with explicit status and provenance, never guessed. */
  capabilities: ShopCapability[];
  /** How many offers of the current query this shop has, when known. */
  matched_offers?: number;
}

export interface DayHours {
  status: "declared" | "closed" | "unsupported" | "unknown";
  shifts: { start: string; end: string }[];
}

export interface ShopProduct {
  product_id: string;
  title: string;
  image: string | null;
  price_at_shop: number;
  offer_count: number;
}

export interface ShopDetail extends StoreCard {
  payments: string[];
  hours: Record<string, DayHours>;
  top_products: ShopProduct[];
}

export interface CategoryInfo {
  name: string;
  product_count: number;
  shop_count: number;
}

export interface NeighborhoodInfo {
  name: string;
  lat: number;
  lon: number;
  shop_count: number;
  offer_count: number;
}

export interface Meta {
  counts: {
    products: number;
    offers: number;
    shops: number;
    categories: number;
    neighborhoods: number;
    comparable_products: number;
  };
  categories: CategoryInfo[];
  neighborhoods: NeighborhoodInfo[];
  brands: string[];
  default_origin: Origin;
  data: {
    imported_at: string | null;
    price_newest: string | null;
    price_oldest: string | null;
    priced_offers: number;
  };
  assistant: { engine: "rules" | "llm_agent"; note: string };
}

export interface SearchParams {
  q?: string;
  category?: string;
  brand?: string;
  neighborhood?: string;
  min_price?: number;
  max_price?: number;
  min_offers?: number;
  max_age_days?: number;
  sort?: "relevance" | "price_asc" | "price_desc" | "offers" | "freshness";
  page?: number;
  page_size?: number;
  lat?: number;
  lon?: number;
  radius_m?: number;
}

export interface ShopSearchParams {
  q?: string;
  neighborhood?: string;
  category?: string;
  sort?: "offers" | "name" | "distance";
  page?: number;
  page_size?: number;
  lat?: number;
  lon?: number;
  radius_m?: number;
}

export interface SearchResult {
  items: ProductCard[];
  total: number;
  page: number;
  page_size: number;
  took_ms: number;
  applied: Record<string, string | number | null>;
}

export interface ShopSearchResult {
  items: StoreCard[];
  total: number;
  page: number;
  page_size: number;
  took_ms: number;
}

export type MapPointKind = "origin" | "shop";

export interface MapPoint {
  id: string;
  label: string;
  lat: number;
  lon: number;
  kind: MapPointKind;
  distance_m: number | null;
  meta?: string;
  order?: number;
}

export interface PlanItem {
  offer_id: string;
  product_id: string;
  title: string;
  price: number;
  age_days: number | null;
  freshness: FreshnessLevel;
  image: string | null;
}

export interface PlanStop {
  order: number;
  shop: StoreRef;
  items: PlanItem[];
  subtotal: number;
  oldest_age_days: number | null;
  distance_from_prev_m: number | null;
  leg_minutes: number | null;
}

export interface Plan {
  origin: Origin;
  stops: PlanStop[];
  item_count: number;
  total: number;
  total_distance_m: number;
  walk_minutes: number;
  visit_minutes: number;
  warnings: string[];
  neighborhoods: string[];
}

/* ------------------------------------------------------- routes (Neshan) */

export type TravelMode = "walk" | "car" | "motorcycle";

/**
 * Stop order provenance. `tsp` = Neshan `v3/trip` really optimized it,
 * `nearest` = straight-line nearest-neighbour fallback (never called optimal),
 * `fixed` = the order the client/dataset already had.
 */
export type RouteOptimization = "tsp" | "nearest" | "fixed";

/** GeoJSON order: [longitude, latitude]. */
export type LonLat = [number, number];

export interface RouteStop {
  shop_id: string;
  name: string;
  neighborhood: string | null;
  address: string | null;
  lat: number;
  lon: number;
  order: number;
  /** From the routing service only — null when the provider returned fewer legs. */
  distance_from_prev_m: number | null;
  duration_from_prev_s: number | null;
}

export interface RoutePlan {
  mode: TravelMode;
  optimization: RouteOptimization;
  /** Persian, user-facing explanation of how the stop order was decided. */
  optimization_note: string;
  provider: "mapir" | "neshan";
  origin: Origin;
  stops: RouteStop[];
  return_to_origin: boolean;
  /** Real road/pavement geometry from the routing provider, never a straight line. */
  geometry: LonLat[];
  distance_m: number;
  duration_s: number;
  alternatives: { index: number; distance_m: number; duration_s: number }[];
  excluded: { shop_id: string; reason: string }[];
  warnings: string[];
}

export interface RouteRequest {
  shop_ids: string[];
  origin: Origin;
  mode: TravelMode;
  optimize?: boolean;
  return_to_origin?: boolean;
  alternative?: boolean;
}

export interface ComparisonColumn {
  product_id: string;
  title: string;
  brand: string | null;
  image: string | null;
  price: number | null;
  offer_count: number;
  freshness: FreshnessLevel;
  age_days: number | null;
  neighborhood: string | null;
  best_shop: string | null;
}

export interface ComparisonRow {
  label: string;
  values: (string | null)[];
  highlight: "lowest" | "freshest" | null;
  best_index?: number | null;
}

export interface AppliedFilters {
  q: string | null;
  category: string | null;
  brand: string | null;
  neighborhood: string | null;
  min_price: number | null;
  max_price: number | null;
  max_age_days: number | null;
  min_offers: number | null;
  sort: SearchParams["sort"] | null;
  radius_m: number | null;
}

/* ------------------------------------------------------- seller inquiry */

/**
 * Follow-up state for a prepared seller inquiry. The app never claims it
 * called the seller or received an answer: opening a channel is not sending
 * a message, and only `user_reported` states are user-entered.
 */
export type InquiryStatus =
  | "ready"
  | "opened"
  | "awaiting"
  | "stock_confirmed"
  | "price_reported"
  | "not_found"
  | "no_response"
  | "failed";

export interface InquiryContact {
  kind: "website" | "instagram";
  label: string;
  href: string;
}

export interface Inquiry {
  id: string;
  offer_id: string;
  product_id: string;
  product_title: string;
  shop_id: string;
  shop_name: string;
  neighborhood: string | null;
  price: number;
  changed_at: string | null;
  freshness: FreshnessLevel;
  contacts: InquiryContact[];
  message: string;
  status: InquiryStatus;
  note: string | null;
  reported_price: number | null;
  created_at: string;
  updated_at: string;
}

export interface InsightItem {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "warn" | "bad" | "neutral";
}

export type Block =
  | {
      type: "products";
      title: string;
      subtitle?: string;
      products: ProductCard[];
      layout?: "grid" | "list";
    }
  | {
      type: "offers";
      title: string;
      subtitle?: string;
      product_id: string;
      product_title: string;
      offers: OfferView[];
      best_offer_id: string;
    }
  | {
      type: "compare";
      title: string;
      subtitle?: string;
      columns: ComparisonColumn[];
      rows: ComparisonRow[];
      note?: string;
    }
  | {
      type: "stores";
      title: string;
      subtitle?: string;
      stores: StoreCard[];
      origin: Origin | null;
    }
  | {
      type: "map";
      title: string;
      subtitle?: string;
      points: MapPoint[];
      origin: Origin | null;
      route_order: string[];
    }
  | {
      type: "filters";
      title: string;
      subtitle?: string;
      active: AppliedFilters;
      options: {
        categories: string[];
        neighborhoods: string[];
        brands: string[];
      };
      origin: Origin | null;
      /** Distance radius in metres, or null when the search is city-wide. */
      radius_m: number | null;
    }
  | {
      type: "reliability";
      title: string;
      offer: OfferView;
      product_id: string;
      product_title: string;
    }
  | { type: "plan"; title: string; plan: Plan }
  | { type: "insight"; title: string; items: InsightItem[] }
  | {
      type: "seller_inquiry";
      title: string;
      subtitle?: string;
      product_id: string;
      product_title: string;
      offer: OfferView;
      contacts: InquiryContact[];
      /** Server-built, user-editable draft. The user decides whether to send it. */
      message: string;
    }
  | {
      type: "seller_followup";
      title: string;
      subtitle?: string;
      inquiry_id: string;
      product_title: string;
      shop_name: string;
      price: number;
      status: InquiryStatus;
      note: string | null;
      contacts: InquiryContact[];
      message: string;
    }
  | {
      type: "preference_picker";
      title: string;
      subtitle?: string;
      question: string;
      options: { key: string; label: string; description?: string }[];
      value?: string;
    }
  | {
      type: "decision_summary";
      title: string;
      product_title: string;
      budget: number | null;
      best_offer_id: string;
      reasons: InsightItem[];
      next_step: string;
      warnings?: string[];
    }
  | {
      type: "note";
      title?: string;
      body: string;
      tone: "info" | "warn" | "success";
      /** Real, parameter-carrying next steps (e.g. raise the budget, drop filters). */
      actions?: { label: string; to: string }[];
    };

export type AssistantIntent =
  | "greeting"
  | "help"
  | "search"
  | "offers"
  | "compare"
  | "nearby"
  | "stores"
  | "plan"
  | "freshness"
  | "alternatives"
  | "inquiry"
  | "unknown";

export interface AssistantContext {
  product_id?: string;
  product_title?: string;
  category?: string;
  query?: string;
  offer_ids?: string[];
  origin?: Origin;
  /** Live purchase conditions carried by the interactive panel, so a follow-up
   *  («همین رو ارزون‌تر») keeps the budget the user just moved on screen. */
  budget?: { min?: number; max?: number } | null;
  neighborhood?: string;
  radius_m?: number;
  sort?: SearchParams["sort"];
  min_offers?: number;
  max_age_days?: number;
  /** A preference the user picked without writing it (budget, category, …). */
  preference?: string;
  /** Last inquiry the user reported on, so «پاسخ نداد» keeps its subject. */
  inquiry_status?: InquiryStatus;
}

/** A bounded slice of the conversation so follow-ups keep their subject. */
export interface AssistantHistoryTurn {
  role: "user" | "assistant";
  text: string;
}

/** Partial purchase conditions, mirroring the interactive panel's controls. */
export interface FilterPatch {
  q?: string | null;
  category?: string | null;
  brand?: string | null;
  neighborhood?: string | null;
  min_price?: number | null;
  max_price?: number | null;
  min_offers?: number | null;
  max_age_days?: number | null;
  sort?: SearchParams["sort"] | null;
  radius_m?: number | null;
}

/**
 * An action a suggestion can actually run. The client validates the action
 * before it executes; a suggestion without a real action is never shown.
 */
export type NextStepAction =
  | { type: "search"; patch?: FilterPatch; request: string }
  | { type: "compare"; product_ids: string[]; request: string }
  | { type: "inquiry"; offer_id?: string; product_id?: string; request: string }
  | { type: "plan"; request: string }
  | { type: "alternatives"; product_id: string; request: string }
  | { type: "stores"; product_id?: string; shop_id?: string; category?: string; request: string }
  | { type: "message"; text: string; request: string };

/** A labelled, runnable next step produced from real tool results. */
export interface NextStep {
  label: string;
  action: NextStepAction;
}

export interface AssistantRequest {
  message: string;
  context?: AssistantContext;
  history?: AssistantHistoryTurn[];
}

export interface AssistantResponse {
  reply: string;
  blocks: Block[];
  suggestions: NextStep[];
  context: AssistantContext;
  meta: {
    /** `llm_agent` = the model chose and ran the tools; `rules_fallback` = deterministic engine answered. */
    engine: "rules" | "llm_agent" | "rules_fallback";
    ms: number;
    intent: AssistantIntent;
    tool_calls: string[];
    parsed: Record<string, string | number | boolean | null>;
    /** Configured model identifier when the LLM agent was the engine. */
    model?: string | null;
  };
}

export interface HealthResponse {
  ok: boolean;
  db: { path: string; size_mb: number; ready: boolean };
  counts: { products: number; offers: number; shops: number };
  imported_at: string | null;
}
