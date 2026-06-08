"use client";

import { useState } from "react";
import { Clock4, Building2, Sparkles, KeyRound } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { COMMON_TIMEZONES, type Day } from "@/lib/types";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { DaysPicker } from "@/components/days-picker";
import { useToast } from "@/components/toast";
import { useClinic } from "@/components/clinic-context";

export default function SettingsPage() {
  const { toast } = useToast();
  const { clinic, setClinic } = useClinic();

  // Availability
  const [tz, setTz] = useState(clinic.tz);
  const [open, setOpen] = useState(clinic.open);
  const [close, setClose] = useState(clinic.close);
  const [days, setDays] = useState<Day[]>(clinic.days);
  const [slotMinutes, setSlotMinutes] = useState(clinic.slotMinutes);
  const [savingAvail, setSavingAvail] = useState(false);

  // Profile
  const [name, setName] = useState(clinic.name);
  const [address, setAddress] = useState(clinic.address ?? "");
  const [contactPhone, setContactPhone] = useState(clinic.contactPhone ?? "");
  const [description, setDescription] = useState(clinic.description ?? "");
  const [savingProfile, setSavingProfile] = useState(false);

  // Security (change password)
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const tzOptions = COMMON_TIMEZONES.includes(clinic.tz)
    ? COMMON_TIMEZONES
    : [clinic.tz, ...COMMON_TIMEZONES];

  async function saveAvailability(e: React.FormEvent) {
    e.preventDefault();
    if (days.length === 0) {
      toast("Pick at least one open day", "error");
      return;
    }
    setSavingAvail(true);
    try {
      const { clinic: updated } = await api.updateClinic({ tz, open, close, days, slotMinutes });
      setClinic(updated);
      toast("Availability saved — the agent now uses these hours", "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Save failed", "error");
    } finally {
      setSavingAvail(false);
    }
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const { clinic: updated } = await api.updateClinic({
        name,
        address: address || null,
        contactPhone: contactPhone || null,
        description: description || null,
      });
      setClinic(updated);
      toast("Profile saved", "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Save failed", "error");
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast("New password must be at least 6 characters", "error");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast("New passwords do not match", "error");
      return;
    }
    setSavingPassword(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast("Password changed", "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not change password", "error");
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Control what your WhatsApp agent offers patients
        </p>
      </div>

      {/* Availability */}
      <Card className="mb-6 p-6">
        <div className="mb-5 flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-indigo-50 text-brand">
            <Clock4 className="size-5" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900">Availability</h2>
            <p className="text-xs text-slate-400">Hours, days, and slot length the agent books within</p>
          </div>
        </div>

        <form onSubmit={saveAvailability} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Timezone">
              <Select value={tz} onChange={(e) => setTz(e.target.value)}>
                {tzOptions.map((z) => (
                  <option key={z} value={z}>{z}</option>
                ))}
              </Select>
            </Field>
            <Field label="Opens">
              <Input type="time" value={open} onChange={(e) => setOpen(e.target.value)} />
            </Field>
            <Field label="Closes">
              <Input type="time" value={close} onChange={(e) => setClose(e.target.value)} />
            </Field>
          </div>

          <Field label="Open days">
            <DaysPicker value={days} onChange={setDays} />
          </Field>

          <Field label="Appointment length">
            <Select value={slotMinutes} onChange={(e) => setSlotMinutes(Number(e.target.value))}>
              {[15, 20, 30, 45, 60].map((m) => (
                <option key={m} value={m}>{m} minutes</option>
              ))}
            </Select>
          </Field>

          <div className="flex justify-end">
            <Button type="submit" loading={savingAvail}>Save availability</Button>
          </div>
        </form>
      </Card>

      {/* Profile */}
      <Card className="p-6">
        <div className="mb-5 flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-indigo-50 text-brand">
            <Building2 className="size-5" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900">Clinic profile</h2>
            <p className="text-xs text-slate-400">How your clinic presents itself</p>
          </div>
        </div>

        <form onSubmit={saveProfile} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Clinic name">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Contact phone">
              <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="+91 90000 00000" />
            </Field>
          </div>
          <Field label="Address">
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="12 Main Street, City" />
          </Field>
          <Field label="Description" hint="Short blurb about the clinic / services">
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Family dental practice offering…" />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" loading={savingProfile}>Save profile</Button>
          </div>
        </form>
      </Card>

      {/* Security */}
      <Card className="mt-6 p-6">
        <div className="mb-5 flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-indigo-50 text-brand">
            <KeyRound className="size-5" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900">Security</h2>
            <p className="text-xs text-slate-400">Change the password you use to sign in</p>
          </div>
        </div>

        <form onSubmit={changePassword} className="space-y-5">
          <Field label="Current password">
            <Input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="••••••••"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="New password" hint="At least 6 characters">
              <Input
                type="password"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="••••••••"
              />
            </Field>
            <Field label="Confirm new password">
              <Input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="••••••••"
              />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={savingPassword}>Change password</Button>
          </div>
        </form>
      </Card>

      <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-indigo-100 bg-indigo-50/50 px-4 py-3 text-sm text-indigo-900">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-brand" />
        <p>
          Changes here take effect immediately. The next patient who messages your WhatsApp number
          will be offered slots based on these settings.
        </p>
      </div>
    </div>
  );
}
