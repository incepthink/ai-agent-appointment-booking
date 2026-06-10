"use client";

import { useEffect, useState, type ComponentType } from "react";
import { Gauge, Timer, Cpu, Sparkles, Send, Repeat, Wrench, Coins } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { MetricsSummary, Stat } from "@/lib/types";
import { Card, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";

type Range = 7 | 30 | "all";

const RANGES: { value: Range; label: string }[] = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: "all", label: "All time" },
];

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const num = (n: number) => (Number.isInteger(n) ? n.toString() : n.toFixed(1));

export default function InsightsPage() {
  const [range, setRange] = useState<Range>(7);
  const [data, setData] = useState<MetricsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getMetrics(range)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Failed to load metrics");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Insights</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            How fast the WhatsApp agent replies to patients — and where the time goes.
          </p>
        </div>
        <RangeTabs value={range} onChange={setRange} />
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner className="size-6 text-brand" />
        </div>
      ) : error ? (
        <Card className="p-6 text-sm text-rose-600">{error}</Card>
      ) : !data || data.count === 0 ? (
        <Card className="p-10 text-center">
          <Gauge className="mx-auto size-8 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-700">No messages yet</p>
          <p className="mt-1 text-sm text-slate-500">
            Response-time metrics appear here once patients start messaging the agent.
          </p>
        </Card>
      ) : (
        <Content data={data} />
      )}
    </div>
  );
}

function Content({ data }: { data: MetricsSummary }) {
  return (
    <div className="space-y-8">
      {/* Headline: average patient-perceived response time */}
      <Card>
        <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
              <Timer className="size-4 text-brand" />
              Average response time
            </div>
            <p className="mt-2 text-5xl font-semibold tracking-tight text-slate-900">{secs(data.total.avg)}</p>
            <p className="mt-1.5 text-sm text-slate-500">
              p95 {secs(data.total.p95)} · {data.count.toLocaleString()} message
              {data.count === 1 ? "" : "s"}
              {data.window_days ? ` in the last ${data.window_days} days` : ", all-time"}
            </p>
          </div>
          <div className="flex size-20 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-brand">
            <Gauge className="size-9" />
          </div>
        </div>
      </Card>

      {/* Breakdown by stage */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Where the time goes</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <TimingCard icon={Timer} tone="indigo" label="Total" hint="patient-perceived" stat={data.total} />
          <TimingCard icon={Cpu} tone="sky" label="Agent processing" hint="excludes send" stat={data.handle} />
          <TimingCard icon={Sparkles} tone="violet" label="LLM time" hint="OpenAI calls" stat={data.llm} />
          <TimingCard icon={Send} tone="emerald" label="WhatsApp send" hint="delivery" stat={data.send} />
        </div>
      </section>

      {/* Throughput / cost drivers */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Per message</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <MetricCard
            icon={Repeat}
            tone="amber"
            label="LLM round-trips"
            value={num(data.avg_llm_calls)}
            hint="The main latency lever — each is a full network call."
          />
          <MetricCard
            icon={Wrench}
            tone="sky"
            label="Tool calls"
            value={num(data.avg_tool_calls)}
            hint="Booking actions taken per message."
          />
          <MetricCard
            icon={Coins}
            tone="violet"
            label="Tokens"
            value={num(data.avg_prompt_tokens + data.avg_completion_tokens)}
            hint={`${num(data.avg_prompt_tokens)} in · ${num(data.avg_completion_tokens)} out · ${num(
              data.avg_cached_tokens,
            )} cached`}
          />
        </div>
      </section>
    </div>
  );
}

const TONES: Record<string, string> = {
  indigo: "bg-indigo-50 text-brand",
  sky: "bg-sky-50 text-sky-600",
  violet: "bg-violet-50 text-violet-600",
  emerald: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
};

type IconType = ComponentType<{ className?: string }>;

function TimingCard({
  icon: Icon,
  tone,
  label,
  hint,
  stat,
}: {
  icon: IconType;
  tone: string;
  label: string;
  hint: string;
  stat: Stat;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-600">{label}</span>
        <span className={cn("flex size-8 items-center justify-center rounded-lg", TONES[tone])}>
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">{secs(stat.avg)}</p>
      <p className="text-xs text-slate-400">avg · {hint}</p>
      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-center">
        <SubStat label="p50" value={secs(stat.p50)} />
        <SubStat label="p95" value={secs(stat.p95)} />
        <SubStat label="max" value={secs(stat.max)} />
      </div>
    </Card>
  );
}

function SubStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm font-medium text-slate-700">{value}</p>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: IconType;
  tone: string;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-600">{label}</span>
        <span className={cn("flex size-8 items-center justify-center rounded-lg", TONES[tone])}>
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-400">{hint}</p>
    </Card>
  );
}

function RangeTabs({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
      {RANGES.map((r) => (
        <button
          key={String(r.value)}
          onClick={() => onChange(r.value)}
          className={cn(
            "rounded-md px-3 py-1.5 font-medium transition-colors",
            value === r.value ? "bg-brand text-brand-foreground shadow-sm" : "text-slate-600 hover:bg-slate-100",
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
