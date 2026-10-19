"use client";
import clsx from "clsx";
import { useEffect } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Priority } from "@/lib/types";

export function Button({ variant = "primary", className, loading, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost"; loading?: boolean }) {
  return (
    <button type="button" {...p} disabled={p.disabled || loading} className={clsx("inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
      variant === "primary" && "bg-[#1f6bff] text-white hover:bg-[#1a5fe6]",
      variant === "secondary" && "border border-[#dbe1ea] bg-white text-[#0f1b33] hover:bg-slate-50",
      variant === "danger" && "bg-red-700 text-white hover:bg-red-800",
      variant === "ghost" && "text-[#0f1b33] hover:bg-slate-100", className)}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{children}
    </button>
  );
}
export const Card = ({ children, className }: { children: ReactNode; className?: string }) => <div className={clsx("rounded-xl border border-[#dbe1ea] bg-white p-4 shadow-sm", className)}>{children}</div>;

const PRI: Record<Priority, string> = { high: "bg-red-50 text-red-800 border-red-200", medium: "bg-amber-50 text-amber-900 border-amber-200", low: "bg-emerald-50 text-emerald-800 border-emerald-200" };
export const PriorityBadge = ({ priority }: { priority: Priority }) => <span className={clsx("rounded-full border px-2 py-0.5 text-xs font-semibold capitalize", PRI[priority])}>{priority}</span>;

export const ErrorMessage = ({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) => (
  <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><div className="flex-1">{children}</div>
    {onRetry && <button type="button" className="font-medium underline" onClick={onRetry}>Try again</button>}
  </div>
);
export const EmptyState = ({ title, hint }: { title: string; hint?: string }) => <div className="rounded-lg border border-dashed border-[#dbe1ea] p-6 text-center text-sm text-slate-600"><p className="font-medium text-[#0f1b33]">{title}</p>{hint && <p className="mt-1">{hint}</p>}</div>;
export const Spinner = ({ label }: { label: string }) => <div role="status" className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />{label}</div>;

export function ConfirmDialog({ open, title, body, confirmLabel, onConfirm, onCancel, busy }: { open: boolean; title: string; body: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void; busy?: boolean }) {
  useEscape(open, onCancel);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div role="alertdialog" aria-modal="true" aria-labelledby="dlg-t" aria-describedby="dlg-b" className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
        <h2 id="dlg-t" className="text-lg font-semibold">{title}</h2>
        <p id="dlg-b" className="mt-2 text-sm text-slate-600">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} autoFocus>Cancel</Button>
          <Button variant="danger" onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}

/** Closes a dialog when Escape is pressed anywhere on the page. */
export function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onEscape(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [active, onEscape]);
}
