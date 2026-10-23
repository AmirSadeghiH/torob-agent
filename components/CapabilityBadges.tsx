import type { ShopCapability } from "@/shared/types";
import { cn } from "@/lib/utils";

const STATUS_TEXT: Record<ShopCapability["status"], string> = {
  recorded: "ثبت‌شده",
  unregistered: "ثبت‌نشده",
  unsupported: "تأیید نشده",
  unknown: "نامشخص",
};

/**
 * Store capabilities, each with its own provenance status.
 *
 * A missing field renders as «ثبت‌نشده» — never as a green badge. Nothing here
 * is inferred from the shop's name, category or social media.
 */
export function CapabilityBadges({ capabilities }: { capabilities: ShopCapability[] }) {
  if (!capabilities || capabilities.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1.5">
        {capabilities.map((capability) => (
          <span
            key={capability.key}
            title={capability.detail}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
              capability.status === "recorded"
                ? "border-success/30 bg-success/10 text-success"
                : "border-border bg-secondary/60 text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                capability.status === "recorded" ? "bg-success" : "bg-secondary-foreground/40",
              )}
              aria-hidden
            />
            {capability.label}
            <span className="opacity-70">{STATUS_TEXT[capability.status]}</span>
          </span>
        ))}
      </div>
      <p className="text-[11px] leading-5 text-muted-foreground">
        هر قابلیت تنها از فیلدهای ثبت‌شده در دیتاست استخراج می‌شود؛ از نام فروشگاه، دسته یا
        شبکه‌های اجتماعی استنتاج نمی‌شود.
      </p>
    </div>
  );
}
