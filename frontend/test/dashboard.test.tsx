import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Task } from "@/lib/types";

const h = vi.hoisted(() => ({ api: { listTasks: vi.fn(), stats: vi.fn(), createTask: vi.fn(), updateTask: vi.fn(), me: vi.fn(), usage: vi.fn() }, upload: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: any) => <a href={href} {...p}>{children}</a> }));
vi.mock("@/lib/auth", () => ({ AUTH_MODE: "local", supabase: () => ({ auth: { signOut: vi.fn() } }), getAccessToken: async () => null }));
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api: h.api, uploadVoiceNote: h.upload }));
const SAME = new Blob(["same"], { type: "audio/webm" });
vi.mock("@/components/Recorder", () => ({ Recorder: ({ onSubmit, busy, progress }: any) => (<div><button type="button" onClick={() => onSubmit(new Blob(["a"], { type: "audio/webm" }), 5)} disabled={busy}>Submit test recording</button><button type="button" onClick={() => onSubmit(SAME, 5)} disabled={busy}>Send the same recording</button>{progress && <p role="status">{progress.label}</p>}</div>) }));

import Dashboard from "@/app/(app)/dashboard/page";
import { ApiError } from "@/lib/api";

const task = (o: Partial<Task> = {}): Task => ({ id: "t1", client_name: "Ama", location: "Osu", action_item: "Send invoice", follow_up_date: "2026-10-20", priority: "high", status: "todo", transcript: null, created_at: "2026-10-14T10:00:00Z", updated_at: "2026-10-14T10:00:00Z", ...o });
const stats = { today: "2026-10-14", open: 3, overdue: 1, high_priority: 2, due_today: 1, recent: [task()] };
const result = { request_id: "r1", transcript: "Call Daniel in East Legon on Friday", task: { client_name: "Daniel", location: "East Legon", action_item: "Call about quotation", follow_up_date: "2026-10-16", priority: "medium" }, status: "awaiting_review", reference_date: "2026-10-14", timezone: "UTC", warnings: ["Follow-up date resolved to 2026-10-16 (Friday). Please confirm."] };
const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

beforeEach(() => {
  for (const f of Object.values(h.api)) f.mockReset(); h.upload.mockReset();
  h.api.listTasks.mockResolvedValue({ items: [task()], total: 1 });
  h.api.stats.mockResolvedValue(stats);
  h.api.me.mockResolvedValue({ user_id: "u", is_admin: false });
  h.api.usage.mockResolvedValue({ today: { notes: 0, audio_minutes: 0 }, limits: { notes: null, audio_minutes: null }, resets_at: "" });
});

describe("Dashboard states", () => {
  it("shows a loading state, then metrics from the API and recent activity", async () => {
    h.api.listTasks.mockReturnValue(new Promise(() => {}));
    wrap(<Dashboard />);
    expect(screen.getByText(/getting your tasks/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("metric-Open tasks")).toHaveTextContent("3"));
    expect(screen.getByTestId("metric-Overdue")).toHaveTextContent("1");
    expect(screen.getByTestId("metric-High priority")).toHaveTextContent("2");
    expect(screen.getByTestId("metric-Due today")).toHaveTextContent("1");
    expect(screen.getByText(/recent activity/i)).toBeInTheDocument();
  });
  it("shows an empty state when there are no tasks", async () => {
    h.api.listTasks.mockResolvedValue({ items: [], total: 0 });
    wrap(<Dashboard />);
    expect(await screen.findByText(/no tasks yet/i)).toBeInTheDocument();
  });
  it("shows an error with retry when tasks fail to load", async () => {
    h.api.listTasks.mockRejectedValueOnce(new ApiError(503, "database_error", "The database is temporarily unavailable."));
    wrap(<Dashboard />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/database is temporarily unavailable/i);
    await userEvent.click(within(alert).getByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("article", { name: /Ama/ })).toBeInTheDocument();
  });
  it("passes search and filters to the API", async () => {
    wrap(<Dashboard />);
    await screen.findByRole("article", { name: /Ama/ });
    await userEvent.type(screen.getByLabelText(/search tasks/i), "osu");
    await userEvent.selectOptions(screen.getByLabelText(/priority filter/i), "high");
    await waitFor(() => expect(h.api.listTasks).toHaveBeenLastCalledWith(expect.objectContaining({ search: "osu", priority: "high" })));
  });
});

describe("voice note workflow", () => {
  async function toReview() {
    h.upload.mockImplementation(async (_b: Blob, _m: any, cb: any) => { cb.onStage("transcribing"); cb.onStage("extracting"); return result; });
    wrap(<Dashboard />);
    await screen.findByRole("article", { name: /Ama/ });
    await userEvent.click(screen.getByRole("button", { name: /submit test recording/i }));
    await screen.findByRole("form", { name: /review extracted task/i });
  }
  it("goes upload -> review with transcript, warnings and prefilled fields", async () => {
    await toReview();
    expect(screen.getByTestId("transcript")).toHaveTextContent(/call daniel/i);
    expect(screen.getByRole("list", { name: /warnings/i })).toHaveTextContent(/resolved to 2026-10-16/);
    expect(screen.getByLabelText(/client name/i)).toHaveValue("Daniel");
    expect(screen.getByRole("list", { name: /progress/i })).toHaveTextContent(/awaiting review/i);
    expect(h.api.createTask).not.toHaveBeenCalled(); // nothing saved before confirmation
  });
  it("saves the user-corrected values with a transcript and idempotency key, then refreshes", async () => {
    h.api.createTask.mockResolvedValue({ task: task({ id: "new" }), duplicate: false });
    await toReview();
    await userEvent.clear(screen.getByLabelText(/client name/i));
    await userEvent.type(screen.getByLabelText(/client name/i), "Daniel Mensah");
    await userEvent.selectOptions(screen.getByLabelText("Priority"), "high");
    await userEvent.click(screen.getByRole("button", { name: /save task/i }));
    await screen.findByText(/task saved/i);
    const [payload, key] = h.api.createTask.mock.calls[0]!;
    expect(payload).toMatchObject({ client_name: "Daniel Mensah", priority: "high", follow_up_date: "2026-10-16", transcript: result.transcript });
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(h.api.listTasks.mock.calls.length).toBeGreaterThan(1); // board re-fetched
  });
  it("does not double-save on a double click", async () => {
    let resolve!: (v: unknown) => void;
    h.api.createTask.mockReturnValue(new Promise((r) => (resolve = r)));
    await toReview();
    const btn = screen.getByRole("button", { name: /save task/i });
    await userEvent.dblClick(btn);
    expect(h.api.createTask).toHaveBeenCalledTimes(1);
    resolve({ task: task(), duplicate: false });
    await screen.findByText(/task saved/i);
  });
  it("keeps the review open on save failure and retries with the SAME idempotency key", async () => {
    h.api.createTask.mockRejectedValueOnce(new ApiError(0, "network", "Could not reach the server.")).mockResolvedValueOnce({ task: task(), duplicate: true });
    await toReview();
    await userEvent.click(screen.getByRole("button", { name: /save task/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not reach the server/i);
    expect(screen.getByLabelText(/client name/i)).toHaveValue("Daniel"); // edits not lost
    await userEvent.click(screen.getByRole("button", { name: /save task/i }));
    await screen.findByText(/task saved/i);
    expect(h.api.createTask.mock.calls[0]![1]).toBe(h.api.createTask.mock.calls[1]![1]);
  });
  it("discarding the review saves nothing", async () => {
    await toReview();
    await userEvent.click(screen.getByRole("button", { name: /discard/i }));
    expect(screen.queryByRole("form", { name: /review/i })).toBeNull();
    expect(h.api.createTask).not.toHaveBeenCalled();
  });
  it("shows the failure and a failed stage when processing fails", async () => {
    h.upload.mockRejectedValue(new ApiError(422, "empty_transcript", "No speech was detected in the recording."));
    wrap(<Dashboard />);
    await screen.findByRole("article", { name: /Ama/ });
    await userEvent.click(screen.getByRole("button", { name: /submit test recording/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/no speech was detected/i);
    expect(screen.getByRole("list", { name: /progress/i })).toHaveTextContent(/failed/i);
  });
  it("shows transcribing then extracting while processing", async () => {
    let cbs: any, finish!: (v: unknown) => void;
    h.upload.mockImplementation((_b: Blob, _m: any, cb: any) => new Promise((r) => { cbs = cb; finish = r; }));
    wrap(<Dashboard />);
    await screen.findByRole("article", { name: /Ama/ });
    await userEvent.click(screen.getByRole("button", { name: /submit test recording/i }));
    await waitFor(() => expect(cbs).toBeTruthy());
    act(() => cbs.onStage("transcribing"));
    expect(await screen.findByText(/listening to your note/i)).toBeInTheDocument();
    act(() => cbs.onStage("extracting"));
    expect(await screen.findByText(/picking out the details/i)).toBeInTheDocument();
    await act(async () => finish(result));
    await screen.findByRole("form", { name: /review extracted task/i });
  });
});

describe("Kanban persistence", () => {
  it("persists a status change via the API", async () => {
    h.api.updateTask.mockResolvedValue({ task: task({ status: "in_progress" }) });
    wrap(<Dashboard />);
    await screen.findByRole("article", { name: /Ama/ });
    await userEvent.selectOptions(screen.getByLabelText(/status for ama/i), "in_progress");
    await waitFor(() => expect(h.api.updateTask).toHaveBeenCalledWith("t1", { status: "in_progress" }));
  });
  it("reverts the card and shows an error when the update fails", async () => {
    h.api.updateTask.mockRejectedValue(new ApiError(503, "database_error", "down"));
    wrap(<Dashboard />);
    await screen.findByRole("article", { name: /Ama/ });
    await userEvent.selectOptions(screen.getByLabelText(/status for ama/i), "completed");
    expect(await screen.findByText(/back where it was/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(/status for ama/i)).toHaveValue("todo"));
  });
});

describe("Provider settings link", () => {
  it("shows for admins only", async () => {
    h.api.me.mockResolvedValue({ user_id: "a", is_admin: true });
    wrap(<Dashboard />);
    expect(await screen.findByRole("link", { name: /provider settings/i })).toHaveAttribute("href", "/settings");
  });
  it("is hidden for everyone else", async () => {
    wrap(<Dashboard />);
    await screen.findByRole("article", { name: /Ama/ });
    expect(screen.queryByRole("link", { name: /provider settings/i })).toBeNull();
  });
});

describe("daily allowance", () => {
  it("shows today's use against the limits when limits are set", async () => {
    h.api.usage.mockResolvedValue({ today: { notes: 3, audio_minutes: 4.5 }, limits: { notes: 20, audio_minutes: 30 }, resets_at: "2026-10-17T00:00:00.000Z" });
    wrap(<Dashboard />);
    expect(await screen.findByTestId("allowance")).toHaveTextContent("Today: 3 of 20 voice notes. Audio today: 4.5 of 30 minutes. The count starts again at midnight UTC.");
  });
  it("shows nothing when there is no limit", async () => {
    wrap(<Dashboard />);
    await screen.findByRole("article", { name: /Ama/ });
    expect(screen.queryByTestId("allowance")).toBeNull();
  });
  it("shows the server's plain message when the limit is reached", async () => {
    h.upload.mockRejectedValue(new ApiError(429, "daily_limit_reached", "You have used all 20 of today's voice notes. The count starts again at midnight UTC."));
    wrap(<Dashboard />);
    await screen.findByRole("article", { name: /Ama/ });
    await userEvent.click(screen.getByRole("button", { name: /submit test recording/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/used all 20 of today's voice notes/);
  });
});

describe("safe retries", () => {
  const keyOf = (n: number) => h.upload.mock.calls[n]![1].idempotencyKey as string;
  it("sends the same Idempotency-Key when the same recording is sent again, and a new one for a new recording", async () => {
    h.upload.mockRejectedValue(new ApiError(0, "network", "We could not reach the server."));
    wrap(<Dashboard />);
    await screen.findByRole("article", { name: /Ama/ });
    await userEvent.click(screen.getByRole("button", { name: /send the same recording/i }));
    await screen.findByRole("alert");
    await userEvent.click(screen.getByRole("button", { name: /send the same recording/i }));
    await waitFor(() => expect(h.upload).toHaveBeenCalledTimes(2));
    expect(keyOf(0)).toMatch(/^[0-9a-f-]{36}$/); expect(keyOf(1)).toBe(keyOf(0));
    await userEvent.click(screen.getByRole("button", { name: /submit test recording/i }));
    await waitFor(() => expect(h.upload).toHaveBeenCalledTimes(3));
    expect(keyOf(2)).not.toBe(keyOf(0));
  });
});

describe("Your data link", () => {
  it("is available to everyone", async () => {
    wrap(<Dashboard />);
    expect(await screen.findByRole("link", { name: /your data/i })).toHaveAttribute("href", "/account");
  });
});
