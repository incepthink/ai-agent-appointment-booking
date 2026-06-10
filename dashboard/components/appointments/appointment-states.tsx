import { CalendarX2 } from "lucide-react";
import type { ReactNode } from "react";
import { Card, Spinner } from "@/components/ui";

// Inline spinner shown while a day/month's appointments are loading.
export function LoadingRow() {
  return (
    <div className="flex items-center gap-2 py-16 text-sm text-slate-400">
      <Spinner className="size-5 text-brand" /> Loading…
    </div>
  );
}

// Empty-state card with an optional call-to-action (e.g. "Add appointment").
export function EmptyState({
  message,
  hint,
  action,
}: {
  message: string;
  hint: string;
  action?: ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
        <CalendarX2 className="size-6" />
      </div>
      <div>
        <p className="font-medium text-slate-700">{message}</p>
        <p className="text-sm text-slate-400">{hint}</p>
      </div>
      {action}
    </Card>
  );
}
