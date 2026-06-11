"use client";

import { useEffect, useState } from "react";
import { Plus, ChevronDown, Copy, Check, Stethoscope } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Doctor } from "@/lib/types";
import { Button, Card, Field, Input, Spinner, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { useClinic } from "@/components/clinic-context";

type Credentials = { email: string | null; password: string };

export default function TeamPage() {
  const { toast } = useToast();
  const { clinic } = useClinic();

  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);

  // Add-doctor modal
  const [addOpen, setAddOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [bio, setBio] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Credentials reveal (shown once after add)
  const [credentials, setCredentials] = useState<Credentials | null>(null);

  // Accordion: which doctor row is expanded
  const [expandedId, setExpandedId] = useState<number | null>(null);

  async function refresh() {
    const { doctors } = await api.listDoctors();
    setDoctors(doctors);
  }

  useEffect(() => {
    refresh()
      .catch((err) => toast(err instanceof ApiError ? err.message : "Could not load team", "error"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openAdd() {
    setEmail("");
    setName("");
    setSpecialty("");
    setBio("");
    setCredentials(null);
    setAddOpen(true);
  }

  async function addDoctor(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await api.addDoctor({
        email: email.trim(),
        name: name.trim(),
        specialty: specialty.trim(),
        bio: bio.trim() || null,
      });
      setCredentials({ email: res.email, password: res.password });
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not add doctor", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Team</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Doctors at {clinic.name} who can sign in and take bookings
          </p>
        </div>
        <Button onClick={openAdd} className="shrink-0">
          <Plus className="size-4" />
          Add doctor
        </Button>
      </div>

      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner className="size-6 text-brand" />
          </div>
        ) : doctors.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-slate-500">No doctors yet.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {doctors.map((d) => {
              const expanded = expandedId === d.id;
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setExpandedId((id) => (id === d.id ? null : d.id))}
                    className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-slate-50"
                  >
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-brand">
                      <Stethoscope className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{d.name}</p>
                      <p className="truncate text-xs text-slate-400">{d.specialty}</p>
                    </div>
                    <ChevronDown
                      className={`size-5 shrink-0 text-slate-400 transition-transform ${
                        expanded ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                  {expanded && (
                    <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-2 border-t border-slate-100 bg-slate-50/60 px-5 py-4 text-sm">
                      <DetailRow label="Specialty" value={d.specialty} />
                      <DetailRow label="Email" value={d.email ?? "—"} />
                      <DetailRow label="Bio" value={d.bio ?? "—"} />
                      <DetailRow label="Hours" value={`${d.open}–${d.close}`} />
                      <DetailRow label="Days" value={d.days.join(", ")} />
                      <DetailRow label="Slot length" value={`${d.slotMinutes} min`} />
                      <DetailRow label="Code" value={d.code} mono />
                    </dl>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={credentials ? "Doctor credentials" : "Add doctor"}
        description={
          credentials
            ? "Share these now — the password is shown only once."
            : `Inherits ${clinic.name}'s hours — the doctor can adjust them in Settings.`
        }
      >
        {credentials ? (
          <CredentialsReveal credentials={credentials} onDone={() => setAddOpen(false)} />
        ) : (
          <form onSubmit={addDoctor} className="space-y-5">
            <Field label="Email" hint="The doctor signs in with this">
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="doctor@clinic.com"
                autoComplete="off"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Display name">
                <Input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Dr. Jane Doe"
                />
              </Field>
              <Field label="Specialty">
                <Input
                  required
                  value={specialty}
                  onChange={(e) => setSpecialty(e.target.value)}
                  placeholder="General Physician"
                />
              </Field>
            </div>
            <Field label="Bio" hint="What they treat — the agent uses this to route patients to them">
              <Textarea
                rows={3}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Skin, hair and nails: rashes, acne, eczema…"
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={submitting}>
                Add doctor
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className={`min-w-0 wrap-break-word text-slate-900 ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </dd>
    </>
  );
}

function CredentialsReveal({
  credentials,
  onDone,
}: {
  credentials: Credentials;
  onDone: () => void;
}) {
  return (
    <div className="space-y-4">
      {credentials.email && <CopyRow label="Email" value={credentials.email} />}
      <CopyRow label="Password" value={credentials.password} mono />
      <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        This password won&apos;t be shown again. The doctor can change it under Settings → Security
        after signing in.
      </p>
      <div className="flex justify-end">
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}

function CopyRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — user can select manually */
    }
  }

  return (
    <div>
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="mt-1.5 flex items-center gap-2">
        <code
          className={`flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 ${
            mono ? "font-mono" : ""
          }`}
        >
          {value}
        </code>
        <Button type="button" variant="secondary" size="sm" onClick={copy} aria-label={`Copy ${label}`}>
          {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
        </Button>
      </div>
    </div>
  );
}
