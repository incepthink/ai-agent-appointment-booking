"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarHeart, MessageCircle, CalendarClock, BellRing } from "lucide-react";
import { api, setToken, ApiError } from "@/lib/api";
import { Button, Field, Input } from "@/components/ui";
import { useToast } from "@/components/toast";

const features = [
  {
    icon: MessageCircle,
    title: "WhatsApp booking agent",
    desc: "Patients book in a chat — no apps, no calls.",
  },
  {
    icon: CalendarClock,
    title: "Live calendar",
    desc: "Every appointment and opening, always in sync.",
  },
  {
    icon: BellRing,
    title: "Automatic reminders",
    desc: "Smart nudges that keep no-shows near zero.",
  },
];

export default function LoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { token } = await api.login(email, password);
      setToken(token);
      toast("Welcome back!", "success");
      router.replace("/appointments");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Login failed", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* ---------- Left: brand showcase (desktop only) ---------- */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-linear-to-br from-indigo-600 via-indigo-700 to-violet-800 p-12 text-white lg:flex xl:p-16">
        {/* decorative glow blobs */}
        <div className="pointer-events-none absolute -left-24 -top-24 size-96 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -right-20 size-112 rounded-full bg-violet-400/20 blur-3xl" />
        <div className="pointer-events-none absolute right-1/3 top-1/3 size-72 rounded-full bg-indigo-300/10 blur-3xl" />

        {/* wordmark */}
        <div className="relative flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25 backdrop-blur">
            <CalendarHeart className="size-6" />
          </div>
          <span className="text-lg font-semibold tracking-tight">Clinic Dashboard</span>
        </div>

        {/* headline + features */}
        <div className="relative max-w-md">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">
            Smart booking,
            <br />
            zero no-shows.
          </h2>
          <p className="mt-4 text-base text-indigo-100/90">
            Run your clinic from one calm place — your WhatsApp agent handles the
            booking, you stay in control.
          </p>

          <ul className="mt-10 space-y-5">
            {features.map(({ icon: Icon, title, desc }) => (
              <li key={title} className="flex items-start gap-4">
                <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
                  <Icon className="size-5" />
                </div>
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="text-sm text-indigo-100/80">{desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-sm text-indigo-200/70">
          © {new Date().getFullYear()} Clinic Dashboard. All rights reserved.
        </p>
      </div>

      {/* ---------- Right: sign-in form ---------- */}
      <div className="flex w-full items-center justify-center p-6 lg:w-1/2">
        <div className="w-full max-w-sm animate-fade-in">
          {/* logo — shown on mobile where the left panel is hidden */}
          <div className="mb-8 flex flex-col items-center text-center lg:items-start lg:text-left">
            <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-brand text-brand-foreground shadow-sm lg:hidden">
              <CalendarHeart className="size-6" />
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
              Welcome back
            </h1>
            <p className="mt-2 text-sm text-slate-500">Sign in to manage your clinic</p>
          </div>

          <form onSubmit={onSubmit} className="space-y-5">
            <Field label="Email">
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@clinic.com"
                autoComplete="email"
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </Field>
            <Button type="submit" loading={loading} className="w-full">
              Sign in
            </Button>
          </form>

          <p className="mt-8 text-center text-xs text-slate-400">
            Trouble signing in? Contact your clinic administrator.
          </p>
        </div>
      </div>
    </div>
  );
}
