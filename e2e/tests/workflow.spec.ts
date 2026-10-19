import { test, expect, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

/**
 * Opens the dashboard, records a short voice note, previews it,
 * and submits it for processing.
 */
async function recordAndSubmit(
  page: Page,
  seconds = 2
): Promise<void> {
  await page.context().grantPermissions(["microphone"]);

  // The homepage contains a Start Recording link, not the recording
  // controls. Open the dashboard before looking for the record button.
  await page.goto("/dashboard", {
    waitUntil: "domcontentloaded",
  });

  await expect(page.locator("body")).toBeVisible({
    timeout: 15000,
  });

  const recordButton = page.getByRole("button", {
    name: /record voice note/i,
  });

  await expect(recordButton).toBeVisible({
    timeout: 20000,
  });

  await recordButton.click();

  const stopButton = page.getByRole("button", {
    name: "Stop",
    exact: true,
  });

  await expect(stopButton).toBeVisible({
    timeout: 15000,
  });

  await page.waitForTimeout(seconds * 1000);

  await stopButton.click();

  const preview = page.getByLabel(/recording preview/i);

  await expect(preview).toBeVisible({
    timeout: 15000,
  });

  const sendButton = page.getByRole("button", {
    name: /send note/i,
  });

  await expect(sendButton).toBeVisible({
    timeout: 15000,
  });

  await sendButton.click();
}

test("full workflow: record, review, edit, save and reload", async ({
  page,
}) => {
  test.setTimeout(120000);

  const pageErrors: string[] = [];

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await recordAndSubmit(page);

  // Wait for the expected transcription or extracted CRM information.
  await expect(page.getByText(/Daniel/i).first()).toBeVisible({
    timeout: 30000,
  });

  await expect(page.getByText(/East Legon/i).first()).toBeVisible({
    timeout: 15000,
  });

  const form = page.locator("form").first();

  await expect(form).toBeVisible({
    timeout: 15000,
  });

  const clientField = form.getByLabel(/client/i);

  if (await clientField.count()) {
    await clientField.fill("Daniel Mensah");
  }

  const followUpDate = form.getByLabel(/follow up date/i);

  if (await followUpDate.count()) {
    const dateValue = await followUpDate.inputValue();

    if (dateValue !== "") {
      expect(dateValue).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  }

  const saveButton = page.getByRole("button", {
    name: /save/i,
  }).first();

  await expect(saveButton).toBeVisible({
    timeout: 15000,
  });

  await saveButton.click();

  await expect(page.getByText(/Daniel Mensah/i).first()).toBeVisible({
    timeout: 20000,
  });

  // Confirm the page remains usable after reloading.
  await page.reload({
    waitUntil: "domcontentloaded",
  });

  await expect(page.locator("body")).toBeVisible({
    timeout: 15000,
  });

  expect(pageErrors).toEqual([]);
});

test("discarding a review returns to a usable page", async ({
  page,
}) => {
  test.setTimeout(90000);

  await recordAndSubmit(page);

  const discardButton = page.getByRole("button", {
    name: /discard|cancel/i,
  }).first();

  await expect(discardButton).toBeVisible({
    timeout: 30000,
  });

  await discardButton.click();

  await expect(page.locator("body")).toBeVisible({
    timeout: 15000,
  });
});

test("mobile layout is usable at 390 pixels", async ({ page }) => {
  test.setTimeout(45000);

  await page.setViewportSize({
    width: 390,
    height: 844,
  });

  await page.goto("/dashboard", {
    waitUntil: "domcontentloaded",
  });

  await expect(page.locator("body")).toBeVisible({
    timeout: 15000,
  });

  const documentWidth = await page.evaluate(
    () => document.documentElement.scrollWidth
  );

  expect(documentWidth).toBeLessThanOrEqual(390);
});

test("landing page loads and fits a phone screen", async ({
  page,
}) => {
  test.setTimeout(45000);

  await page.setViewportSize({
    width: 390,
    height: 844,
  });

  await page.goto("/", {
    waitUntil: "domcontentloaded",
  });

  await expect(page.locator("body")).toBeVisible({
    timeout: 15000,
  });

  await expect(
    page.getByRole("heading", { level: 1 }).first()
  ).toBeVisible({
    timeout: 15000,
  });

  const favicon = page.locator(
    'link[rel="icon"], link[rel="shortcut icon"]'
  );

  expect(await favicon.count()).toBeGreaterThan(0);

  const documentWidth = await page.evaluate(
    () => document.documentElement.scrollWidth
  );

  expect(documentWidth).toBeLessThanOrEqual(390);
});
