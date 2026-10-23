import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Camera,
  Check,
  Copy,
  Headphones,
  MapPin,
  RotateCcw,
  Route,
  Smartphone,
  Sparkles,
  Wallet,
} from "lucide-react";
import { useAppMeta, useBasket, useChat, useOrigin } from "@/lib/app-state";
import type { InquiryStatus, NextStep } from "@/shared/types";
import { cn } from "@/lib/utils";
import { fa, faNumber } from "@/lib/format";
import { BlockView } from "@/components/Blocks";
import { Skeleton } from "@/components/ui/skeleton";

/** Follow-up status the user reported on a seller inquiry; never a Torobyar claim. */
const INQUIRY_KEY = "hamkharid.inquiry.v1";
const INQUIRY_STATUSES: InquiryStatus[] = [
  "awaiting",
  "no_response",
  "stock_confirmed",
  "not_found",
  "price_reported",
  "failed",
];

const PROMPTS = [
  {
    icon: Headphones,
    title: "هدفون بی‌سیم زیر ۵ میلیون",
    hint: "مقایسهٔ فروشنده‌ها با بودجهٔ مشخص",
    message: "هدفون بی‌سیم زیر ۵ میلیون",
  },
  {
    icon: Smartphone,
    title: "گوشی سامسونگ تا ۲۰ میلیون",
    hint: "ارزان‌ترین قیمت و تازگی آن",
    message: "گوشی سامسونگ تا ۲۰ میلیون",
  },
  {
    icon: Camera,
    title: "فروشگاه دوربین مدار بسته نزدیک من",
    hint: "فاصله، نشانی و ساعت کاری",
    message: "نزدیک‌ترین فروشگاه دوربین مدار بسته",
  },
  {
    icon: Route,
    title: "یک برنامهٔ خرید حضوری بچین",
    hint: "چند ایست نزدیک و تخمین مسیر",
    message: "برنامهٔ خرید بچین",
  },
];

function AgentMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-control bg-brand/10 text-brand ring-1 ring-brand/15",
        className,
      )}
      aria-hidden
    >
      <Sparkles className="size-4" strokeWidth={2} />
    </span>
  );
}

function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-ee-md bg-brand px-4 py-2.5 text-sm leading-7 text-brand-foreground shadow-control">
        {text}
      </div>
    </div>
  );
}

function AssistantMessage({
  text,
  blocks,
  meta,
  interaction,
}: {
  text: string;
  blocks?: React.ComponentProps<typeof BlockView>["block"][];
  meta?: { engine: string; intent: string; ms: number };
  interaction?: React.ComponentProps<typeof BlockView>["interaction"];
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard is a nicety, not a requirement */
    }
  }

  return (
    <div className="flex gap-3">
      <AgentMark className="mt-1" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs font-semibold text-foreground">
              ترب‌یار
              <span className="font-normal text-muted-foreground">دستیار خرید</span>
            </p>
            <p className="mt-1 whitespace-pre-line text-sm leading-8 text-foreground sm:text-base sm:leading-9">
              {text}
            </p>
          </div>
          <button
            type="button"
            onClick={copy}
            aria-label="کپی پاسخ"
            className="flex size-11 shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {copied ? <Check className="size-4" strokeWidth={2} aria-hidden /> : <Copy className="size-4" strokeWidth={1.5} aria-hidden />}
          </button>
        </div>

        {blocks && blocks.length > 0 && (
          <div className="mt-3 flex flex-col gap-5">
            {blocks.map((block, index) => (
              <BlockView
                key={`${block.type}-${index}`}
                block={block}
                interaction={interaction}
              />
            ))}
          </div>
        )}

        {meta && import.meta.env.DEV && (
          <details className="mt-3 rounded-control border-line border-border bg-card p-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer">پنل توسعه</summary>
            <pre dir="ltr" className="mt-2 overflow-auto text-xs">
              {JSON.stringify({ engine: meta.engine, intent: meta.intent, ms: meta.ms }, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

function Typing() {
  return (
    <div className="flex gap-3" aria-live="polite">
      <AgentMark className="mt-1" />
      <div className="w-full max-w-md rounded-surface border-line border-border bg-card p-4 shadow-surface">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1" aria-hidden>
            <span className="size-1.5 animate-pulse rounded-full bg-brand" />
            <span className="size-1.5 animate-pulse rounded-full bg-brand [animation-delay:150ms]" />
            <span className="size-1.5 animate-pulse rounded-full bg-brand [animation-delay:300ms]" />
          </span>
          در حال بررسی قیمت‌ها و فروشگاه‌ها…
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
          <div className="mt-1 grid grid-cols-2 gap-2">
            <Skeleton className="aspect-4/3 w-full" />
            <Skeleton className="aspect-4/3 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChatPage() {
  const meta = useAppMeta();
  const { origin } = useOrigin();
  const basket = useBasket();
  const { messages, sending, error, send, retry, reset } = useChat();
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const [inquiryStatus, setInquiryStatus] = useState<InquiryStatus | null>(() => {
    const raw = localStorage.getItem(INQUIRY_KEY);
    return (INQUIRY_STATUSES as string[]).includes(raw ?? "") ? (raw as InquiryStatus) : null;
  });
  const [params, setParams] = useSearchParams();
  const handledAsk = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ask = params.get("ask");
    if (!ask || handledAsk.current) return;
    handledAsk.current = true;
    const product = params.get("product") ?? undefined;
    void send(ask, product ? { product_id: product } : undefined);
    setParams({}, { replace: true });
  }, [params, send, setParams]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, sending]);

  function submit(text: string) {
    const value = text.trim();
    if (!value || sending) return;
    setDraft("");
    void send(value, inquiryStatus ? { inquiry_status: inquiryStatus } : undefined);
  }

  /**
   * Runs a suggestion. Actions that own a page open it; the rest are handed to
   * the assistant as the natural-language request the action carries, so a
   * suggestion always does something real.
   */
  function runSuggestion(step: NextStep) {
    if (sending) return;
    const action = step.action;
    if (action.type === "message") {
      submit(action.text);
      return;
    }
    if (action.type === "plan") {
      void navigate("/plan");
      return;
    }
    if (action.type === "stores") {
      void navigate("/stores");
      return;
    }
    submit(action.request);
  }

  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const suggestions = lastAssistant?.suggestions ?? [];

  const interaction = {
    pick: (label: string) => submit(label),
    reportInquiry: (status: InquiryStatus) => {
      setInquiryStatus(status);
      localStorage.setItem(INQUIRY_KEY, status);
    },
    inquiryStatus,
  };
  const empty = messages.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      {empty ? (
        <section className="rise flex flex-col gap-5">
          <div className="agent-wash relative overflow-hidden rounded-surface border-line border-border bg-card shadow-surface">
            <div className="agent-grid pointer-events-none absolute inset-0" aria-hidden />
            <div className="relative flex flex-col gap-4 px-5 py-7 sm:px-8 sm:py-9">
              <p className="inline-flex w-fit items-center gap-2 rounded-full border-line border-brand/20 bg-brand/5 px-3 py-1 text-xs font-medium text-brand">
                <Sparkles className="size-3.5" strokeWidth={2} aria-hidden />
                دستیار خرید هوشمند
              </p>
              <div className="flex flex-col gap-3">
                <h1 className="max-w-xl text-2xl font-bold leading-tight sm:text-4xl">
                  بگویید چه می‌خواهید بخرید
                </h1>
                <p className="max-w-2xl text-sm leading-8 text-muted-foreground sm:text-base sm:leading-9">
                  به‌جای گشتن در فروشگاه‌ها، فقط بپرسید. قیمت‌های ثبت‌شدهٔ فروشگاه‌های تهران را مقایسه
                  می‌کنم، تازگی هر قیمت را نشان می‌دهم و اگر بخواهید، مسیر یک خرید حضوری را می‌چینم.
                </p>
              </div>
              <dl className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <dt>کالا</dt>
                  <dd className="font-medium text-foreground">{faNumber(meta.counts.products)}</dd>
                </div>
                <div className="flex items-center gap-1.5">
                  <dt>پیشنهاد قیمت</dt>
                  <dd className="font-medium text-foreground">{faNumber(meta.counts.offers)}</dd>
                </div>
                <div className="flex items-center gap-1.5">
                  <dt>فروشگاه</dt>
                  <dd className="font-medium text-foreground">{faNumber(meta.counts.shops)}</dd>
                </div>
                <div className="flex items-center gap-1.5">
                  <MapPin className="size-3.5 text-brand" strokeWidth={1.5} aria-hidden />
                  <dt>شروع از</dt>
                  <dd className="font-medium text-foreground">{origin.label ?? "فردوسی"}</dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-xs font-medium text-foreground">یک شروع سریع</p>
              <p className="text-xs text-muted-foreground">یا سؤال خودتان را بنویسید</p>
            </div>
            <div className="stagger grid gap-2 sm:grid-cols-2">
              {PROMPTS.map((prompt) => (
                <button
                  key={prompt.title}
                  type="button"
                  onClick={() => submit(prompt.message)}
                  className="card-lift group flex min-h-16 items-center gap-3 rounded-surface border-line border-border bg-card p-3 text-start shadow-surface hover:bg-accent"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-brand/8 text-brand">
                    <prompt.icon className="size-4" strokeWidth={1.5} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium leading-6">{prompt.title}</span>
                    <span className="block text-xs text-muted-foreground">{prompt.hint}</span>
                  </span>
                  <ArrowLeft
                    className="size-4 shrink-0 text-muted-foreground/60 transition-transform duration-(--motion) ease-motion group-hover:-translate-x-0.5 group-hover:text-brand"
                    strokeWidth={1.5}
                    aria-hidden
                  />
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="size-3.5 text-brand" strokeWidth={1.5} aria-hidden />
              نقطهٔ شروع فاصله‌ها: {origin.label ?? "فردوسی"}
            </p>
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-11 items-center gap-1.5 rounded-control px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <RotateCcw className="size-3.5" strokeWidth={1.5} aria-hidden />
              گفت‌وگوی تازه
            </button>
          </div>

          <div className="flex flex-col gap-7" aria-live="polite">
            {messages.map((message) =>
              message.role === "user" ? (
                <UserMessage key={message.id} text={message.text} />
              ) : (
                <AssistantMessage
                  key={message.id}
                  text={message.text}
                  blocks={message.blocks}
                  meta={message.meta}
                />
              ),
            )}
            {sending && <Typing />}
          </div>
        </>
      )}

      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-surface border-line border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void retry()}
            className="inline-flex h-11 items-center rounded-control border-line border-destructive/30 px-3 text-xs font-medium"
          >
            تلاش دوباره
          </button>
        </div>
      )}

      {suggestions.length > 0 && !sending && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-foreground">قدم بعدی</p>
          <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
            {suggestions.map((step) => (
              <button
                key={step.label}
                type="button"
                onClick={() => runSuggestion(step)}
                className="flex h-11 shrink-0 items-center gap-1.5 rounded-full border-line border-border bg-card px-3 text-xs shadow-control transition-colors hover:border-brand/40 hover:bg-accent"
              >
                <Sparkles className="size-3.5 text-brand" strokeWidth={1.5} aria-hidden />
                {step.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="sticky above-nav z-30 -mx-4 mt-auto bg-gradient-to-t from-background via-background/95 to-transparent px-4 pb-2 pt-6 md:mx-0 md:px-0">
        <form
          className="flex items-end gap-2 rounded-surface border-line border-border bg-card p-2 shadow-float transition-shadow focus-within:border-brand/40 focus-within:ring-2 focus-within:ring-brand/10"
          onSubmit={(event) => {
            event.preventDefault();
            submit(draft);
          }}
        >
          <span className="mb-0.5 hidden size-10 shrink-0 items-center justify-center rounded-control bg-brand/8 text-brand sm:flex" aria-hidden>
            <Sparkles className="size-4" strokeWidth={2} />
          </span>
          <label htmlFor="chat-input" className="sr-only">
            پیام به ترب‌یار
          </label>
          <textarea
            id="chat-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit(draft);
              }
            }}
            rows={1}
            placeholder="مثلاً: هدفون بی‌سیم زیر ۵ میلیون در فردوسی"
            className={cn(
              "max-h-32 min-h-11 flex-1 resize-none rounded-control bg-transparent px-2 py-2.5 text-sm leading-6",
              "placeholder:text-muted-foreground/70 focus-visible:outline-none",
            )}
          />
          <button
            type="submit"
            disabled={sending || draft.trim().length === 0}
            aria-label="ارسال پیام"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-control transition-[background-color,opacity,transform] duration-(--motion) ease-motion hover:bg-brand/90 disabled:bg-secondary disabled:text-muted-foreground disabled:shadow-none active:[transform:var(--press)]"
          >
            <ArrowLeft className="size-5" strokeWidth={2} aria-hidden />
          </button>
        </form>
        <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <Wallet className="size-3.5" strokeWidth={1.5} aria-hidden />
          {basket.items.length > 0
            ? `${fa(basket.items.length)} قلم در برنامهٔ خرید شماست؛ بگویید «برنامهٔ خرید بچین».`
            : "بودجه، محله یا برند را کنار نام کالا بنویسید تا دقیق‌تر پیدا کنم."}
        </p>
      </div>

      <div ref={endRef} />
    </div>
  );
}
