"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarDays, Settings, LogOut, Menu, X, CalendarHeart } from "lucide-react";
import { api, getToken, clearToken } from "@/lib/api";
import type { Clinic, Doctor } from "@/lib/types";
import { Spinner } from "@/components/ui";
import { ClinicProvider } from "@/components/clinic-context";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/appointments", label: "Appointments", icon: CalendarDays },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    Promise.all([api.getMe(), api.getClinic(), api.listDoctors()])
      .then(([me, c, roster]) => {
        setDoctor(me.doctor);
        setClinic(c.clinic);
        setDoctors(roster.doctors);
      })
      .catch(() => {
        clearToken();
        router.replace("/login");
      });
  }, [router]);

  function logout() {
    clearToken();
    router.replace("/login");
  }

  if (!clinic || !doctor) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner className="size-6 text-brand" />
      </div>
    );
  }

  const SidebarInner = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex size-9 items-center justify-center rounded-xl bg-brand text-brand-foreground">
          <CalendarHeart className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{clinic.name}</p>
          <p className="truncate text-xs text-slate-400">{doctor.name}</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-indigo-50 text-brand" : "text-slate-600 hover:bg-slate-100",
              )}
            >
              <item.icon className="size-4.5" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-100 p-3">
        <button
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          <LogOut className="size-4.5" />
          Log out
        </button>
      </div>
    </div>
  );

  return (
    <ClinicProvider initialClinic={clinic} initialDoctor={doctor} doctors={doctors}>
      <div className="flex min-h-screen">
        {/* Desktop sidebar */}
        <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:block">
          {SidebarInner}
        </aside>

        {/* Mobile drawer */}
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
            <aside className="animate-fade-in absolute left-0 top-0 h-full w-64 border-r border-slate-200 bg-white">
              {SidebarInner}
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile top bar */}
          <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
            <button onClick={() => setOpen(true)} className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100">
              {open ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
            <span className="text-sm font-semibold text-slate-900">{clinic.name}</span>
          </header>

          <main className="flex-1">{children}</main>
        </div>
      </div>
    </ClinicProvider>
  );
}
