import clsx from "clsx";
import { Check } from "lucide-react";

export const STAGES = ["recording", "uploading", "transcribing", "extracting", "awaiting review", "saving", "completed"] as const;
export type FlowStage = (typeof STAGES)[number] | "failed" | "idle";

/** Shows where the voice note is in the pipeline. `failed` is announced separately by the caller. */
export function StageIndicator({ stage }: { stage: FlowStage }) {
  if (stage === "idle") return null;
  const idx = STAGES.indexOf(stage as (typeof STAGES)[number]);
  return (
    <ol aria-label="Progress" className="flex flex-wrap gap-2 text-xs">
      {STAGES.map((s, i) => {
        const state = stage === "failed" ? "pending" : i < idx || stage === "completed" ? "done" : i === idx ? "current" : "pending";
        return (
          <li key={s} aria-current={state === "current" ? "step" : undefined} className={clsx("flex items-center gap-1 rounded-full border px-2 py-0.5 capitalize",
            state === "current" && "border-[#1f6bff] bg-blue-50 font-semibold text-[#1450c0]", state === "done" && "border-emerald-200 bg-emerald-50 text-emerald-900", state === "pending" && "border-[#dbe1ea] text-slate-600")}>
            {state === "done" && <Check className="h-3 w-3" aria-hidden />}{s}<span className="sr-only">{state === "done" ? " (done)" : state === "current" ? " (in progress)" : ""}</span>
          </li>
        );
      })}
      {stage === "failed" && <li className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 font-semibold text-red-900">failed</li>}
    </ol>
  );
}
