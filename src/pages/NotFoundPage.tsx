import { Link } from "react-router-dom";
import { Compass, MessageCircle } from "lucide-react";

export function NotFoundPage() {
  return (
    <div className="agent-wash -mx-4 flex flex-col items-center gap-4 rounded-surface border-line border-border bg-card px-6 py-16 text-center shadow-surface">
      <span className="flex size-12 items-center justify-center rounded-control bg-brand/10 text-brand">
        <Compass className="size-6" strokeWidth={1.5} aria-hidden />
      </span>
      <p className="text-xs font-semibold text-brand">۴۰۴</p>
      <h1 className="text-xl font-bold">این صفحه پیدا نشد</h1>
      <p className="max-w-sm text-sm leading-7 text-muted-foreground">
        ممکن است نشانی اشتباه باشد یا کالا از دیتاست حذف شده باشد. از ترب‌یار بپرسید یا در کاوش
        جست‌وجو کنید.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Link
          to="/"
          className="inline-flex h-12 items-center gap-2 rounded-control bg-brand px-6 text-base font-semibold text-brand-foreground shadow-control"
        >
          <MessageCircle className="size-4" strokeWidth={2} aria-hidden />
          گفت‌وگو با دستیار
        </Link>
        <Link
          to="/explore"
          className="inline-flex h-12 items-center gap-2 rounded-control border-line border-border bg-card px-6 text-base shadow-control"
        >
          <Compass className="size-4" strokeWidth={1.5} aria-hidden />
          کاوش کالاها
        </Link>
      </div>
    </div>
  );
}
