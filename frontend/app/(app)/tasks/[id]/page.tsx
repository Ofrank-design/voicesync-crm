"use client";
import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import { reviewSchema, type ReviewValues } from "@/lib/schema";
import { formatDateOnly, isOverdue } from "@/lib/dates";
import { STATUS_LABELS, STATUSES, type Status } from "@/lib/types";
import { Button, Card, ConfirmDialog, ErrorMessage, PriorityBadge, Spinner } from "@/components/ui";

const field = "w-full rounded-lg border border-[#dbe1ea] bg-white px-3 py-2 text-sm aria-[invalid=true]:border-red-500";

export default function TaskDetails({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter(); const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const q = useQuery({ queryKey: ["task", id], queryFn: () => api.getTask(id) });
  const save = useMutation({ mutationFn: (p: Parameters<typeof api.updateTask>[1]) => api.updateTask(id, p), onSuccess: () => { qc.invalidateQueries({ queryKey: ["task", id] }); qc.invalidateQueries({ queryKey: ["tasks"] }); qc.invalidateQueries({ queryKey: ["stats"] }); } });
  const del = useMutation({ mutationFn: () => api.deleteTask(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); qc.invalidateQueries({ queryKey: ["stats"] }); router.push("/dashboard"); } });

  const t = q.data?.task;
  const { register, handleSubmit, formState: { errors, isDirty } } = useForm<ReviewValues>({ resolver: zodResolver(reviewSchema), values: t ? { client_name: t.client_name, location: t.location, action_item: t.action_item, follow_up_date: t.follow_up_date ?? "", priority: t.priority } : undefined });

  return (
    <main id="main" className="mx-auto max-w-2xl space-y-4 p-4 md:p-8">
      <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm underline"><ArrowLeft className="h-4 w-4" aria-hidden />Back to dashboard</Link>
      {q.isLoading && <Spinner label="Getting your task…" />}
      {q.isError && <ErrorMessage onRetry={() => q.refetch()}>{(q.error as Error).message}</ErrorMessage>}
      {t && (
        <Card className="space-y-4">
          <div className="flex items-start justify-between gap-2"><h1 className="text-xl font-semibold">{t.client_name}</h1><PriorityBadge priority={t.priority} /></div>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-slate-500">Status</dt><dd>{STATUS_LABELS[t.status]}</dd>
            <dt className="text-slate-500">Follow up</dt><dd className={isOverdue(t.follow_up_date, t.status) ? "font-semibold text-red-700" : ""}>{formatDateOnly(t.follow_up_date)}{isOverdue(t.follow_up_date, t.status) && " · Overdue"}</dd>
            <dt className="text-slate-500">Created</dt><dd>{new Date(t.created_at).toLocaleString()}</dd>
          </dl>
          {t.transcript && <p className="rounded-lg bg-slate-50 p-3 text-sm italic">{t.transcript}</p>}
          <fieldset aria-label="Change status" className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0">
            {STATUSES.map((s: Status) => <Button key={s} variant={s === t.status ? "primary" : "secondary"} aria-pressed={s === t.status} disabled={save.isPending} onClick={() => s !== t.status && save.mutate({ status: s })}>{STATUS_LABELS[s]}</Button>)}
          </fieldset>
          <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-3" noValidate aria-label="Edit task">
            <div><label htmlFor="client_name" className="text-sm font-medium">Client name</label><input id="client_name" className={field} aria-invalid={!!errors.client_name} {...register("client_name")} />{errors.client_name && <p className="text-xs text-red-700">{errors.client_name.message}</p>}</div>
            <div><label htmlFor="location" className="text-sm font-medium">Location</label><input id="location" className={field} {...register("location")} /></div>
            <div><label htmlFor="action_item" className="text-sm font-medium">Action item</label><textarea id="action_item" rows={2} className={field} aria-invalid={!!errors.action_item} {...register("action_item")} />{errors.action_item && <p className="text-xs text-red-700">{errors.action_item.message}</p>}</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label htmlFor="follow_up_date" className="text-sm font-medium">Follow up date</label><input id="follow_up_date" type="date" className={field} {...register("follow_up_date")} /></div>
              <div><label htmlFor="priority" className="text-sm font-medium">Priority</label><select id="priority" className={field} {...register("priority")}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
            </div>
            {save.isError && <ErrorMessage>{(save.error as Error).message}</ErrorMessage>}
            {save.isSuccess && !isDirty && <p role="status" className="text-sm text-emerald-800">Saved.</p>}
            <div className="flex justify-between"><Button type="submit" loading={save.isPending} disabled={!isDirty}>Save changes</Button><Button type="button" variant="danger" onClick={() => setConfirmDelete(true)}>Delete</Button></div>
          </form>
        </Card>
      )}
      <ConfirmDialog open={confirmDelete} title="Delete this task?" body="This removes the task for good. You cannot undo it." confirmLabel="Delete task" busy={del.isPending} onConfirm={() => del.mutate()} onCancel={() => setConfirmDelete(false)} />
      {del.isError && <ErrorMessage>{(del.error as Error).message}</ErrorMessage>}
    </main>
  );
}
