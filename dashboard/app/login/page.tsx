"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarHeart } from "lucide-react";
import { api, setToken, ApiError } from "@/lib/api";
import { Button, Card, Field, Input } from "@/components/ui";
import { useToast } from "@/components/toast";

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
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-brand text-brand-foreground shadow-sm">
            <CalendarHeart className="size-6" />
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">Welcome back</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to manage your clinic</p>
        </div>

        <Card className="p-6">
          <form onSubmit={onSubmit} className="space-y-4">
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
        </Card>
      </div>
    </div>
  );
}
