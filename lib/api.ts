import type {
  AssistantContext,
  AssistantHistoryTurn,
  AssistantResponse,
  HealthResponse,
  Meta,
  Origin,
  Plan,
  ProductDetail,
  SearchParams,
  SearchResult,
  ShopDetail,
  ShopSearchParams,
  ShopSearchResult,
} from "@/shared/types";

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function buildQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "" || Number.isNaN(value)) continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

function withOrigin(params: Record<string, unknown>, origin?: Origin | null): Record<string, unknown> {
  if (!origin) return params;
  return { ...params, lat: origin.lat, lon: origin.lon };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError("ارتباط با سرور برقرار نشد. مطمئن شوید سرور اجراست.", 0);
  }
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : "درخواست انجام نشد.";
    throw new ApiError(message, response.status);
  }
  return payload as T;
}

export const api = {
  health: () => request<HealthResponse>("/api/health"),
  meta: () => request<Meta>("/api/meta"),

  search: (params: SearchParams, origin?: Origin | null) =>
    request<SearchResult>(`/api/search${buildQuery(withOrigin({ ...params }, origin))}`),

  product: (id: string, origin?: Origin | null) =>
    request<ProductDetail>(`/api/products/${encodeURIComponent(id)}${buildQuery(withOrigin({}, origin))}`),

  shops: (params: ShopSearchParams, origin?: Origin | null) =>
    request<ShopSearchResult>(`/api/shops${buildQuery(withOrigin({ ...params }, origin))}`),

  shop: (id: string, origin?: Origin | null) =>
    request<ShopDetail>(`/api/shops/${encodeURIComponent(id)}${buildQuery(withOrigin({}, origin))}`),

  plan: (offerIds: string[], origin: Origin) =>
    request<Plan>("/api/plan", {
      method: "POST",
      body: JSON.stringify({ offer_ids: offerIds, origin }),
    }),

  assistant: (message: string, context: AssistantContext, history?: AssistantHistoryTurn[]) =>
    request<AssistantResponse>("/api/assistant", {
      method: "POST",
      body: JSON.stringify({ message, context, history }),
    }),
};
