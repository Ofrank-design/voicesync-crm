import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axe from "axe-core";
import type { ProviderStatus } from "@/lib/types";

const h = vi.hoisted(() => ({ api: { adminProviders: vi.fn(), saveProviders: vi.fn(), resetProviders: vi.fn(), testProvider: vi.fn(), adminUsage: vi.fn(), usageCsv: vi.fn() } }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: any) => <a href={href} {...p}>{children}</a> }));
vi.mock("@/lib/auth", () => ({ AUTH_MODE: "local", supabase: vi.fn(), getAccessToken: async () => null }));
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api: h.api }));
import Settings from "@/app/(app)/settings/page";
import { ApiError } from "@/lib/api";

const providers = [
  { id: "openai", label: "OpenAI", capabilities: ["transcription", "extraction"], key_env: "OPENAI_API_KEY", key_set: true, needs_model: false },
  { id: "anthropic", label: "Anthropic", capabilities: ["extraction"], key_env: "ANTHROPIC_API_KEY", key_set: true, needs_model: true },
  { id: "groq", label: "Groq", capabilities: ["transcription", "extraction"], key_env: "GROQ_API_KEY", key_set: true, needs_model: true },
  { id: "gemini", label: "Google Gemini", capabilities: ["extraction"], key_env: "GEMINI_API_KEY", key_set: false, needs_model: true },
] as ProviderStatus["providers"];
const status = (o: Partial<ProviderStatus> = {}): ProviderStatus => ({ source: "server", notice: null, providers, active: { transcription: { id: "openai", label: "OpenAI", model: null }, extraction: { id: "anthropic", label: "Anthropic", model: "claude-model" } }, ...o });
const emptyUsage = { days: 7, limits: { notes: null, audio_minutes: null }, totals: { calls: 0, failures: 0, fallback_calls: 0, notes: 0, audio_minutes: 0, input_tokens: 0, output_tokens: 0 }, by_provider: [] };
const ui = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Settings /></QueryClientProvider>);
const extraction = () => within(screen.getByRole("group", { name: /text to task/i }));
const speech = () => within(screen.getByRole("group", { name: /speech to text/i }));

beforeEach(() => { for (const f of Object.values(h.api)) f.mockReset(); h.api.adminProviders.mockResolvedValue(status()); h.api.adminUsage.mockResolvedValue(emptyUsage); });

describe("Provider settings page", () => {
  it("shows what is active, where it came from, and key status, with no place to type a key", async () => {
    ui();
    expect(await screen.findByTestId("active-now")).toHaveTextContent("Speech to text: OpenAI. Text to task: Anthropic.");
    expect(screen.getByText(/come from the server settings/i)).toBeInTheDocument();
    expect(extraction().getByText(/the server has a key for anthropic/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/api key|secret|token/i)).toBeNull();
    expect(screen.getByText(/keys are never typed here/i)).toBeInTheDocument();
  });
  it("only offers providers that can do each step", async () => {
    ui(); await screen.findByTestId("active-now");
    expect(speech().getAllByRole("option").map((o) => o.textContent)).toEqual(["OpenAI", "Groq"]);
    expect(extraction().getAllByRole("option").map((o) => o.textContent)).toEqual(["OpenAI", "Anthropic", "Groq", "Google Gemini"]);
  });
  it("explains a missing key and blocks saving and testing for that provider", async () => {
    ui(); await screen.findByTestId("active-now");
    await userEvent.selectOptions(extraction().getByLabelText("Provider"), "gemini");
    expect(extraction().getByRole("alert")).toHaveTextContent(/GEMINI_API_KEY to the server environment and restart/);
    expect(extraction().getByRole("button", { name: /test connection/i })).toBeDisabled();
    await userEvent.type(extraction().getByLabelText("Model"), "some-model");
    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
  });
  it("tests the chosen provider and model and shows a plain success message", async () => {
    h.api.testProvider.mockResolvedValue({ ok: true, step: "extraction", provider: "groq", label: "Groq", ms: 820, message: "The model answered with a valid task." });
    ui(); await screen.findByTestId("active-now");
    await userEvent.selectOptions(extraction().getByLabelText("Provider"), "groq");
    await userEvent.type(extraction().getByLabelText("Model"), "llm-model");
    await userEvent.click(extraction().getByRole("button", { name: /test connection/i }));
    expect(await extraction().findByRole("status")).toHaveTextContent("It works with Groq (0.8 seconds). The model answered with a valid task.");
    expect(h.api.testProvider).toHaveBeenCalledWith({ step: "extraction", provider: "groq", model: "llm-model" });
  });
  it("shows a failed test in plain words, and clears it when the choice changes", async () => {
    h.api.testProvider.mockResolvedValue({ ok: false, step: "transcription", provider: "groq", label: "Groq", ms: 100, message: "The transcription provider could not find that model. Whoever runs the server needs to check the model ID.", code: "transcription_model_not_found" });
    ui(); await screen.findByTestId("active-now");
    await userEvent.selectOptions(speech().getByLabelText("Provider"), "groq");
    await userEvent.type(speech().getByLabelText("Model"), "typo");
    await userEvent.click(speech().getByRole("button", { name: /test connection/i }));
    expect(await speech().findByRole("status")).toHaveTextContent(/that did not work.*check the model ID/i);
    await userEvent.type(speech().getByLabelText("Model"), "x");
    expect(speech().queryByRole("status")).toBeNull();
  });
  it("shows a message when the test request itself fails", async () => {
    h.api.testProvider.mockRejectedValue(new ApiError(0, "network", "We could not reach the server."));
    ui(); await screen.findByTestId("active-now");
    await userEvent.click(extraction().getByRole("button", { name: /test connection/i }));
    expect(await extraction().findByRole("status")).toHaveTextContent(/could not reach the server/i);
  });
  it("saving needs a change and a confirmation that says who will handle the data", async () => {
    h.api.saveProviders.mockResolvedValue(status({ source: "saved", active: { transcription: { id: "groq", label: "Groq", model: "stt-model" }, extraction: { id: "groq", label: "Groq", model: "llm-model" } } }));
    ui(); await screen.findByTestId("active-now");
    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
    await userEvent.selectOptions(speech().getByLabelText("Provider"), "groq"); await userEvent.type(speech().getByLabelText("Model"), "stt-model");
    await userEvent.selectOptions(extraction().getByLabelText("Provider"), "groq"); await userEvent.type(extraction().getByLabelText("Model"), "llm-model");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    const dlg = await screen.findByRole("alertdialog");
    expect(dlg).toHaveTextContent(/Groq for speech and Groq for the task details.*who processes your users' data/);
    expect(h.api.saveProviders).not.toHaveBeenCalled();
    await userEvent.click(within(dlg).getByRole("button", { name: /change providers/i }));
    await waitFor(() => expect(h.api.saveProviders).toHaveBeenCalledWith({ transcription: "groq", transcription_model: "stt-model", extraction: "groq", extraction_model: "llm-model" }));
    expect(await screen.findByText(/new voice notes will use these providers/i)).toBeInTheDocument();
    expect(screen.getByTestId("active-now")).toHaveTextContent("Speech to text: Groq. Text to task: Groq.");
    expect(screen.getByText(/set in this screen/i)).toBeInTheDocument();
  });
  it("cancelling the confirmation saves nothing", async () => {
    ui(); await screen.findByTestId("active-now");
    await userEvent.selectOptions(extraction().getByLabelText("Provider"), "openai"); await userEvent.type(extraction().getByLabelText("Model"), "m");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: /cancel/i }));
    expect(h.api.saveProviders).not.toHaveBeenCalled();
  });
  it("lists every problem the server finds when a save is refused", async () => {
    h.api.saveProviders.mockRejectedValue(new ApiError(400, "invalid_provider_selection", "Those provider settings cannot be used yet.", ["EXTRACTION_MODEL is required because EXTRACTION_PROVIDER is groq", "Another problem"]));
    ui(); await screen.findByTestId("active-now");
    await userEvent.selectOptions(extraction().getByLabelText("Provider"), "groq");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: /change providers/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/EXTRACTION_MODEL is required.*Another problem/);
  });
  it("offers a way back to the server settings only when something was saved here", async () => {
    ui(); await screen.findByTestId("active-now");
    expect(screen.queryByRole("button", { name: /go back to the server settings/i })).toBeNull();
  });
  it("resets to the server settings after confirmation", async () => {
    h.api.adminProviders.mockResolvedValue(status({ source: "saved" }));
    h.api.resetProviders.mockResolvedValue(status());
    ui(); await screen.findByTestId("active-now");
    await userEvent.click(screen.getByRole("button", { name: /go back to the server settings/i }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: /^go back$/i }));
    await waitFor(() => expect(h.api.resetProviders).toHaveBeenCalled());
    expect(await screen.findByText(/come from the server settings/i)).toBeInTheDocument();
  });
  it("shows a saved settings notice when the server ignored an old choice", async () => {
    h.api.adminProviders.mockResolvedValue(status({ notice: "Saved provider settings were ignored: GEMINI_API_KEY is required" }));
    ui(); expect(await screen.findByRole("alert")).toHaveTextContent(/were ignored/);
  });
  it("tells non admins what to do and offers no retry", async () => {
    h.api.adminProviders.mockRejectedValue(new ApiError(403, "forbidden", "Only admins can change provider settings."));
    ui();
    expect(await screen.findByRole("alert")).toHaveTextContent(/ask an admin to add your user ID to ADMIN_USER_IDS/i);
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
    expect(screen.getByRole("link", { name: /back to dashboard/i })).toHaveAttribute("href", "/dashboard");
  });
  it("shows loading and generic error states", async () => {
    h.api.adminProviders.mockReturnValue(new Promise(() => {}));
    ui(); expect(screen.getByText(/getting provider settings/i)).toBeInTheDocument();
  });
  it("passes an accessibility scan", async () => {
    const { container } = ui(); await screen.findByTestId("active-now");
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(r.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});

const reliability = { breakers: { transcription: { provider: "openai", state: "closed" }, extraction: { provider: "groq", state: "open" } }, backups: { transcription: null, extraction: "gemini" } } as const;
const usageData = { days: 7, limits: { notes: 20, audio_minutes: null }, totals: { calls: 9, failures: 2, fallback_calls: 1, notes: 4, audio_minutes: 6.5, input_tokens: 12345, output_tokens: 678 },
  by_provider: [{ provider: "groq", step: "extraction", calls: 5, failures: 2, fallback_calls: 0, input_tokens: 12000, output_tokens: 600, audio_minutes: 0 }, { provider: "openai", step: "transcription", calls: 4, failures: 0, fallback_calls: 1, input_tokens: 0, output_tokens: 0, audio_minutes: 6.5 }] };
const withReliability = () => h.api.adminProviders.mockResolvedValue(status({ reliability: reliability as never, concurrency: { max: 4, active: 1, queued: 2 }, limits: { notes: 20, audio_minutes: null } }));

describe("Reliability and usage panel", () => {
  it("shows circuit state in plain words, the backups, concurrency and the daily allowance", async () => {
    withReliability(); h.api.adminUsage.mockResolvedValue(usageData);
    ui(); const rel = await screen.findByTestId("reliability");
    expect(rel).toHaveTextContent("OpenAI: Working normally");
    expect(rel).toHaveTextContent("Groq: Paused after repeated errors");
    expect(rel).toHaveTextContent("Task backup"); expect(rel).toHaveTextContent("Google Gemini"); expect(rel).toHaveTextContent("None set");
    expect(rel).toHaveTextContent("1 of 4 at once, 2 waiting"); expect(rel).toHaveTextContent("20 voice notes per person");
  });
  it("shows a recovering circuit", async () => {
    h.api.adminProviders.mockResolvedValue(status({ reliability: { ...reliability, breakers: { ...reliability.breakers, extraction: { provider: "groq", state: "half_open" } } } as never }));
    ui(); expect(await screen.findByTestId("reliability")).toHaveTextContent("Checking whether it has recovered");
  });
  it("shows usage totals and a table by provider", async () => {
    withReliability(); h.api.adminUsage.mockResolvedValue(usageData);
    ui();
    expect(await screen.findByTestId("usage-totals")).toHaveTextContent("4 voice notes, 6.5 minutes of audio. 9 provider calls, 2 failed, 1 on a backup. 12,345 tokens in, 678 tokens out.");
    const table = screen.getByRole("table", { name: /usage by provider/i });
    expect(within(table).getByRole("row", { name: /Groq Task 5 2 0 12000 600 0/ })).toBeInTheDocument();
    expect(within(table).getByRole("row", { name: /OpenAI Speech 4 0 1 0 0 6.5/ })).toBeInTheDocument();
  });
  it("says so when nothing has been processed yet", async () => {
    withReliability(); ui();
    expect(await screen.findByText(/no voice notes have been processed in this period/i)).toBeInTheDocument();
  });
  it("shows a usage error with a way to try again", async () => {
    withReliability(); h.api.adminUsage.mockRejectedValueOnce(new ApiError(503, "database_error", "The database is not responding right now.")).mockResolvedValue(usageData);
    ui();
    const alert = await screen.findByText(/database is not responding right now/i);
    await userEvent.click(within(alert.closest("[role=alert]") as HTMLElement).getByRole("button", { name: /try again/i }));
    expect(await screen.findByTestId("usage-totals")).toBeInTheDocument();
  });
  it("downloads the CSV through an authenticated request and cleans up", async () => {
    withReliability(); h.api.adminUsage.mockResolvedValue(usageData);
    h.api.usageCsv.mockResolvedValue(new Blob(["at,user_id\n"], { type: "text/csv" }));
    const create = vi.fn(() => "blob:csv"), revoke = vi.fn(); Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    ui(); await screen.findByTestId("usage-totals");
    await userEvent.click(screen.getByRole("button", { name: /download usage as csv/i }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(h.api.usageCsv).toHaveBeenCalledWith(30); expect(create).toHaveBeenCalled(); expect(revoke).toHaveBeenCalledWith("blob:csv");
    click.mockRestore();
  });
  it("explains a failed download", async () => {
    withReliability(); h.api.adminUsage.mockResolvedValue(usageData);
    h.api.usageCsv.mockRejectedValue(new ApiError(403, "forbidden", "Only admins can change provider settings."));
    ui(); await screen.findByTestId("usage-totals");
    await userEvent.click(screen.getByRole("button", { name: /download usage as csv/i }));
    expect(await screen.findByText(/only admins can change provider settings/i)).toBeInTheDocument();
  });
  it("passes an accessibility scan with data showing", async () => {
    withReliability(); h.api.adminUsage.mockResolvedValue(usageData);
    const { container } = ui(); await screen.findByTestId("usage-totals");
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(r.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
