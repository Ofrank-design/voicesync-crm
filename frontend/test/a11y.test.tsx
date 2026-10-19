import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import axe from "axe-core";
import { ReviewForm } from "@/components/ReviewForm";
import { KanbanBoard } from "@/components/Kanban";
import { Recorder } from "@/components/Recorder";
import { StageIndicator } from "@/components/StageIndicator";
import { MetricsRow } from "@/components/Metrics";
import { ConfirmDialog, ErrorMessage, EmptyState } from "@/components/ui";
import type { Task } from "@/lib/types";

vi.mock("next/link", () => ({ default: ({ href, children, ...p }: any) => <a href={href} {...p}>{children}</a> }));

// jsdom has no layout engine, so colour-contrast is checked separately (scripts/contrast.mjs), not here.
async function violations(container: HTMLElement) {
  const r = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  return r.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
}
const task: Task = { id: "1", client_name: "Ama", location: "Osu", action_item: "Send invoice", follow_up_date: "2026-10-01", priority: "high", status: "todo", transcript: null, created_at: "2026-10-14T10:00:00Z", updated_at: "2026-10-14T10:00:00Z" };

describe("axe accessibility scan", () => {
  it("review form", async () => { const { container } = render(<ReviewForm transcript="t" initial={{ client_name: "", location: "", action_item: "A", follow_up_date: "", priority: "medium" }} warnings={["Check the date"]} onConfirm={() => {}} onCancel={() => {}} error="Oops" />); expect(await violations(container)).toEqual([]); });
  it("kanban board with cards", async () => { const { container } = render(<KanbanBoard tasks={[task, { ...task, id: "2", status: "completed" }]} onMove={() => {}} today="2026-10-14" />); expect(await violations(container)).toEqual([]); });
  it("empty kanban board", async () => { const { container } = render(<KanbanBoard tasks={[]} onMove={() => {}} />); expect(await violations(container)).toEqual([]); });
  it("recorder panel", async () => { const { container } = render(<Recorder onSubmit={() => {}} progress={{ label: "Uploading… 40%", pct: 40 }} busy />); expect(await violations(container)).toEqual([]); });
  it("stage indicator, metrics, messages", async () => {
    const { container } = render(<div><StageIndicator stage="extracting" /><StageIndicator stage="failed" /><MetricsRow stats={{ open: 1, overdue: 0, high_priority: 1, due_today: 0 }} /><ErrorMessage onRetry={() => {}}>Failed</ErrorMessage><EmptyState title="Empty" hint="Hint" /></div>);
    expect(await violations(container)).toEqual([]);
  });
  it("confirmation dialog", async () => { const { container } = render(<ConfirmDialog open title="Delete?" body="Sure?" confirmLabel="Delete" onConfirm={() => {}} onCancel={() => {}} />); expect(await violations(container)).toEqual([]); });
});
