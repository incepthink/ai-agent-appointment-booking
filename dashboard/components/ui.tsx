import * as React from "react";
import { cn } from "@/lib/cn";

/* ---------------- Button ---------------- */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const variants: Record<string, string> = {
    primary: "bg-brand text-brand-foreground hover:bg-indigo-700 shadow-sm",
    secondary: "bg-white text-slate-800 border border-slate-200 hover:bg-slate-50 shadow-sm",
    ghost: "text-slate-600 hover:bg-slate-100",
    danger: "bg-rose-600 text-white hover:bg-rose-700 shadow-sm",
  };
  const sizes: Record<string, string> = {
    sm: "h-8 px-3 text-sm",
    md: "h-10 px-4 text-sm",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none",
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

/* ---------------- Spinner ---------------- */

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("animate-spin", className)} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

/* ---------------- Inputs ---------------- */

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400",
          "focus:border-brand focus:ring-0 outline-none transition-colors",
          className,
        )}
        {...props}
      />
    );
  },
);

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400",
        "focus:border-brand outline-none transition-colors",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900",
        "focus:border-brand outline-none transition-colors",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

/* ---------------- Card ---------------- */

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-xl border border-slate-200 bg-card shadow-sm", className)}>
      {children}
    </div>
  );
}

/* ---------------- Badge ---------------- */

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "brand" | "neutral" | "muted";
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    brand: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100",
    neutral: "bg-slate-100 text-slate-700",
    muted: "bg-slate-100 text-slate-400 line-through",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone])}>
      {children}
    </span>
  );
}
