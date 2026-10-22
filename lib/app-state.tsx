import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AssistantContext,
  AssistantResponse,
  Block,
  Meta,
  Origin,
} from "@/shared/types";
import { api, ApiError } from "@/lib/api";

/* ------------------------------------------------------------------- meta */

interface MetaState {
  meta: Meta | null;
  error: string | null;
  reload: () => void;
}

const MetaContext = createContext<MetaState | null>(null);

export function MetaProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(null);
    api
      .meta()
      .then((value) => {
        if (alive) setMeta(value);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof ApiError ? err.message : "اطلاعات پایه بارگذاری نشد.");
      });
    return () => {
      alive = false;
    };
  }, [nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const value = useMemo(() => ({ meta, error, reload }), [meta, error, reload]);
  return <MetaContext.Provider value={value}>{children}</MetaContext.Provider>;
}

export function useMeta(): MetaState {
  const value = useContext(MetaContext);
  if (!value) throw new Error("useMeta must be used inside MetaProvider");
  return value;
}

/** For screens that render only after the metadata gate, so meta is present. */
export function useAppMeta(): Meta {
  const { meta } = useMeta();
  if (!meta) throw new Error("useAppMeta used before metadata loaded");
  return meta;
}

/* ----------------------------------------------------------------- origin */

const ORIGIN_KEY = "hamkharid.origin.v1";

interface OriginState {
  origin: Origin;
  isDefault: boolean;
  neighborhoods: { name: string; shop_count: number; lat: number; lon: number }[];
  setOrigin: (origin: Origin) => void;
  useNeighborhood: (name: string) => void;
  useGeolocation: () => Promise<string | null>;
  reset: () => void;
}

const OriginContext = createContext<OriginState | null>(null);

function readOrigin(meta: Meta): { origin: Origin; isDefault: boolean } {
  try {
    const raw = localStorage.getItem(ORIGIN_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Origin>;
      if (
        typeof parsed.lat === "number" &&
        typeof parsed.lon === "number" &&
        Math.abs(parsed.lat) <= 90 &&
        Math.abs(parsed.lon) <= 180
      ) {
        return {
          origin: {
            lat: parsed.lat,
            lon: parsed.lon,
            label: typeof parsed.label === "string" ? parsed.label : "نقطهٔ انتخابی",
            neighborhood: typeof parsed.neighborhood === "string" ? parsed.neighborhood : undefined,
          },
          isDefault: false,
        };
      }
    }
  } catch {
    /* ignore corrupt storage */
  }
  return { origin: meta.default_origin, isDefault: true };
}

export function OriginProvider({ meta, children }: { meta: Meta; children: ReactNode }) {
  const initial = useMemo(() => readOrigin(meta), [meta]);
  const [origin, setOriginState] = useState<Origin>(initial.origin);
  const [isDefault, setIsDefault] = useState(initial.isDefault);

  const persist = useCallback((next: Origin | null) => {
    if (next) localStorage.setItem(ORIGIN_KEY, JSON.stringify(next));
    else localStorage.removeItem(ORIGIN_KEY);
  }, []);

  const setOrigin = useCallback(
    (next: Origin) => {
      setOriginState(next);
      setIsDefault(false);
      persist(next);
    },
    [persist],
  );

  const useNeighborhood = useCallback(
    (name: string) => {
      const hood = meta.neighborhoods.find((n) => n.name === name);
      if (!hood) return;
      setOrigin({ lat: hood.lat, lon: hood.lon, label: hood.name, neighborhood: hood.name });
    },
    [meta.neighborhoods, setOrigin],
  );

  const useGeolocation = useCallback(
    () =>
      new Promise<string | null>((resolve) => {
        if (!navigator.geolocation) {
          resolve("مرورگر شما موقعیت مکانی را پشتیبانی نمی‌کند.");
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (position) => {
            setOrigin({
              lat: position.coords.latitude,
              lon: position.coords.longitude,
              label: "موقعیت من",
            });
            resolve(null);
          },
          () => resolve("دسترسی به موقعیت مکانی داده نشد."),
          { timeout: 8000, maximumAge: 60_000 },
        );
      }),
    [setOrigin],
  );

  const reset = useCallback(() => {
    setOriginState(meta.default_origin);
    setIsDefault(true);
    persist(null);
  }, [meta.default_origin, persist]);

  const value = useMemo(
    () => ({
      origin,
      isDefault,
      neighborhoods: meta.neighborhoods,
      setOrigin,
      useNeighborhood,
      useGeolocation,
      reset,
    }),
    [origin, isDefault, meta.neighborhoods, setOrigin, useNeighborhood, useGeolocation, reset],
  );

  useEffect(() => {
    if (!isDefault) persist(origin);
  }, [origin, isDefault, persist]);

  return <OriginContext.Provider value={value}>{children}</OriginContext.Provider>;
}

export function useOrigin(): OriginState {
  const value = useContext(OriginContext);
  if (!value) throw new Error("useOrigin must be used inside OriginProvider");
  return value;
}

/* ----------------------------------------------------------------- basket */

const BASKET_KEY = "hamkharid.basket.v1";

export interface BasketItem {
  offer_id: string;
  product_id: string;
  title: string;
  price: number;
  image: string | null;
  shop_id: string;
  shop_name: string;
  neighborhood: string | null;
}

interface BasketState {
  items: BasketItem[];
  add: (item: BasketItem) => void;
  remove: (offerId: string) => void;
  hasProduct: (productId: string) => boolean;
  clear: () => void;
  total: number;
}

const BasketContext = createContext<BasketState | null>(null);

function readBasket(): BasketItem[] {
  try {
    const raw = localStorage.getItem(BASKET_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is BasketItem =>
          item &&
          typeof item.offer_id === "string" &&
          typeof item.product_id === "string" &&
          typeof item.price === "number" &&
          typeof item.title === "string",
      )
      .slice(0, 25);
  } catch {
    return [];
  }
}

export function BasketProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<BasketItem[]>(readBasket);

  useEffect(() => {
    localStorage.setItem(BASKET_KEY, JSON.stringify(items.slice(0, 25)));
  }, [items]);

  const add = useCallback((item: BasketItem) => {
    setItems((current) => {
      const withoutProduct = current.filter((entry) => entry.product_id !== item.product_id);
      return [item, ...withoutProduct].slice(0, 25);
    });
  }, []);

  const remove = useCallback((offerId: string) => {
    setItems((current) => current.filter((entry) => entry.offer_id !== offerId));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const hasProduct = useCallback(
    (productId: string) => items.some((entry) => entry.product_id === productId),
    [items],
  );

  const total = useMemo(() => items.reduce((sum, item) => sum + item.price, 0), [items]);

  const value = useMemo(
    () => ({ items, add, remove, hasProduct, clear, total }),
    [items, add, remove, hasProduct, clear, total],
  );

  return <BasketContext.Provider value={value}>{children}</BasketContext.Provider>;
}

export function useBasket(): BasketState {
  const value = useContext(BasketContext);
  if (!value) throw new Error("useBasket must be used inside BasketProvider");
  return value;
}

/* ------------------------------------------------------------------- chat */

const CHAT_KEY = "hamkharid.chat.v1";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  blocks?: Block[];
  suggestions?: string[];
  meta?: AssistantResponse["meta"];
  failed?: boolean;
}

interface ChatState {
  messages: ChatMessage[];
  sending: boolean;
  error: string | null;
  send: (text: string, contextOverride?: AssistantContext) => Promise<void>;
  retry: () => Promise<void>;
  reset: () => void;
  setError: (message: string | null) => void;
}

const ChatContext = createContext<ChatState | null>(null);

interface StoredChat {
  messages: ChatMessage[];
  context: AssistantContext;
}

function readChat(): StoredChat {
  try {
    const raw = localStorage.getItem(CHAT_KEY);
    if (!raw) return { messages: [], context: {} };
    const parsed = JSON.parse(raw) as Partial<StoredChat>;
    return {
      messages: Array.isArray(parsed.messages)
        ? parsed.messages
            .filter(
              (m): m is ChatMessage =>
                Boolean(m) && typeof m.text === "string" && (m.role === "user" || m.role === "assistant"),
            )
            .slice(-24)
        : [],
      context: parsed.context && typeof parsed.context === "object" ? parsed.context : {},
    };
  } catch {
    return { messages: [], context: {} };
  }
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const stored = useMemo(readChat, []);
  const [messages, setMessages] = useState<ChatMessage[]>(stored.messages);
  const [context, setContext] = useState<AssistantContext>(stored.context);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastAttempt = useRef<{ text: string; override?: AssistantContext } | null>(null);
  const basket = useBasket();
  const { origin } = useOrigin();

  useEffect(() => {
    localStorage.setItem(
      CHAT_KEY,
      JSON.stringify({ messages: messages.slice(-24), context }),
    );
  }, [messages, context]);

  const run = useCallback(
    async (text: string, override?: AssistantContext) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;
      lastAttempt.current = { text: trimmed, override };
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        text: trimmed,
      };
      // Bounded history so «همین رو ارزون‌تر پیدا کن» keeps its subject.
      const history = messages.slice(-6).map((message) => ({
        role: message.role,
        text: message.text,
      }));
      setMessages((current) => [...current, userMessage].slice(-24));
      setSending(true);
      setError(null);
      try {
        const response = await api.assistant(
          trimmed,
          {
            ...context,
            ...override,
            origin,
            offer_ids: basket.items.map((item) => item.offer_id),
          },
          history,
        );
        const assistantMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          text: response.reply,
          blocks: response.blocks,
          suggestions: response.suggestions,
          meta: response.meta,
        };
        setMessages((current) => [...current, assistantMessage].slice(-24));
        setContext(response.context);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "پاسخ دستیار دریافت نشد.");
      } finally {
        setSending(false);
      }
    },
    [basket.items, context, messages, origin, sending],
  );

  const retry = useCallback(async () => {
    const attempt = lastAttempt.current;
    if (!attempt) return;
    await run(attempt.text, attempt.override);
  }, [run]);

  const reset = useCallback(() => {
    setMessages([]);
    setContext({});
    setError(null);
    lastAttempt.current = null;
  }, []);

  const value = useMemo(
    () => ({ messages, sending, error, send: run, retry, reset, setError }),
    [messages, sending, error, run, retry, reset],
  );
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatState {
  const value = useContext(ChatContext);
  if (!value) throw new Error("useChat must be used inside ChatProvider");
  return value;
}
