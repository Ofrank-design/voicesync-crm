import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense } from "react";
import type { Task } from "@/lib/types";

const h = vi.hoisted(() => ({ api: { getTask: vi.fn(), updateTask: vi.fn(), deleteTask: vi.fn(), listTasks: vi.fn(), stats: vi.fn() }, push: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: any) => <a href={href} {...p}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push, replace: vi.fn() }), usePathname: () => "/" }));
vi.mock("@/lib/auth", () => ({ AUTH_MODE: "local", supabase: vi.fn(), getAccessToken: async () => null }));
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api: h.api }));
import TaskDetails from "@/app/(app)/tasks/[id]/page";
import { ApiError } from "@/lib/api";

const task: Task = { id: "t1", client_name: "Ama", location: "Osu", action_item: "Send invoice", follow_up_date: "2026-10-20", priority: "high", status: "todo", transcript: "Send Ama the invoice", created_at: "2026-10-14T10:00:00Z", updated_at: "2026-10-14T10:00:00Z" };
// React 19 `use()` suspends on a plain promise inside sync act(); a pre-fulfilled thenable renders immediately.
const params = Object.assign(Promise.resolve({ id: "t1" }), { status: "fulfilled" as const, value: { id: "t1" } });
const ui = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Suspense fallback="loading"><TaskDetails params={params} /></Suspense></QueryClientProvider>);

beforeEach(() => { for (const f of Object.values(h.api)) f.mockReset(); h.push.mockReset(); h.api.getTask.mockResolvedValue({ task }); });

describe("Task details page", () => {
  it("shows the full task, timestamps, status and a link back", async () => {
    ui();
    expect(await screen.findByRole("heading", { name: "Ama" })).toBeInTheDocument();
    expect(screen.getByText(/20 Oct 2026/)).toBeInTheDocument();
    expect(screen.getByText(/send ama the invoice/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to dashboard/i })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("button", { name: "To Do" })).toHaveAttribute("aria-pressed", "true");
  });
  it("changes status through the API", async () => {
    h.api.updateTask.mockResolvedValue({ task: { ...task, status: "completed" } });
    ui();
    await userEvent.click(await screen.findByRole("button", { name: "Completed" }));
    await waitFor(() => expect(h.api.updateTask).toHaveBeenCalledWith("t1", { status: "completed" }));
  });
  it("validates and saves edits", async () => {
    h.api.updateTask.mockResolvedValue({ task });
    ui();
    const client = await screen.findByLabelText(/client name/i);
    await userEvent.clear(client);
    expect(screen.getByRole("button", { name: /save changes/i })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByText(/add a client name/i)).toBeInTheDocument();
    expect(h.api.updateTask).not.toHaveBeenCalled();
    await userEvent.type(client, "Ama K");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(h.api.updateTask).toHaveBeenCalledWith("t1", expect.objectContaining({ client_name: "Ama K", follow_up_date: "2026-10-20" })));
  });
  it("requires confirmation before deleting, then returns to the dashboard", async () => {
    h.api.deleteTask.mockResolvedValue(undefined);
    ui();
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const dlg = await screen.findByRole("alertdialog");
    expect(dlg).toHaveTextContent(/cannot undo it/i);
    expect(h.api.deleteTask).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /delete task/i }));
    await waitFor(() => expect(h.push).toHaveBeenCalledWith("/dashboard"));
  });
  it("cancelling the dialog deletes nothing", async () => {
    ui();
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(h.api.deleteTask).not.toHaveBeenCalled();
  });
  it("shows an error with retry when the task is missing", async () => {
    h.api.getTask.mockRejectedValue(new ApiError(404, "not_found", "Task not found"));
    ui();
    expect(await screen.findByRole("alert")).toHaveTextContent(/task not found/i);
  });
});
