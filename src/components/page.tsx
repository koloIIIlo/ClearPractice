import type { ReactNode } from "react";
import { AlertCircle, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { IpcError } from "@/lib/ipc";
import { cn } from "@/lib/utils";

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-8", className)}>{children}</div>;
}

export function PageHeader({
  title,
  description,
  meta,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 space-y-1">
        {meta && <div className="text-meta text-muted-foreground">{meta}</div>}
        <h1 className="text-title font-semibold tracking-tight">{title}</h1>
        {description && <p className="max-w-prose text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({ children, className, ...rest }: React.ComponentProps<"section">) {
  return (
    <section className={cn("rounded-panel border bg-card p-5 text-card-foreground", className)} {...rest}>
      {children}
    </section>
  );
}

export function SectionTitle({ children, id, action }: { children: ReactNode; id?: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 id={id} className="text-base font-semibold">
        {children}
      </h2>
      {action}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-panel border border-dashed px-6 py-12 text-center">
      {Icon && <Icon aria-hidden className="size-6 text-muted-foreground" />}
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-md text-muted-foreground">{children}</div>}
      {action}
    </div>
  );
}

export function LoadingBlock({ rows = 3, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-panel" />
      ))}
    </div>
  );
}

/** Failures stay visible in context rather than only in a toast (§5). */
export function ErrorState({ error, onRetry, title }: { error: unknown; onRetry?: () => void; title?: string }) {
  const message =
    error instanceof IpcError || error instanceof Error ? error.message : "Something went wrong while loading this.";
  return (
    <div role="alert" className="flex items-start gap-3 rounded-panel border border-destructive/40 p-4">
      <AlertCircle aria-hidden className="mt-0.5 size-5 shrink-0 text-destructive" />
      <div className="space-y-2">
        <p className="font-medium">{title ?? "This couldn't be loaded"}</p>
        <p className="text-muted-foreground">{message}</p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}

interface QueryLike<T> {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

/** Renders loading and failure states for a query and hands the data to `children`. */
export function QueryView<T>({
  query,
  children,
  loading,
}: {
  query: QueryLike<T>;
  children: (data: T) => ReactNode;
  loading?: ReactNode;
}) {
  if (query.isPending) return <>{loading ?? <LoadingBlock />}</>;
  if (query.isError || query.data === undefined)
    return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  return <>{children(query.data)}</>;
}
