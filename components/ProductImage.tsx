import { useState } from "react";
import { Package } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProductImageProps {
  src: string | null;
  alt: string;
  className?: string;
  eager?: boolean;
}

/**
 * Torob product photos are studio cutouts on white. They sit on a paper-like
 * tile so the dark interface keeps its contrast, and a missing image never
 * leaves a hole in the grid.
 */
export function ProductImage({ src, alt, className, eager = false }: ProductImageProps) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;

  return (
    <div className={cn("relative overflow-hidden bg-foreground text-muted-foreground", className)}>
      {showImage ? (
        <img
          src={src ?? undefined}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="size-full object-contain p-2"
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-1 bg-secondary">
          <Package className="size-6" strokeWidth={1.5} aria-hidden />
          <span className="text-xs text-muted-foreground">بدون تصویر</span>
        </div>
      )}
    </div>
  );
}
