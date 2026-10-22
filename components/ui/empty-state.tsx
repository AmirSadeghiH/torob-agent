import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

/** حالت خالی. Say what's missing and offer the one action that fixes it. */
export function EmptyState({ icon: Icon = Inbox, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-2 rounded-surface border border-dashed border-input bg-card/60 p-8 text-center", className)}>
      <span className="flex size-11 items-center justify-center rounded-control bg-brand/8">
        <Icon className="size-5 text-brand" />
      </span>
      <p className="mt-1 text-sm font-medium">{title}</p>
      {description && <p className="max-w-xs text-xs leading-5 text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
