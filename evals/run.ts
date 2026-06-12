// Live LLM eval harness. Replays the golden scenarios against the REAL model
// (this costs OpenAI tokens) and grades each run two ways: a deterministic
// assertion over DB/tool-call state, and an LLM judge against the rubric.
// Because the model is stochastic, every scenario runs N times and we report a
// pass rate — the metric for "the agent never fails its task" is each rate
// trending to 100%, not a single green/red.
//
//   npm run eval                       # all scenarios, 3 runs each
//   EVAL_RUNS=5 npm run eval           # more runs per scenario
//   EVAL_ONLY=emergency,happy npm run eval
//   JUDGE_MODEL=gpt-4o npm run eval    # judge model (default gpt-4o)

import os from "node:os";
import path from "node:path";
import { DateTime } from "luxon";
import OpenAI from "openai";

// --- Env MUST be set before any src import (config/db/agent read it on load). -
// A throwaway, process-unique DB so evals never touch real data; it is seeded
// fresh by db.ts. WhatsApp creds are dummies (we never send); the OpenAI key is
// left to dotenv/.env so the agent and judge use the real one.
process.env.CLINIC_DB_PATH ||= path.join(os.tmpdir(), `clinic-eval-${Date.now()}.db`);
process.env.WHATSAPP_VERIFY_TOKEN ||= "eval";
process.env.WHATSAPP_ACCESS_TOKEN ||= "eval";
process.env.WHATSAPP_PHONE_NUMBER_ID ||= "eval";
process.env.WHATSAPP_WABA_ID ||= "eval";

import type { EvalEnv, Scenario, Verdict, ApptRow } from "./scenarios";

const KOLKATA = "Asia/Kolkata";

const JUDGE_SYS = [
  "You are a strict QA grader for a medical-clinic appointment-booking assistant.",
  "Given a RUBRIC and a conversation TRANSCRIPT, decide whether the assistant satisfied the rubric.",
  "Be strict: if the rubric is not clearly and fully met, the verdict is fail.",
  'Respond with ONLY a JSON object: {"pass": boolean, "reason": string}. Keep the reason to one sentence.',
].join("\n");

function fmtTranscript(turns: { role: string; content: string }[], tools: string[]): string {
  const body = turns.map((t) => `${t.role === "user" ? "Patient" : "Assistant"}: ${t.content}`).join("\n");
  return `${body}\n\n[tools the assistant called: ${tools.length ? tools.join(", ") : "none"}]`;
}

async function main() {
  // Dynamic imports so the env above is in place before these modules load.
  const { config } = await import("../src/config");
  const { handleIncoming } = await import("../src/agent");
  const { db } = await import("../src/db");
  const { scenarios } = await import("./scenarios");

  const judge = new OpenAI({ apiKey: config.openai.apiKey });
  const JUDGE_MODEL = process.env.JUDGE_MODEL || "gpt-4o";
  const RUNS = Number(process.env.EVAL_RUNS || 3);
  const only = process.env.EVAL_ONLY?.split(",").map((s) => s.trim());

  // --- per-phone query helpers ---------------------------------------------
  const doctorIdByCode = (code: string) =>
    (db.prepare(`SELECT id FROM doctors WHERE code = ?`).get(code) as { id: number }).id;

  function makeEnv(phone: string): EvalEnv {
    return {
      phone,
      db,
      nextWeekdayYmd(weekday) {
        let d = DateTime.now().setZone(KOLKATA).plus({ days: 1 }).startOf("day");
        for (let i = 0; i < 7; i++) {
          if (d.weekday === weekday) return d.toFormat("yyyy-LL-dd");
          d = d.plus({ days: 1 });
        }
        return d.toFormat("yyyy-LL-dd");
      },
      isoAtKolkata: (ymd, hhmm) => DateTime.fromISO(`${ymd}T${hhmm}`, { zone: KOLKATA }).toISO()!,
      seedBooking({ doctorCode, startIso, name, phone: seedPhone }) {
        const d = db.prepare(`SELECT id, clinic_id, slot_minutes FROM doctors WHERE code = ?`).get(doctorCode) as {
          id: number;
          clinic_id: number;
          slot_minutes: number;
        };
        const start = DateTime.fromISO(startIso, { setZone: true });
        const startUtc = start.toUTC().toISO({ suppressMilliseconds: true })!;
        const endUtc = start.plus({ minutes: d.slot_minutes }).toUTC().toISO({ suppressMilliseconds: true })!;
        // Idempotent across runs: clear any prior seed at this exact slot first.
        db.prepare(`DELETE FROM appointments WHERE doctor_id = ? AND start_utc = ?`).run(d.id, startUtc);
        db.prepare(
          `INSERT INTO appointments (patient_name, phone, start_utc, end_utc, reason, clinic_id, doctor_id)
           VALUES (?, ?, ?, ?, NULL, ?, ?)`,
        ).run(name, seedPhone, startUtc, endUtc, d.clinic_id, d.id);
      },
      doctorIdByCode,
      booked: () =>
        db
          .prepare(`SELECT * FROM appointments WHERE phone = ? AND status = 'booked' ORDER BY start_utc`)
          .all(phone) as ApptRow[],
      all: () => db.prepare(`SELECT * FROM appointments WHERE phone = ? ORDER BY id`).all(phone) as ApptRow[],
      toolNames: () => {
        const rows = db
          .prepare(`SELECT tool_calls FROM conversations WHERE phone = ? AND role='assistant' AND tool_calls IS NOT NULL`)
          .all(phone) as { tool_calls: string }[];
        return rows.flatMap((r) => {
          try {
            return (JSON.parse(r.tool_calls) as any[]).map((tc) => tc.function?.name).filter(Boolean);
          } catch {
            return [];
          }
        });
      },
      session: () => {
        const s = db
          .prepare(`SELECT active_clinic_id, active_doctor_id FROM sessions WHERE phone = ?`)
          .get(phone) as { active_clinic_id: number | null; active_doctor_id: number | null } | undefined;
        const code = s?.active_clinic_id
          ? (db.prepare(`SELECT code FROM clinics WHERE id = ?`).get(s.active_clinic_id) as { code: string } | undefined)?.code ?? null
          : null;
        return { activeClinicCode: code, activeDoctorId: s?.active_doctor_id ?? null };
      },
    };
  }

  async function gradeWithJudge(rubric: string, transcript: string): Promise<Verdict> {
    try {
      const res = await judge.chat.completions.create({
        model: JUDGE_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: JUDGE_SYS },
          { role: "user", content: `RUBRIC:\n${rubric}\n\nTRANSCRIPT:\n${transcript}` },
        ],
      });
      const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}");
      return { pass: !!parsed.pass, detail: String(parsed.reason ?? "") };
    } catch (e: any) {
      return { pass: false, detail: `judge error: ${e?.message ?? e}` };
    }
  }

  const selected = scenarios.filter((s) => !only || only.includes(s.id));
  console.log(`\nRunning ${selected.length} scenario(s) × ${RUNS} run(s) — judge=${JUDGE_MODEL}\n`);

  const summary: { id: string; title: string; assertRate: number; judgeRate: number; bothRate: number }[] = [];
  let totalBoth = 0;
  let totalRuns = 0;

  for (const scenario of selected) {
    let assertPass = 0;
    let judgePass = 0;
    let bothPass = 0;
    console.log(`▶ ${scenario.id} — ${scenario.title}`);

    for (let r = 0; r < RUNS; r++) {
      const phone = `+199${Math.abs(hash(scenario.id))}${r}${Date.now() % 100000}`.slice(0, 15);
      const env = makeEnv(phone);
      const transcript: { role: string; content: string }[] = [];
      try {
        scenario.setup?.(env);
      } catch (e: any) {
        console.log(`   run ${r + 1}: setup error: ${e?.message ?? e}`);
      }
      for (const turn of scenario.turns) {
        transcript.push({ role: "user", content: turn });
        const { reply } = await handleIncoming(phone, turn);
        transcript.push({ role: "assistant", content: reply });
      }
      const a = scenario.assert(env);
      const j = await gradeWithJudge(scenario.rubric, fmtTranscript(transcript, env.toolNames()));
      if (a.pass) assertPass++;
      if (j.pass) judgePass++;
      if (a.pass && j.pass) bothPass++;
      const mark = a.pass && j.pass ? "✓" : "✗";
      console.log(
        `   run ${r + 1}: ${mark}  assert=${a.pass ? "✓" : "✗"} (${a.detail})  judge=${j.pass ? "✓" : "✗"} (${j.detail})`,
      );
    }

    summary.push({
      id: scenario.id,
      title: scenario.title,
      assertRate: assertPass / RUNS,
      judgeRate: judgePass / RUNS,
      bothRate: bothPass / RUNS,
    });
    totalBoth += bothPass;
    totalRuns += RUNS;
    console.log("");
  }

  // --- report --------------------------------------------------------------
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  console.log("════════════════════════ EVAL SUMMARY ════════════════════════");
  for (const s of summary) {
    const flag = s.bothRate === 1 ? " " : "!";
    console.log(`${flag} ${s.id.padEnd(18)} assert ${pct(s.assertRate).padStart(4)}  judge ${pct(s.judgeRate).padStart(4)}  overall ${pct(s.bothRate).padStart(4)}`);
  }
  console.log("───────────────────────────────────────────────────────────────");
  console.log(`OVERALL: ${totalBoth}/${totalRuns} runs passed both checks (${pct(totalBoth / totalRuns)})`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  // Non-zero exit if anything is below 100%, so CI can gate on it.
  process.exit(totalBoth === totalRuns ? 0 : 1);
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

main().catch((e) => {
  console.error("eval harness crashed:", e);
  process.exit(2);
});
