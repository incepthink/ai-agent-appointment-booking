import { db } from "./db";

// What handleIncoming accumulates over a turn and hands back so the request
// boundary (the webhook / chat handler) can persist a metric row once it also
// knows the end-to-end and WhatsApp-send timings.
export type TurnMetrics = {
  clinicId: number | null;
  model: string;
  llmCalls: number; // OpenAI round-trips — the key latency lever
  llmMs: number; // total ms spent inside those OpenAI calls
  toolCalls: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
};

// A full metric record: the turn metrics plus the timings the boundary owns.
export type MessageMetric = TurnMetrics & {
  phone: string;
  source: "whatsapp" | "chat";
  totalMs: number; // patient-perceived: handle + send
  handleMs: number; // agent processing only
  sendMs: number | null; // WhatsApp send (null for the local /chat endpoint)
};

const insertMetric = db.prepare(
  `INSERT INTO message_metrics
     (phone, clinic_id, source, model, total_ms, handle_ms, send_ms,
      llm_ms, llm_calls, tool_calls, prompt_tokens, completion_tokens, cached_tokens)
   VALUES
     (@phone, @clinicId, @source, @model, @totalMs, @handleMs, @sendMs,
      @llmMs, @llmCalls, @toolCalls, @promptTokens, @completionTokens, @cachedTokens)`,
);

export function recordMessageMetric(m: MessageMetric): void {
  // better-sqlite3 rejects `undefined` and stores floats verbatim, so coerce
  // nullables and round the ms diffs to clean integers.
  insertMetric.run({
    phone: m.phone,
    clinicId: m.clinicId ?? null,
    source: m.source,
    model: m.model ?? null,
    totalMs: Math.round(m.totalMs),
    handleMs: Math.round(m.handleMs),
    sendMs: m.sendMs == null ? null : Math.round(m.sendMs),
    llmMs: Math.round(m.llmMs),
    llmCalls: m.llmCalls,
    toolCalls: m.toolCalls,
    promptTokens: m.promptTokens,
    completionTokens: m.completionTokens,
    cachedTokens: m.cachedTokens,
  });
}

// A timing distribution for one measurement (all values in ms).
export type Stat = { avg: number; p50: number; p95: number; max: number };

export type MetricsSummary = {
  window_days: number | null; // null = all time
  count: number;
  total: Stat; // patient-perceived response time (headline)
  handle: Stat; // agent processing
  llm: Stat; // time inside OpenAI calls
  send: Stat; // WhatsApp send
  avg_llm_calls: number;
  avg_tool_calls: number;
  avg_prompt_tokens: number;
  avg_completion_tokens: number;
  avg_cached_tokens: number;
};

type MetricRow = {
  total_ms: number;
  handle_ms: number;
  llm_ms: number;
  send_ms: number | null;
  llm_calls: number;
  tool_calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
};

// Don't load an unbounded history into memory; the most recent rows are what
// the dashboard window cares about.
const READ_CAP = 5000;

function stat(values: number[]): Stat {
  if (values.length === 0) return { avg: 0, p50: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((s, v) => s + v, 0);
  const pct = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  return {
    avg: Math.round(sum / sorted.length),
    p50: pct(50),
    p95: pct(95),
    max: sorted[sorted.length - 1],
  };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((s, v) => s + v, 0);
  return Math.round((sum / values.length) * 10) / 10; // one decimal
}

export function getMetricsSummary(days: number | null = 7): MetricsSummary {
  // Overall (not clinic-scoped): "our average response time" is a system
  // property, and pre-clinic-selection turns (the list_clinics round-trips)
  // belong to no clinic. Only real WhatsApp traffic counts — the /chat test
  // endpoint is excluded. SQLite has no percentile function, so we pull the
  // (capped) window and compute every avg/percentile in one JS pass.
  const where =
    days == null
      ? `WHERE source = 'whatsapp'`
      : `WHERE source = 'whatsapp' AND created_at >= datetime('now', ?)`;
  const params = days == null ? [] : [`-${days} days`];

  const rows = db
    .prepare(
      `SELECT total_ms, handle_ms, llm_ms, send_ms, llm_calls, tool_calls,
              prompt_tokens, completion_tokens, cached_tokens
       FROM message_metrics
       ${where}
       ORDER BY id DESC
       LIMIT ${READ_CAP}`,
    )
    .all(...params) as MetricRow[];

  return {
    window_days: days,
    count: rows.length,
    total: stat(rows.map((r) => r.total_ms)),
    handle: stat(rows.map((r) => r.handle_ms)),
    llm: stat(rows.map((r) => r.llm_ms)),
    send: stat(rows.filter((r) => r.send_ms != null).map((r) => r.send_ms as number)),
    avg_llm_calls: mean(rows.map((r) => r.llm_calls)),
    avg_tool_calls: mean(rows.map((r) => r.tool_calls)),
    avg_prompt_tokens: mean(rows.map((r) => r.prompt_tokens)),
    avg_completion_tokens: mean(rows.map((r) => r.completion_tokens)),
    avg_cached_tokens: mean(rows.map((r) => r.cached_tokens)),
  };
}
