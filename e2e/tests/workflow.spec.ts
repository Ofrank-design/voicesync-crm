import { test, expect, type Page } from "@playwright/test";

const API = process.env.API_URL ?? "http://localhost:8000";

async function recordAndSubmit(page: Page, seconds = 2) {
  await page.getByRole("button", { name: /record voice note/i }).click();
  await expect(page.getByRole("button", { name: /^stop$/i })).toBeVisible();   // mic permission granted by the fake device
  await page.waitForTimeout(seconds * 1000);
  await page.getByRole("button", { name: /^stop$/i }).click();
  await expect(page.getByLabel(/recording preview/i)).toBeVisible();
  await page.getByRole("button", { name: /send note/i }).click();
}

test.describe.configure({ mode: "serial" });

test("full workflow: record -> transcript -> review/edit -> save -> board -> status -> reload -> isolation", async ({ page, request }) => {
  // The content security policy must not break a real session: no console errors or blocked resources anywhere in this flow.
  const problems: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(String(e)));
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "VoiceSync CRM" })).toBeVisible();
  await expect(page.getByText(/no tasks yet/i)).toBeVisible();
  await expect(page.getByTestId("metric-Open tasks")).toHaveText("0");
  await page.screenshot({ path: "test-results/01-dashboard-empty.png", fullPage: true });

  // 1-3. real MediaRecorder -> real upload -> transcript + validated task draft
  await recordAndSubmit(page);
  const form = page.getByRole("form", { name: /review extracted task/i });
  await expect(form).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("transcript")).toContainText("Call Daniel in East Legon on Friday");
  await expect(form.getByLabel(/client name/i)).toHaveValue("Daniel");
  await expect(form.getByLabel(/location/i)).toHaveValue("East Legon");
  await expect(page.getByRole("list", { name: /warnings/i })).toContainText(/set to Friday \d{1,2} \w+ \d{4}/);
  const resolved = await form.getByLabel(/follow up date/i).inputValue();
  expect(resolved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(new Date(resolved + "T00:00:00Z").getUTCDay()).toBe(5);
  await expect(page.getByRole("list", { name: /progress/i })).toContainText(/awaiting review/i);
  await page.screenshot({ path: "test-results/02-review.png", fullPage: true });

  // nothing is saved before confirmation
  expect((await (await request.get(`${API}/api/tasks`, { headers: { Authorization: "Bearer browser-user" } })).json()).total).toBe(0);

  // 4-5. correct a field, set priority, save
  await form.getByLabel(/client name/i).fill("Daniel Mensah");
  await form.getByLabel("Priority").selectOption("high");
  await form.getByRole("button", { name: /save task/i }).click();
  await expect(page.getByText(/task saved/i)).toBeVisible();

  // 6. appears in To Do with the corrected values, metrics from persisted records
  const card = page.getByRole("article", { name: /Daniel Mensah/ });
  await expect(card).toBeVisible();
  await expect(page.getByRole("region", { name: /^To Do/ }).getByRole("article")).toHaveCount(1);
  await expect(card).toContainText("East Legon");
  await expect(card).toContainText(/high/i);
  await expect(page.getByTestId("metric-Open tasks")).toHaveText("1");
  await expect(page.getByTestId("metric-High priority")).toHaveText("1");

  // 7. change status with the accessible select control
  await card.getByLabel(/status for daniel mensah/i).selectOption("in_progress");
  await expect(page.getByRole("region", { name: /^In Progress/ }).getByRole("article")).toHaveCount(1);
  await page.screenshot({ path: "test-results/03-board.png", fullPage: true });

  // 8. reload: change persists
  await page.reload();
  await expect(page.getByRole("region", { name: /^In Progress/ }).getByRole("article", { name: /Daniel Mensah/ })).toBeVisible();
  await expect(page.getByRole("region", { name: /^To Do/ }).getByRole("article")).toHaveCount(0);

  // details page: edit link, full task, back link
  await page.getByRole("link", { name: /edit daniel mensah/i }).click();
  await expect(page.getByRole("heading", { name: "Daniel Mensah" })).toBeVisible();
  await expect(page.getByText(/Call Daniel in East Legon on Friday/)).toBeVisible();
  await page.screenshot({ path: "test-results/04-details.png", fullPage: true });
  await page.getByRole("link", { name: /back to dashboard/i }).click();
  await expect(page.getByRole("article", { name: /Daniel Mensah/ })).toBeVisible();

  // 9. another user cannot see or touch it
  const mine = await (await request.get(`${API}/api/tasks`, { headers: { Authorization: "Bearer browser-user" } })).json();
  expect(mine.total).toBe(1);
  const id = mine.items[0].id;
  const other = { Authorization: "Bearer someone-else" };
  expect((await (await request.get(`${API}/api/tasks`, { headers: other })).json()).total).toBe(0);
  expect((await request.get(`${API}/api/tasks/${id}`, { headers: other })).status()).toBe(404);
  expect((await request.patch(`${API}/api/tasks/${id}`, { headers: other, data: { status: "completed" } })).status()).toBe(404);
  expect((await request.delete(`${API}/api/tasks/${id}`, { headers: other })).status()).toBe(404);
  expect(problems).toEqual([]);
});

test("discarding a review saves nothing, and delete needs confirmation", async ({ page, request }) => {
  const before = (await (await request.get(`${API}/api/tasks`, { headers: { Authorization: "Bearer browser-user" } })).json()).total;
  await page.goto("/dashboard");
  await recordAndSubmit(page, 1);
  await expect(page.getByRole("form", { name: /review extracted task/i })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /discard/i }).click();
  await expect(page.getByRole("form", { name: /review/i })).toHaveCount(0);
  expect((await (await request.get(`${API}/api/tasks`, { headers: { Authorization: "Bearer browser-user" } })).json()).total).toBe(before);

  await page.getByRole("link", { name: /edit daniel mensah/i }).first().click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: /^cancel$/i }).click();
  await expect(page.getByRole("heading", { name: "Daniel Mensah" })).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: /delete task/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect((await (await request.get(`${API}/api/tasks`, { headers: { Authorization: "Bearer browser-user" } })).json()).total).toBe(before - 1);
});

test("mobile layout is usable (390px)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: /record voice note/i })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  await page.screenshot({ path: "test-results/05-mobile.png", fullPage: true });
  await ctx.close();
});

test("landing page: real images load, tab icon is wired up, and it fits a phone", async ({ page, request, browser }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Turn Your Voice");
  for (const sel of ['link[rel="icon"][href="/favicon.ico"]', 'link[rel="icon"][href="/icon.png"]', 'link[rel="apple-touch-icon"]', 'meta[property="og:image"]']) {
    await expect(page.locator(sel).first()).toHaveCount(1);
  }
  for (const path of ["/favicon.ico", "/icon.png", "/apple-touch-icon.png", "/logo.png", "/logo-dark-text.png", "/images/hero-bg.jpg", "/images/footer-wave.jpg", "/images/hero-mobile.jpg", "/images/og.jpg"]) expect((await request.get(path)).status(), path).toBe(200);
  const broken = await page.evaluate(() => [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src));
  expect(broken).toEqual([]);
  await page.screenshot({ path: "test-results/06-landing.png", fullPage: true });
  await page.getByRole("link", { name: "Get started" }).first().click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const m = await ctx.newPage(); await m.goto("/");
  expect(await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await m.screenshot({ path: "test-results/07-landing-mobile.png", fullPage: true });
  await ctx.close();
});

test("provider settings: an admin can test, save and see the change on the next voice note", async ({ page, request }) => {
  await page.goto("/dashboard");
  await page.getByRole("link", { name: /provider settings/i }).click();
  await expect(page.getByRole("heading", { name: "Provider settings" })).toBeVisible();
  await expect(page.getByTestId("active-now")).toContainText("Speech to text: OpenAI. Text to task: Anthropic.");
  await expect(page.getByLabel(/api key|secret|token/i)).toHaveCount(0);
  await page.screenshot({ path: "test-results/08-settings.png", fullPage: true });

  const extraction = page.getByRole("group", { name: /text to task/i });
  await extraction.getByLabel("Provider").selectOption("groq");
  await extraction.getByLabel("Model").fill("llm-model");
  await extraction.getByRole("button", { name: /test connection/i }).click();
  await expect(extraction.getByRole("status")).toContainText(/It works with Groq/);
  await page.getByRole("button", { name: /save changes/i }).click();
  await expect(page.getByRole("alertdialog")).toContainText("This changes who processes your users");
  await page.getByRole("button", { name: /change providers/i }).click();
  await expect(page.getByText(/new voice notes will use these providers/i)).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("active-now")).toContainText("Text to task: Groq");
  await expect(page.getByText(/set in this screen/i)).toBeVisible();

  // the next voice note says who handled it
  await page.goto("/dashboard");
  await recordAndSubmit(page, 1);
  await expect(page.getByTestId("processed-by")).toHaveText("Written out by OpenAI. Details picked out by Groq.", { timeout: 20_000 });
  await page.getByRole("button", { name: /discard/i }).click();

  // everyone else is locked out, and the key is never in any response
  expect((await request.get(`${API}/api/admin/providers`, { headers: { Authorization: "Bearer someone-else" } })).status()).toBe(403);
  const body = await (await request.get(`${API}/api/admin/providers`, { headers: { Authorization: "Bearer browser-user" } })).text();
  expect(body).not.toContain("e2e-secret");

  // put it back
  await page.goto("/settings");
  await page.getByRole("button", { name: /go back to the server settings/i }).click();
  await page.getByRole("button", { name: /^go back$/i }).click();
  await expect(page.getByTestId("active-now")).toContainText("Text to task: Anthropic");
});

test("reliability and usage: allowance on the dashboard, circuit state and usage for admins, CSV download", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByTestId("allowance")).toContainText(/Today: \d+ of 50 voice notes\. The count starts again at midnight UTC\./);
  await page.getByRole("link", { name: /provider settings/i }).click();
  await expect(page.getByTestId("reliability")).toContainText("Working normally");
  await expect(page.getByTestId("reliability")).toContainText("50 voice notes per person");
  await expect(page.getByTestId("usage-totals")).toContainText(/\d+ voice notes, .* provider calls, 0 failed, 0 on a backup\./);
  await expect(page.getByRole("table", { name: /usage by provider/i })).toBeVisible();
  await page.screenshot({ path: "test-results/09-reliability.png", fullPage: true });

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /download usage as csv/i }).click()]);
  expect(download.suggestedFilename()).toBe("voicesync-usage.csv");
  const fs = await import("node:fs"); const text = fs.readFileSync(await download.path()!, "utf8");
  expect(text.split("\n")[0]).toBe("at,user_id,request_id,step,provider,model,ok,error_code,audio_seconds,input_tokens,output_tokens,fallback,duration_ms");
  expect(text.trim().split("\n").length).toBeGreaterThan(2);
  expect(text).not.toMatch(/Daniel|e2e-secret/);
});

test("security headers, discoverability and friendly errors", async ({ page, request }) => {
  const home = await request.get("/");
  const h = home.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'"); expect(h["content-security-policy"]).toContain("object-src 'none'");
  expect(h["content-security-policy"]).not.toContain("unsafe-eval");
  expect(h["x-frame-options"]).toBe("DENY"); expect(h["x-content-type-options"]).toBe("nosniff"); expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["permissions-policy"]).toContain("microphone=(self)"); expect(h["x-powered-by"]).toBeUndefined();

  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toMatch(/Disallow: \/dashboard/); expect(robots).toMatch(/Disallow: \/api/); expect(robots).toMatch(/Sitemap: .*\/sitemap\.xml/);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("/privacy"); expect(sitemap).not.toContain("/dashboard");

  const missing = await page.goto("/this-page-does-not-exist");
  expect(missing!.status()).toBe(404);
  await expect(page.getByRole("heading", { name: /could not find that page/i })).toBeVisible();
  await page.screenshot({ path: "test-results/10-not-found.png" });

  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
  await expect(page.getByText(/audio recordings are never stored/i)).toBeVisible();

  // the API: standard protections, readiness, and no cross origin access for strangers
  const live = await request.get(`${API}/api/live`); expect(live.status()).toBe(200);
  expect(live.headers()["x-content-type-options"]).toBe("nosniff"); expect(live.headers()["x-powered-by"]).toBeUndefined(); expect(live.headers()["x-request-id"]).toBeTruthy();
  expect((await request.get(`${API}/api/ready`)).status()).toBe(200);
  const evil = await request.fetch(`${API}/api/tasks`, { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "GET" } });
  expect(evil.headers()["access-control-allow-origin"]).not.toBe("https://evil.example");
  expect((await request.get(`${API}/metrics`)).status()).toBe(404);   // off unless a token is configured
});

test("your data: download everything, then delete it all", async ({ page, request }) => {
  const auth = { Authorization: "Bearer browser-user" };
  const made = await request.post(`${API}/api/tasks`, { headers: auth, data: { client_name: "Ama Boateng", location: "Osu", action_item: "Send the invoice", follow_up_date: "", priority: "low" } });
  expect(made.status()).toBe(201);
  await page.goto("/dashboard");
  await page.getByRole("link", { name: /your data/i }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your data" })).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /download my data/i }).click()]);
  expect(download.suggestedFilename()).toBe("voicesync-my-data.json");
  const fs = await import("node:fs"); const data = JSON.parse(fs.readFileSync(await download.path()!, "utf8"));
  expect(data.user_id).toBe("browser-user"); expect(data.tasks.map((t: any) => t.client_name)).toContain("Ama Boateng"); expect(JSON.stringify(data)).not.toContain("e2e-secret");

  await page.getByRole("button", { name: /delete my account and data/i }).click();
  const confirm = page.getByRole("button", { name: /delete everything/i });
  await expect(confirm).toBeDisabled();
  await page.getByLabel(/type delete to confirm/i).fill("DELETE");
  await Promise.all([page.waitForURL(/\/$/), confirm.click()]);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Turn Your Voice");

  const after = await (await request.get(`${API}/api/me/export`, { headers: auth })).json();
  expect(after.tasks).toEqual([]); expect(after.usage).toEqual([]);
});
