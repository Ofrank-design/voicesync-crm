import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeApp, bearer, WEBM, AppError } from "./helpers";

describe("POST /api/voice-sync", () => {
  it("returns transcript and a validated draft awaiting review", async () => {
    const { app } = makeApp();
    const r = await request(app).post("/api/voice-sync").set(bearer()).field("timezone", "Africa/Accra").field("reference_date", "2026-10-14")
      .attach("audio", WEBM, { filename: "a.webm", contentType: "audio/webm" });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("awaiting_review");
    expect(r.body.task.client_name).toBe("Daniel");
    expect(r.body.request_id).toBeTruthy();
    expect(r.body.reference_date).toBe("2026-10-14");
  });
  it("requires authentication", async () => {
    const { app } = makeApp();
    expect((await request(app).post("/api/voice-sync").attach("audio", WEBM, "a.webm")).status).toBe(401);
    expect((await request(app).post("/api/voice-sync").set(bearer("bad")).attach("audio", WEBM, "a.webm")).status).toBe(401);
  });
  it("rejects a missing file", async () => {
    const { app } = makeApp();
    const r = await request(app).post("/api/voice-sync").set(bearer()).field("timezone", "UTC");
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("empty_audio");
  });
  it("rejects an empty file", async () => {
    const { app } = makeApp();
    const r = await request(app).post("/api/voice-sync").set(bearer()).attach("audio", Buffer.alloc(0), "a.webm");
    expect(r.status).toBe(400);
  });
  it("rejects unsupported/corrupt audio even if the MIME type claims audio", async () => {
    const { app } = makeApp();
    const r = await request(app).post("/api/voice-sync").set(bearer()).attach("audio", Buffer.from("this is not audio at all, just text"), { filename: "a.webm", contentType: "audio/webm" });
    expect(r.status).toBe(415);
    expect(r.body.error.code).toBe("unsupported_audio");
  });
  it("enforces the file size limit", async () => {
    const { app } = makeApp();
    const big = Buffer.concat([WEBM, Buffer.alloc(1.2 * 1024 * 1024)]);
    const r = await request(app).post("/api/voice-sync").set(bearer()).attach("audio", big, "a.webm");
    expect(r.status).toBe(413);
    expect(r.body.error.code).toBe("file_too_large");
  });
  it("enforces the duration limit", async () => {
    const { app } = makeApp();
    const r = await request(app).post("/api/voice-sync").set(bearer()).field("duration_seconds", "62").attach("audio", WEBM, "a.webm");
    expect(r.status).toBe(413);
    expect(r.body.error.code).toBe("recording_too_long");
  });
  it("maps transcription failures to safe errors", async () => {
    const { app } = makeApp({ transcriber: { transcribe: async () => { throw new AppError(502, "transcription_unavailable", "The transcription service is temporarily unavailable."); } } });
    const r = await request(app).post("/api/voice-sync").set(bearer()).attach("audio", WEBM, "a.webm");
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.body)).not.toMatch(/stack|sk-/);
  });
  it("hides unexpected internal errors", async () => {
    const { app } = makeApp({ extractor: { extract: async () => { throw new Error("secret-internal-detail"); } } });
    const r = await request(app).post("/api/voice-sync").set(bearer()).attach("audio", WEBM, "a.webm");
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("secret-internal-detail");
  });
  it("blocks a second concurrent submission from the same user", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { app } = makeApp({ transcriber: { transcribe: async () => { await gate; return "hello"; } } });
    const first = request(app).post("/api/voice-sync").set(bearer()).attach("audio", WEBM, "a.webm").then((r) => r);
    await new Promise((r) => setTimeout(r, 150));
    const second = await request(app).post("/api/voice-sync").set(bearer()).attach("audio", WEBM, "a.webm");
    expect(second.status).toBe(409);
    release();
    expect((await first).status).toBe(200);
  });
});
