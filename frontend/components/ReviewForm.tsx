"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle } from "lucide-react";
import { reviewSchema, type ReviewValues } from "@/lib/schema";
import { Button, Card, ErrorMessage } from "./ui";
import { TranscriptPreview } from "./TranscriptPreview";

const field = "w-full rounded-lg border border-[#dbe1ea] bg-white px-3 py-2 text-sm aria-[invalid=true]:border-red-500";

export interface ReviewFormProps {
  transcript: string; processedBy?: { transcription: { label: string }; extraction: { label: string }; fallback_used?: boolean }; initial: ReviewValues; warnings: string[]; saving?: boolean; error?: string | null;
  onConfirm: (v: ReviewValues) => void; onCancel: () => void;
}

export function ReviewForm({ transcript, processedBy, initial, warnings, saving, error, onConfirm, onCancel }: ReviewFormProps) {
  const { register, handleSubmit, formState: { errors } } = useForm<ReviewValues>({ resolver: zodResolver(reviewSchema), defaultValues: initial });
  const err = (m?: string, id?: string) => m && <p id={id} className="mt-1 text-xs text-red-700">{m}</p>;
  return (
    <Card>
      <form onSubmit={handleSubmit(onConfirm)} className="space-y-4" noValidate aria-label="Review extracted task">
        <h2 className="text-base font-semibold">Check your task</h2>
        <TranscriptPreview text={transcript} />
        {processedBy && <p className="text-xs text-slate-600" data-testid="processed-by">Written out by {processedBy.transcription.label}. Details picked out by {processedBy.extraction.label}.{processedBy.fallback_used && " A backup provider was used because the usual one was not available."}</p>}
        {warnings.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" aria-label="Warnings">
            {warnings.map((w) => <li key={w} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{w}</li>)}
          </ul>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label htmlFor="client_name" className="text-sm font-medium">Client name</label>
            <input id="client_name" className={field} aria-invalid={!!errors.client_name} aria-describedby="e-client" {...register("client_name")} />{err(errors.client_name?.message, "e-client")}</div>
          <div><label htmlFor="location" className="text-sm font-medium">Location</label>
            <input id="location" className={field} {...register("location")} />{err(errors.location?.message)}</div>
        </div>
        <div><label htmlFor="action_item" className="text-sm font-medium">Action item</label>
          <textarea id="action_item" rows={2} className={field} aria-invalid={!!errors.action_item} aria-describedby="e-action" {...register("action_item")} />{err(errors.action_item?.message, "e-action")}</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label htmlFor="follow_up_date" className="text-sm font-medium">Follow up date</label>
            <input id="follow_up_date" type="date" className={field} aria-invalid={!!errors.follow_up_date} {...register("follow_up_date")} />{err(errors.follow_up_date?.message)}</div>
          <div><label htmlFor="priority" className="text-sm font-medium">Priority</label>
            <select id="priority" className={field} {...register("priority")}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
        </div>
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <div className="flex gap-2">
          <Button type="submit" loading={saving}>Save task</Button>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>Discard</Button>
        </div>
      </form>
    </Card>
  );
}
