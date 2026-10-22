import { useEffect, useRef, useState } from "react";
import { ChevronDown, LocateFixed, MapPin } from "lucide-react";
import { useOrigin } from "@/lib/app-state";
import { cn } from "@/lib/utils";

export function OriginPicker() {
  const { origin, isDefault, neighborhoods, useNeighborhood, useGeolocation, reset } = useOrigin();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (container.current && !container.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function locate() {
    setMessage(null);
    const error = await useGeolocation();
    if (error) setMessage(error);
    else setOpen(false);
  }

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`نقطهٔ شروع: ${origin.label ?? "فردوسی"}. تغییر محله`}
        className="flex h-11 max-w-40 items-center gap-1.5 rounded-full border-line border-border bg-secondary px-3 text-xs text-foreground transition-colors hover:bg-accent"
      >
        <MapPin className="size-4 shrink-0 text-brand" strokeWidth={1.5} aria-hidden />
        <span className="truncate">{origin.label ?? "فردوسی"}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="انتخاب محله"
          className="absolute end-0 top-full z-50 mt-2 w-72 max-h-96 overflow-auto rounded-overlay border-line border-border bg-popover p-2 shadow-overlay"
        >
          <p className="px-2 py-1 text-xs text-muted-foreground">
            فاصله‌ها از این نقطه حساب می‌شود
          </p>
          <button
            type="button"
            role="option"
            aria-selected={false}
            onClick={locate}
            className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-start text-sm hover:bg-accent"
          >
            <LocateFixed className="size-4 text-brand" strokeWidth={1.5} aria-hidden />
            موقعیت فعلی من
          </button>
          <div className="my-1 h-px bg-border" aria-hidden />
          {neighborhoods.map((hood) => {
            const active = !isDefault && origin.neighborhood === hood.name;
            return (
              <button
                key={hood.name}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  useNeighborhood(hood.name);
                  setOpen(false);
                }}
                className={cn(
                  "flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-2 text-start text-sm hover:bg-accent",
                  active && "bg-accent",
                )}
              >
                <span>{hood.name}</span>
                <span className="text-xs text-muted-foreground">
                  {new Intl.NumberFormat("fa-IR").format(hood.shop_count)} فروشگاه
                </span>
              </button>
            );
          })}
          {!isDefault && (
            <>
              <div className="my-1 h-px bg-border" aria-hidden />
              <button
                type="button"
                onClick={() => {
                  reset();
                  setOpen(false);
                }}
                className="flex min-h-11 w-full items-center rounded-lg px-2 text-start text-sm text-muted-foreground hover:bg-accent"
              >
                بازگشت به نقطهٔ پیش‌فرض
              </button>
            </>
          )}
          {message && <p className="px-2 py-2 text-xs text-destructive">{message}</p>}
        </div>
      )}
    </div>
  );
}
