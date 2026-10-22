import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Camera,
  Check,
  Copy,
  Headphones,
  RotateCcw,
  Route,
  Smartphone,
  Sparkles,
  Wallet,
} from "lucide-react";
import { useAppMeta, useBasket, useChat, useOrigin } from "@/lib/app-state";
import { cn } from "@/lib/utils";
import { fa, faNumber } from "@/lib/format";
import { BlockView } from "@/components/Blocks";
import { Skeleton } from "@/components/ui/skeleton";

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

function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-ee-md bg-secondary px-4 py-2.5 text-sm leading-7 text-secondary-foreground">
        {text}
      </div>
    </div>
  );
}

function AssistantMessage({
  text,
  blocks,
  meta,
}: {
  text: string;
  blocks?: React.ComponentProps<typeof BlockView>["block"][];
  meta?: { engine: string; intent: string; ms: number };
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
      <span
        className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand"
        aria-hidden
      >
        <Sparkles className="size-4" strokeWidth={1.5} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="whitespace-pre-line text-sm leading-8 text-foreground">{text}</p>
          <button
            type="button"
            onClick={copy}
            aria-label="کپی پاسخ"
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {copied ? <Check className="size-4" strokeWidth={2} aria-hidden /> : <Copy className="size-4" strokeWidth={1.5} aria-hidden />}
          </button>
        </div>

        {blocks && blocks.length > 0 && (
          <div className="mt-3 flex flex-col gap-6">
            {blocks.map((block, index) => (
              <BlockView key={`${block.type}-${index}`} block={block} />
            ))}
          </div>
        )}

        {meta && import.meta.env.DEV && (
          <details className="mt-3 rounded-lg border-line border-border bg-background/60 p-2 text-xs text-muted-foreground">
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
      <span className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand">
        <Sparkles className="size-4" strokeWidth={1.5} aria-hidden />
      </span>
      <div className="flex w-full flex-col gap-2">
        <p className="text-xs text-muted-foreground">در حال جست‌وجو در قیمت‌ها…</p>
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
        <div className="grid grid-cols-2 gap-3 pt-1">
          <Skeleton className="aspect-4/3 w-full" />
          <Skeleton className="aspect-4/3 w-full" />
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
  const [draft, setDraft] = useState("");
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
    void send(value);
  }

  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const suggestions = lastAssistant?.suggestions ?? [];

  return (
    <div className="flex flex-col gap-6">
      {messages.length === 0 ? (
        <section className="rise flex flex-col gap-6 py-2">
          <div className="flex flex-col gap-3">
            <p className="inline-flex w-fit items-center gap-2 rounded-full bg-brand/10 px-3 py-1 text-xs font-medium text-brand">
              <Sparkles className="size-3.5" strokeWidth={2} aria-hidden />
              دستیار خرید حضوری تهران
            </p>
            <h1 className="text-2xl font-bold leading-tight sm:text-3xl">
              چه چیزی می‌خواهید بخرید؟
            </h1>
            <p className="max-w-xl text-sm leading-8 text-muted-foreground">
              قیمت‌های ثبت‌شدهٔ فروشگاه‌های تهران را مقایسه می‌کنم، تازگی هر اطلاعات را نشان می‌دهم و
              یک برنامهٔ حضوری می‌چینم که فقط ایست‌های نزدیک هم را داشته باشد.
            </p>
            <dl className="flex flex-wrap gap-x-6 gap-y-2 pt-1 text-xs text-muted-foreground">
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
                <dt>شروع از</dt>
                <dd className="font-medium text-foreground">{origin.label ?? "فردوسی"}</dd>
              </div>
            </dl>
          </div>

          <div className="stagger grid gap-2 sm:grid-cols-2">
            {PROMPTS.map((prompt) => (
              <button
                key={prompt.title}
                type="button"
                onClick={() => submit(prompt.message)}
                className="flex min-h-16 items-start gap-3 rounded-surface border-line border-border bg-card p-3 text-start transition-colors hover:border-brand/50 hover:bg-accent"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-brand">
                  <prompt.icon className="size-4" strokeWidth={1.5} aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium leading-6">{prompt.title}</span>
                  <span className="block text-xs text-muted-foreground">{prompt.hint}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">یا از یک دسته شروع کنید</p>
            <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
              {meta.categories.slice(0, 8).map((category) => (
                <button
                  key={category.name}
                  type="button"
                  onClick={() => submit(`ارزان‌ترین‌های ${category.name}`)}
                  className="flex h-11 shrink-0 items-center gap-1.5 rounded-full border-line border-border bg-card px-3 text-xs transition-colors hover:border-brand/50 hover:bg-accent"
                >
                  {category.name}
                  <span className="text-muted-foreground">{faNumber(category.product_count)}</span>
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              نقطهٔ شروع فاصله‌ها: {origin.label ?? "فردوسی"}
            </p>
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-11 items-center gap-1.5 rounded-control px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <RotateCcw className="size-3.5" strokeWidth={1.5} aria-hidden />
              گفت‌وگوی تازه
            </button>
          </div>

          <div className="flex flex-col gap-6" aria-live="polite">
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
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border-line border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void retry()}
            className="inline-flex h-11 items-center rounded-control border-line border-destructive/40 px-3 text-xs font-medium"
          >
            تلاش دوباره
          </button>
        </div>
      )}

      {suggestions.length > 0 && !sending && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">قدم بعدی</p>
          <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => submit(suggestion)}
                className="flex h-11 shrink-0 items-center rounded-full border-line border-border bg-card px-3 text-xs transition-colors hover:border-brand/50 hover:bg-accent"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="sticky bottom-16 z-30 -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur md:bottom-0 md:mx-0 md:rounded-t-surface">
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit(draft);
          }}
        >
          <label htmlFor="chat-input" className="sr-only">
            پیام به دستیار
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
            placeholder="مثلاً: هدفون بی‌سیم زیر ۵ میلیون"
            className={cn(
              "max-h-32 min-h-11 flex-1 resize-none rounded-field border-line-field border-input bg-field px-3 py-2.5 text-sm leading-6",
              "placeholder:text-muted-foreground/70 focus-visible:border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
            )}
          />
          <button
            type="submit"
            disabled={sending || draft.trim().length === 0}
            aria-label="ارسال پیام"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground transition-opacity disabled:opacity-40"
          >
            <ArrowLeft className="size-5" strokeWidth={2} aria-hidden />
          </button>
        </form>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
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
