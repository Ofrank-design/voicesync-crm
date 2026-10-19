import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";

const h = vi.hoisted(() => ({ api: { exportData: vi.fn(), deleteAccount: vi.fn() }, goHome: vi.fn(), signOut: vi.fn(), authMode: { v: "supabase" } }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: any) => <a href={href} {...p}>{children}</a> }));
vi.mock("@/lib/auth", () => ({ get AUTH_MODE() { return h.authMode.v; }, supabase: () => ({ auth: { signOut: h.signOut } }), getAccessToken: async () => null }));
vi.mock("@/lib/nav", () => ({ goHome: h.goHome }));
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api: h.api }));
import Account from "@/app/(app)/account/page";
import Privacy from "@/app/(site)/privacy/page";
import NotFound from "@/app/not-found";
import ErrorPage from "@/app/error";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { ApiError } from "@/lib/api";

const scan = async (c: HTMLElement) => (await axe.run(c, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } })).violations.map((v) => `${v.id}: ${v.help}`);
beforeEach(() => { for (const f of Object.values(h.api)) f.mockReset(); h.goHome.mockReset(); h.signOut.mockReset(); h.authMode.v = "supabase"; });
afterEach(() => vi.unstubAllEnvs());

describe("Your data page", () => {
  it("downloads the data file through an authenticated request and tidies up", async () => {
    h.api.exportData.mockResolvedValue(new Blob(["{}"], { type: "application/json" }));
    const create = vi.fn(() => "blob:d"), revoke = vi.fn(); Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<Account />);
    await userEvent.click(screen.getByRole("button", { name: /download my data/i }));
    expect(await screen.findByText(/your data was downloaded/i)).toBeInTheDocument();
    expect(click).toHaveBeenCalled(); expect(revoke).toHaveBeenCalledWith("blob:d"); click.mockRestore();
  });
  it("explains a failed download", async () => {
    h.api.exportData.mockRejectedValue(new ApiError(503, "database_error", "The database is not responding right now."));
    render(<Account />); await userEvent.click(screen.getByRole("button", { name: /download my data/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/database is not responding/i);
  });
  it("makes you type DELETE before anything is removed", async () => {
    render(<Account />);
    await userEvent.click(screen.getByRole("button", { name: /delete my account and data/i }));
    const dlg = await screen.findByRole("alertdialog"); const go = within(dlg).getByRole("button", { name: /delete everything/i });
    expect(go).toBeDisabled();
    await userEvent.type(within(dlg).getByLabelText(/type delete to confirm/i), "delete"); expect(go).toBeDisabled();
    await userEvent.clear(within(dlg).getByLabelText(/type delete/i)); await userEvent.type(within(dlg).getByLabelText(/type delete/i), "DELETE"); expect(go).toBeEnabled();
    expect(h.api.deleteAccount).not.toHaveBeenCalled();
  });
  it("deletes, signs out and sends the person to the home page", async () => {
    h.api.deleteAccount.mockResolvedValue({ deleted: { tasks: 3, usage: 5, account: true } });
    render(<Account />);
    await userEvent.click(screen.getByRole("button", { name: /delete my account and data/i }));
    await userEvent.type(await screen.findByLabelText(/type delete to confirm/i), "DELETE");
    await userEvent.click(screen.getByRole("button", { name: /delete everything/i }));
    await waitFor(() => expect(h.goHome).toHaveBeenCalled()); expect(h.signOut).toHaveBeenCalled();
  });
  it("does not try to sign out in local mode", async () => {
    h.authMode.v = "local"; h.api.deleteAccount.mockResolvedValue({ deleted: { tasks: 0, usage: 0, account: false } });
    render(<Account />); await userEvent.click(screen.getByRole("button", { name: /delete my account and data/i }));
    await userEvent.type(await screen.findByLabelText(/type delete to confirm/i), "DELETE"); await userEvent.click(screen.getByRole("button", { name: /delete everything/i }));
    await waitFor(() => expect(h.goHome).toHaveBeenCalled()); expect(h.signOut).not.toHaveBeenCalled();
  });
  it("shows the server's honest message if the login could not be removed, and stays put", async () => {
    h.api.deleteAccount.mockRejectedValue(new ApiError(502, "account_not_removed", "Your tasks and usage records were deleted, but we could not remove your login."));
    render(<Account />); await userEvent.click(screen.getByRole("button", { name: /delete my account and data/i }));
    await userEvent.type(await screen.findByLabelText(/type delete to confirm/i), "DELETE"); await userEvent.click(screen.getByRole("button", { name: /delete everything/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/tasks and usage records were deleted/); expect(h.goHome).not.toHaveBeenCalled();
  });
  it("cancel closes the dialog and Escape too", async () => {
    render(<Account />); await userEvent.click(screen.getByRole("button", { name: /delete my account and data/i }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: /cancel/i })); expect(screen.queryByRole("alertdialog")).toBeNull();
  });
  it("passes an accessibility scan, with the dialog open", async () => {
    const { container } = render(<Account />); await userEvent.click(screen.getByRole("button", { name: /delete my account and data/i })); await screen.findByRole("alertdialog");
    expect(await scan(container)).toEqual([]);
  });
});

describe("Privacy page", () => {
  it("says what happens to recordings, text and tasks, and links to the data page", () => {
    render(<Privacy />);
    expect(screen.getByRole("heading", { level: 1, name: "Privacy" })).toBeInTheDocument();
    expect(screen.getByText(/audio recordings are never stored/i)).toBeInTheDocument();
    expect(screen.getByText(/only you\. every account sees only its own tasks/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /download or delete your data/i })).toHaveAttribute("href", "/account");
  });
  it("shows a contact address only when one is configured", () => {
    const { unmount } = render(<Privacy />); expect(screen.queryByText(/questions\?/i)).toBeNull(); unmount();
    vi.stubEnv("NEXT_PUBLIC_CONTACT_EMAIL", "privacy@example.com"); render(<Privacy />);
    expect(screen.getByRole("link", { name: "privacy@example.com" })).toHaveAttribute("href", "mailto:privacy@example.com");
  });
  it("has no hyphens or dashes in its visible text, and passes an accessibility scan", async () => {
    const { container } = render(<Privacy />);
    expect(container.textContent).not.toMatch(/[-\u2013\u2014]/); expect(await scan(container)).toEqual([]);
  });
});

describe("error and missing pages", () => {
  it("not found offers a way home", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { name: /could not find that page/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /home page/i })).toHaveAttribute("href", "/"); expect(screen.getByRole("link", { name: /dashboard/i })).toHaveAttribute("href", "/dashboard");
  });
  it("the error page reassures, offers a retry, and does not show technical details", async () => {
    const reset = vi.fn(); render(<ErrorPage error={Object.assign(new Error("secret stack detail"), { digest: "abc" })} reset={reset} />);
    expect(screen.getByText(/your tasks are safe/i)).toBeInTheDocument(); expect(document.body.textContent).not.toMatch(/secret stack detail|abc/);
    await userEvent.click(screen.getByRole("button", { name: /try again/i })); expect(reset).toHaveBeenCalled();
  });
});

describe("search engine files", () => {
  it("robots allows the public pages and keeps the app and API out", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.example.com");
    const r = robots() as any; const rule = r.rules[0];
    expect(rule.allow).toEqual(["/", "/privacy"]); expect(rule.disallow).toEqual(expect.arrayContaining(["/dashboard", "/settings", "/account", "/tasks", "/login", "/api"]));
    expect(r.sitemap).toMatch(/\/sitemap\.xml$/);
  });
  it("sitemap lists only public pages", () => { const urls = sitemap().map((s) => new URL(s.url).pathname); expect(urls).toEqual(["/", "/privacy"]); });
});

describe("security headers the app ships", () => {
  const load = async (env: Record<string, string>) => {
    vi.resetModules(); for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const cfg = (await import("../next.config")).default; const h = (await cfg.headers!())[0]!.headers;
    return Object.fromEntries(h.map((x) => [x.key, x.value]));
  };
  it("production gets a content policy that only allows the page, the API and Supabase", async () => {
    const hd = await load({ NODE_ENV: "production", NEXT_PUBLIC_API_BASE_URL: "https://api.example.com", NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", NEXT_PUBLIC_SITE_URL: "https://app.example.com" });
    const csp = hd["Content-Security-Policy"]!;
    expect(csp).toContain("frame-ancestors 'none'"); expect(csp).toContain("object-src 'none'"); expect(csp).toContain("default-src 'self'");
    expect(csp).toMatch(/connect-src 'self' https:\/\/api\.example\.com https:\/\/abc\.supabase\.co wss:\/\/abc\.supabase\.co/);
    expect(csp).not.toContain("unsafe-eval"); expect(csp).toContain("upgrade-insecure-requests"); expect(csp).toContain("media-src 'self' blob:");
    expect(hd["Strict-Transport-Security"]).toMatch(/max-age=63072000/);
    expect(hd["Permissions-Policy"]).toContain("microphone=(self)"); expect(hd["Permissions-Policy"]).toContain("camera=()");
    expect(hd["X-Frame-Options"]).toBe("DENY"); expect(hd["X-Content-Type-Options"]).toBe("nosniff"); expect(hd["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });
  it("plain http setups do not get HSTS or forced upgrades that would break localhost", async () => {
    const hd = await load({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "http://localhost:3000" });
    expect(hd["Strict-Transport-Security"]).toBeUndefined(); expect(hd["Content-Security-Policy"]).not.toContain("upgrade-insecure-requests");
  });
  it("development skips the policy so hot reload works, but keeps the other headers", async () => {
    const hd = await load({ NODE_ENV: "development" }); expect(hd["Content-Security-Policy"]).toBeUndefined(); expect(hd["X-Frame-Options"]).toBe("DENY");
  });
});

describe("production build guard", () => {
  const load = async (env: Record<string, string>) => { vi.resetModules(); for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v); return import("../next.config"); };
  it("refuses to build a production app with the no sign in mode on", async () => {
    await expect(load({ NODE_ENV: "production", NEXT_PUBLIC_AUTH_MODE: "local", VOICESYNC_ALLOW_LOCAL_BUILD: "" })).rejects.toThrow(/development only/);
  });
  it("allows it for the browser test build, and never complains about a normal build or development", async () => {
    await expect(load({ NODE_ENV: "production", NEXT_PUBLIC_AUTH_MODE: "local", VOICESYNC_ALLOW_LOCAL_BUILD: "1" })).resolves.toBeTruthy();
    await expect(load({ NODE_ENV: "production", NEXT_PUBLIC_AUTH_MODE: "supabase", VOICESYNC_ALLOW_LOCAL_BUILD: "" })).resolves.toBeTruthy();
    await expect(load({ NODE_ENV: "development", NEXT_PUBLIC_AUTH_MODE: "local", VOICESYNC_ALLOW_LOCAL_BUILD: "" })).resolves.toBeTruthy();
  });
});
