import { NavLink, Link } from "react-router-dom";
import { Compass, MessageCircle, Route, Sparkles, Store } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useAppMeta, useBasket, useOrigin } from "@/lib/app-state";
import { OriginPicker } from "@/components/OriginPicker";
import { fa, jalaliDate } from "@/lib/format";

const NAV = [
  { to: "/", label: "دستیار", icon: MessageCircle, end: true },
  { to: "/explore", label: "کاوش", icon: Compass },
  { to: "/stores", label: "فروشگاه‌ها", icon: Store },
  { to: "/plan", label: "برنامهٔ خرید", icon: Route },
];

export function AppShell({ children }: { children: ReactNode }) {
  const basket = useBasket();
  const meta = useAppMeta();
  const { origin } = useOrigin();

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded-control focus:bg-brand focus:px-3 focus:py-2 focus:text-brand-foreground"
      >
        رفتن به محتوای اصلی
      </a>

      <header className="sticky top-0 z-40 border-b border-border bg-card/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Link to="/" className="group flex min-w-0 items-center gap-2.5" aria-label="ترب‌یار، آغاز گفت‌وگو">
            <span className="relative flex size-10 shrink-0 items-center justify-center rounded-control bg-brand text-brand-foreground shadow-control transition-transform duration-(--motion) ease-motion group-hover:scale-[1.03]">
              <Sparkles className="size-5" strokeWidth={2} aria-hidden />
              <span className="absolute -bottom-0.5 -end-0.5 size-2.5 rounded-full border-2 border-card bg-success" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-base font-bold leading-6">ترب‌یار</span>
              <span className="hidden text-xs leading-4 text-muted-foreground sm:block">
                دستیار هوشمند خرید
              </span>
            </span>
          </Link>

          <nav
            aria-label="ناوبری اصلی"
            className="mx-auto hidden items-center gap-0.5 rounded-full border-line border-border bg-secondary p-1 lg:flex"
          >
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "flex h-11 items-center gap-2 rounded-full px-3.5 text-sm transition-colors duration-(--motion) ease-motion",
                    isActive
                      ? "bg-card font-medium text-foreground shadow-control"
                      : "text-muted-foreground hover:text-foreground",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon
                      className={cn("size-4", isActive ? "text-brand" : "")}
                      strokeWidth={isActive ? 2 : 1.5}
                      aria-hidden
                    />
                    {item.label}
                    {item.to === "/plan" && basket.items.length > 0 && (
                      <span className="flex min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-xs font-semibold leading-5 text-brand-foreground tabular-nums">
                        {fa(basket.items.length)}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="ms-auto flex items-center gap-2 lg:ms-0">
            <OriginPicker />
            <Link
              to="/plan"
              aria-label={`برنامهٔ خرید، ${fa(basket.items.length)} قلم`}
              className="relative flex size-11 items-center justify-center rounded-control border-line border-border bg-card text-foreground shadow-control transition-colors hover:bg-accent lg:hidden"
            >
              <Route className="size-5" strokeWidth={1.5} aria-hidden />
              {basket.items.length > 0 && (
                <span className="absolute -top-1 -end-1 flex size-5 items-center justify-center rounded-full bg-brand text-xs font-bold text-brand-foreground">
                  {fa(basket.items.length)}
                </span>
              )}
            </Link>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-5 lg:pb-12 lg:pt-6">
        {children}
      </main>

      <footer className="hidden border-t border-border bg-card lg:block">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs leading-6 text-muted-foreground">
          <p className="flex items-center gap-2 text-foreground">
            <span className="flex size-6 items-center justify-center rounded-md bg-brand/10 text-brand">
              <Sparkles className="size-3.5" strokeWidth={2} aria-hidden />
            </span>
            <span className="font-semibold">ترب‌یار</span>
            <span className="text-muted-foreground">— دستیار هوشمند خرید از فروشگاه‌های تهران</span>
          </p>
          <p>
            قیمت‌ها همان مقدار ثبت‌شده در دیتاست است، نه قیمت روز و نه موجودی زنده؛ پیش از رفتن، قیمت و موجودی را از منبع دیگری بررسی کنید.
          </p>
          <p>
            آخرین ثبت قیمت در داده: {jalaliDate(meta?.data.price_newest ?? null)} · نقطهٔ شروع فعلی:{" "}
            {origin.label ?? "فردوسی"}
          </p>
        </div>
      </footer>

      <nav
        aria-label="ناوبری موبایل"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-safe backdrop-blur-xl lg:hidden"
      >
        <div className="grid grid-cols-4">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "relative flex min-h-16 flex-col items-center justify-center gap-1 text-xs transition-colors",
                  isActive ? "text-brand" : "text-muted-foreground",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      "relative flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                      isActive && "bg-brand/10",
                    )}
                  >
                    <item.icon className="size-5" strokeWidth={isActive ? 2 : 1.5} aria-hidden />
                    {item.to === "/plan" && basket.items.length > 0 && (
                      <span className="absolute -top-1 -end-0.5 flex size-4 items-center justify-center rounded-full bg-brand text-xs font-bold text-brand-foreground">
                        {fa(basket.items.length)}
                      </span>
                    )}
                  </span>
                  <span className={cn(isActive && "font-medium")}>
                    {item.to === "/plan" ? "برنامه" : item.label}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
