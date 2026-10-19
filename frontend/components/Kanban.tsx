"use client";
import Link from "next/link";
import clsx from "clsx";
import { ArrowLeft, ArrowRight, CalendarDays, MapPin, Pencil } from "lucide-react";
import { useState } from "react";
import { STATUS_LABELS, STATUSES, type Status, type Task } from "@/lib/types";
import { formatDateOnly, isOverdue } from "@/lib/dates";
import { EmptyState, PriorityBadge } from "./ui";

export function TaskCard({ task, onMove, today }: { task: Task; onMove: (id: string, s: Status) => void; today?: string }) {
  const overdue = isOverdue(task.follow_up_date, task.status, today);
  const i = STATUSES.indexOf(task.status);
  return (
    <article draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", task.id)} aria-label={`${task.client_name}: ${task.action_item}`}
      className={clsx("space-y-2 rounded-lg border bg-white p-3 shadow-sm", overdue ? "border-red-300" : "border-[#dbe1ea]")}>
      <div className="flex items-start justify-between gap-2"><h3 className="text-sm font-semibold">{task.client_name}</h3><PriorityBadge priority={task.priority} /></div>
      <p className="text-sm">{task.action_item}</p>
      {task.location && <p className="flex items-center gap-1 text-xs text-slate-600"><MapPin className="h-3 w-3" aria-hidden />{task.location}</p>}
      <p className={clsx("flex items-center gap-1 text-xs", overdue ? "font-semibold text-red-700" : "text-slate-600")}><CalendarDays className="h-3 w-3" aria-hidden />{formatDateOnly(task.follow_up_date)}{overdue && <span> · Overdue</span>}</p>
      <div className="flex items-center gap-1 pt-1">
        <button type="button" className="rounded p-1 hover:bg-slate-100 disabled:opacity-30" disabled={i === 0} aria-label={`Move ${task.client_name} to ${STATUS_LABELS[STATUSES[i - 1] ?? "todo"]}`} onClick={() => onMove(task.id, STATUSES[i - 1]!)}><ArrowLeft className="h-4 w-4" aria-hidden /></button>
        <label className="sr-only" htmlFor={`st-${task.id}`}>Status for {task.client_name}</label>
        <select id={`st-${task.id}`} value={task.status} onChange={(e) => onMove(task.id, e.target.value as Status)} className="flex-1 rounded border border-[#dbe1ea] px-1 py-1 text-xs">
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <button type="button" className="rounded p-1 hover:bg-slate-100 disabled:opacity-30" disabled={i === STATUSES.length - 1} aria-label={`Move ${task.client_name} to ${STATUS_LABELS[STATUSES[i + 1] ?? "completed"]}`} onClick={() => onMove(task.id, STATUSES[i + 1]!)}><ArrowRight className="h-4 w-4" aria-hidden /></button>
        <Link href={`/tasks/${task.id}`} className="rounded p-1 hover:bg-slate-100" aria-label={`Edit ${task.client_name}`}><Pencil className="h-4 w-4" aria-hidden /></Link>
      </div>
    </article>
  );
}

const rank = { high: 0, medium: 1, low: 2 } as const;
/** Overdue and high-priority float to the top of a column for display only; stored data is untouched. */
export function sortForDisplay(tasks: Task[], today?: string) {
  return [...tasks].sort((a, b) => Number(isOverdue(b.follow_up_date, b.status, today)) - Number(isOverdue(a.follow_up_date, a.status, today)) || rank[a.priority] - rank[b.priority] || a.created_at.localeCompare(b.created_at));
}

export function KanbanColumn({ status, tasks, onMove, today, allTasks }: { status: Status; tasks: Task[]; onMove: (id: string, s: Status) => void; today?: string; allTasks: Task[] }) {
  const [over, setOver] = useState(false);
  const col = sortForDisplay(tasks, today);
  return (
    <section aria-labelledby={`col-${status}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const id = e.dataTransfer.getData("text/plain"); const t = allTasks.find((x) => x.id === id); if (t && t.status !== status) onMove(id, status); }}
      className={clsx("min-h-40 space-y-3 rounded-xl bg-slate-100 p-3", over && "ring-2 ring-[#1f6bff]")}>
      <h2 id={`col-${status}`} className="flex items-center justify-between text-sm font-semibold">{STATUS_LABELS[status]}<span className="rounded-full bg-white px-2 text-xs">{col.length}</span></h2>
      {col.length === 0 ? <EmptyState title="Nothing here yet" /> : col.map((t) => <TaskCard key={t.id} task={t} onMove={onMove} today={today} />)}
    </section>
  );
}

export function KanbanBoard({ tasks, onMove, today }: { tasks: Task[]; onMove: (id: string, s: Status) => void; today?: string }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {STATUSES.map((s) => <KanbanColumn key={s} status={s} tasks={tasks.filter((t) => t.status === s)} allTasks={tasks} onMove={onMove} today={today} />)}
    </div>
  );
}
