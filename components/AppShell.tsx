import { NavLink, Link } from "react-router-dom";
import { Compass, MessageCircle, Route, ShoppingBag, Store } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useAppMeta, useBasket, useOrigin } from "@/lib/app-state";
import { OriginPicker } from "@/components/OriginPicker";
import { fa, jalaliDate } from "@/lib/format";

const NAV = [
  { to: "/", label: "دستیار", icon: MessageCircle, end: true },
  { to: "/explore", label: "کاوش", icon: Compass },
  { to: "/stores", label: "فروشگاه‌ها", icon: Store },
  { to: "/plan", label: "برنامه", icon: Route },
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

      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Link to="/" className="flex min-w-0 items-center gap-2">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground">
              <ShoppingBag className="size-5" strokeWidth={2} aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold leading-5">هم‌خرید</span>
              <span className="hidden text-xs leading-4 text-muted-foreground sm:block">
                دستیار خرید حضوری تهران
              </span>
            </span>
          </Link>

          <nav aria-label="ناوبری اصلی" className="ms-6 hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "flex h-11 items-center gap-2 rounded-control px-3 text-sm transition-colors",
                    isActive
                      ? "bg-secondary font-medium text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )
                }
              >
                <item.icon className="size-4" strokeWidth={1.5} aria-hidden />
                {item.label}
                {item.to === "/plan" && basket.items.length > 0 && (
                  <span className="rounded-full bg-brand px-1.5 text-xs font-semibold text-brand-foreground tabular-nums">
                    {fa(basket.items.length)}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="ms-auto flex items-center gap-2">
            <OriginPicker />
            <Link
              to="/plan"
              aria-label={`برنامهٔ خرید، ${fa(basket.items.length)} قلم`}
              className="relative flex size-11 items-center justify-center rounded-full border-line border-border bg-secondary text-foreground hover:bg-accent md:hidden"
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

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-4 md:pb-10">
        {children}
      </main>

      <footer className="hidden border-t border-border px-4 py-6 md:block">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 text-xs leading-6 text-muted-foreground">
          <p>
            قیمت‌ها از دیتاست فروشگاه‌های تهران می‌آید و «موجودی زنده» نیست؛ پیش از رفتن، تلفنی تأیید بگیرید.
          </p>
          <p>
            آخرین ثبت قیمت در داده: {jalaliDate(meta?.data.price_newest ?? null)} · نقطهٔ شروع فعلی:{" "}
            {origin.label ?? "فردوسی"}
          </p>
        </div>
      </footer>

      <nav
        aria-label="ناوبری موبایل"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-safe backdrop-blur md:hidden"
      >
        <div className="grid grid-cols-4">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "relative flex min-h-14 flex-col items-center justify-center gap-1 text-xs transition-colors",
                  isActive ? "text-brand" : "text-muted-foreground",
                )
              }
            >
              <span className="relative">
                <item.icon className="size-5" strokeWidth={1.5} aria-hidden />
                {item.to === "/plan" && basket.items.length > 0 && (
                  <span className="absolute -top-1 -end-2 flex size-4 items-center justify-center rounded-full bg-brand text-xs font-bold text-brand-foreground">
                    {fa(basket.items.length)}
                  </span>
                )}
              </span>
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
