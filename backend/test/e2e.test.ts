import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeApp, bearer, WEBM } from "./helpers";

// Full workflow against the real Express app with mocked Whisper/Claude and an in-memory repository.
describe("end-to-end workflow", () => {
  it("record -> transcribe -> extract -> correct -> save -> board -> status change -> reload -> isolation", async () => {
    const { app } = makeApp();
    const a = bearer("user-a"), b = bearer("user-b");

    const draft = await request(app).post("/api/voice-sync").set(a).field("timezone", "Africa/Accra").field("reference_date", "2026-10-14").attach("audio", WEBM, { filename: "recording.webm", contentType: "audio/webm" });
    expect(draft.status).toBe(200);
    expect(draft.body.transcript).toMatch(/Daniel/);

    const corrected = { ...draft.body.task, client_name: "Daniel Mensah", priority: "high" };
    const saved = await request(app).post("/api/tasks").set(a).set("Idempotency-Key", "e2e-1").send({ ...corrected, transcript: draft.body.transcript });
    expect(saved.status).toBe(201);
    const id = saved.body.task.id;

    const board = await request(app).get("/api/tasks?status=todo").set(a);
    expect(board.body.items.map((t: any) => t.client_name)).toContain("Daniel Mensah");

    await request(app).patch(`/api/tasks/${id}`).set(a).send({ status: "in_progress" }).expect(200);
    const reloaded = await request(app).get("/api/tasks").set(a); // "page reload"
    expect(reloaded.body.items.find((t: any) => t.id === id).status).toBe("in_progress");

    expect((await request(app).get("/api/tasks").set(b)).body.total).toBe(0);
    expect((await request(app).get(`/api/tasks/${id}`).set(b)).status).toBe(404);
  });
});
