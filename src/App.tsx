import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { BasketProvider, ChatProvider, MetaProvider, OriginProvider, useMeta } from "@/lib/app-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChatPage } from "@/src/pages/ChatPage";
import { ExplorePage } from "@/src/pages/ExplorePage";
import { ProductPage } from "@/src/pages/ProductPage";
import { StoresPage } from "@/src/pages/StoresPage";
import { StorePage } from "@/src/pages/StorePage";
import { PlanPage } from "@/src/pages/PlanPage";
import { NotFoundPage } from "@/src/pages/NotFoundPage";

function ScrollToTop() {
  const location = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [location.pathname]);
  return null;
}

function BootScreen({ error, retry }: { error?: string | null; retry?: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-brand text-lg font-bold text-brand-foreground">
        هـ
      </div>
      {error ? (
        <>
          <p className="max-w-sm text-sm leading-7 text-foreground">{error}</p>
          <p className="max-w-sm text-xs leading-6 text-muted-foreground">
            اگر دیتاست هنوز وارد نشده، یک‌بار <code dir="ltr">npm run data:import</code> را اجرا کنید.
          </p>
          {retry && (
            <Button variant="brand" size="lg" onClick={retry}>
              تلاش دوباره
            </Button>
          )}
        </>
      ) : (
        <div className="flex w-full max-w-sm flex-col gap-2" aria-label="در حال بارگذاری">
          <Skeleton className="h-4 w-2/3 self-center" />
          <Skeleton className="h-3 w-1/2 self-center" />
        </div>
      )}
    </div>
  );
}

function Gate() {
  const { meta, error, reload } = useMeta();
  if (error) return <BootScreen error={error} retry={reload} />;
  if (!meta) return <BootScreen />;

  return (
    <OriginProvider meta={meta}>
      <BasketProvider>
        <ChatProvider>
          <AppShell>
            <ScrollToTop />
            <Routes>
              <Route path="/" element={<ChatPage />} />
              <Route path="/explore" element={<ExplorePage />} />
              <Route path="/p/:productId" element={<ProductPage />} />
              <Route path="/stores" element={<StoresPage />} />
              <Route path="/s/:shopId" element={<StorePage />} />
              <Route path="/plan" element={<PlanPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </AppShell>
        </ChatProvider>
      </BasketProvider>
    </OriginProvider>
  );
}

export function App() {
  return (
    <MetaProvider>
      <Gate />
    </MetaProvider>
  );
}
