import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReviewForm } from "@/components/ReviewForm";
import { KanbanBoard, sortForDisplay } from "@/components/Kanban";
import { formatDateOnly, isOverdue, todayLocal } from "@/lib/dates";
import type { Task } from "@/lib/types";

vi.mock("next/link", () => ({ default: ({ href, children, ...p }: any) => <a href={href} {...p}>{children}</a> }));

const initial = { client_name: "Daniel", location: "East Legon", action_item: "Call about quotation", follow_up_date: "2026-10-16", priority: "medium" as const };
const task = (o: Partial<Task> = {}): Task => ({ id: "1", client_name: "Daniel", location: "East Legon", action_item: "Call", follow_up_date: "2026-10-16", priority: "medium", status: "todo", transcript: null, created_at: "2026-10-14T10:00:00Z", updated_at: "2026-10-14T10:00:00Z", ...o });

describe("ReviewForm", () => {
  it("shows transcript and warnings, and labels every control", () => {
    render(<ReviewForm transcript="call daniel friday" initial={initial} warnings={["Please confirm the date"]} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByTestId("transcript")).toHaveTextContent("call daniel friday");
    expect(screen.getByRole("list", { name: /warnings/i })).toHaveTextContent(/confirm the date/);
    for (const l of [/client name/i, /location/i, /action item/i, /follow up date/i, /priority/i]) expect(screen.getByLabelText(l)).toBeInTheDocument();
  });
  it("blocks saving with a missing client and shows an error", async () => {
    const onConfirm = vi.fn();
    render(<ReviewForm transcript="t" initial={{ ...initial, client_name: "" }} warnings={[]} onConfirm={onConfirm} onCancel={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /save task/i }));
    expect(await screen.findByText(/add a client name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/client name/i)).toHaveAttribute("aria-invalid", "true");
    expect(onConfirm).not.toHaveBeenCalled();
  });
  it("lets the user edit date and priority before saving", async () => {
    const onConfirm = vi.fn();
    render(<ReviewForm transcript="t" initial={initial} warnings={[]} onConfirm={onConfirm} onCancel={() => {}} />);
    await userEvent.clear(screen.getByLabelText(/client name/i));
    await userEvent.type(screen.getByLabelText(/client name/i), "Daniela");
    await userEvent.selectOptions(screen.getByLabelText(/priority/i), "high");
    await userEvent.clear(screen.getByLabelText(/follow up date/i));
    await userEvent.type(screen.getByLabelText(/follow up date/i), "2026-10-20");
    await userEvent.click(screen.getByRole("button", { name: /save task/i }));
    expect(onConfirm).toHaveBeenCalledWith({ ...initial, client_name: "Daniela", priority: "high", follow_up_date: "2026-10-20" }, expect.anything());
  });
  it("allows an empty follow-up date and supports discard", async () => {
    const onConfirm = vi.fn(), onCancel = vi.fn();
    render(<ReviewForm transcript="t" initial={{ ...initial, follow_up_date: "" }} warnings={[]} onConfirm={onConfirm} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: /save task/i }));
    expect(onConfirm).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /discard/i }));
    expect(onCancel).toHaveBeenCalled();
  });
  it("disables actions and shows errors while saving", () => {
    render(<ReviewForm transcript="t" initial={initial} warnings={[]} saving error="Could not save" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("button", { name: /save task/i })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save");
  });
});

describe("KanbanBoard", () => {
  it("renders three columns with an empty state", () => {
    render(<KanbanBoard tasks={[]} onMove={() => {}} />);
    expect(screen.getAllByText("Nothing here yet")).toHaveLength(3);
    for (const n of ["To Do", "In Progress", "Completed"]) expect(screen.getByRole("heading", { name: new RegExp(n) })).toBeInTheDocument();
  });
  it("moves a task with keyboard-accessible controls", async () => {
    const onMove = vi.fn();
    render(<KanbanBoard tasks={[task()]} onMove={onMove} today="2026-10-14" />);
    await userEvent.selectOptions(screen.getByLabelText(/status for daniel/i), "completed");
    expect(onMove).toHaveBeenCalledWith("1", "completed");
    await userEvent.click(screen.getByRole("button", { name: /move daniel to in progress/i }));
    expect(onMove).toHaveBeenCalledWith("1", "in_progress");
  });
  it("shows location, priority, edit link and overdue indicator", () => {
    render(<KanbanBoard tasks={[task({ follow_up_date: "2026-10-01" })]} onMove={() => {}} today="2026-10-14" />);
    const card = screen.getByRole("article");
    expect(within(card).getByText(/east legon/i)).toBeInTheDocument();
    expect(within(card).getByText(/overdue/i)).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /edit daniel/i })).toHaveAttribute("href", "/tasks/1");
  });
  it("does not flag completed tasks as overdue", () => {
    render(<KanbanBoard tasks={[task({ follow_up_date: "2026-10-01", status: "completed" })]} onMove={() => {}} today="2026-10-14" />);
    expect(screen.queryByText(/overdue/i)).toBeNull();
  });
  it("sorts overdue then high priority first without mutating input", () => {
    const input = [task({ id: "a", priority: "low" }), task({ id: "b", priority: "high" }), task({ id: "c", priority: "low", follow_up_date: "2026-01-01" })];
    expect(sortForDisplay(input, "2026-10-14").map((t) => t.id)).toEqual(["c", "b", "a"]);
    expect(input.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });
});

describe("date-only handling", () => {
  it("formats without timezone drift", () => { expect(formatDateOnly("2026-10-16")).toMatch(/16 Oct 2026/); expect(formatDateOnly(null)).toBe("No date set"); });
  it("compares ISO dates lexicographically", () => { expect(isOverdue("2026-10-13", "todo", "2026-10-14")).toBe(true); expect(isOverdue("2026-10-14", "todo", "2026-10-14")).toBe(false); });
  it("todayLocal uses the local calendar date", () => { expect(todayLocal(new Date(2026, 9, 14, 23, 59))).toBe("2026-10-14"); });
});

describe("ReviewForm provider disclosure", () => {
  it("tells the user which providers handled the note", () => {
    render(<ReviewForm transcript="t" processedBy={{ transcription: { label: "OpenAI" }, extraction: { label: "Groq" } }} initial={initial} warnings={[]} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByTestId("processed-by")).toHaveTextContent("Written out by OpenAI. Details picked out by Groq.");
  });
  it("shows nothing extra when the server does not say", () => {
    render(<ReviewForm transcript="t" initial={initial} warnings={[]} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.queryByTestId("processed-by")).toBeNull();
  });
});

describe("ReviewForm backup disclosure", () => {
  it("says so when a backup provider handled the note", () => {
    render(<ReviewForm transcript="t" processedBy={{ transcription: { label: "OpenAI" }, extraction: { label: "Groq" }, fallback_used: true }} initial={initial} warnings={[]} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByTestId("processed-by")).toHaveTextContent("Written out by OpenAI. Details picked out by Groq. A backup provider was used because the usual one was not available.");
  });
  it("does not mention a backup when none was used", () => {
    render(<ReviewForm transcript="t" processedBy={{ transcription: { label: "OpenAI" }, extraction: { label: "Groq" } }} initial={initial} warnings={[]} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByTestId("processed-by")).not.toHaveTextContent(/backup/i);
  });
});
