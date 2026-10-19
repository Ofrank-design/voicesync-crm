import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeApp, bearer, WEBM, AppError } from "./helpers";
import { probeDuration } from "../src/lib/duration";

function wav(seconds: number, rate = 8000): Buffer {
  const data = Buffer.alloc(Math.floor(seconds * rate)); // 8-bit mono
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate, 28);
  h.writeUInt16LE(1, 32); h.writeUInt16LE(8, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
const parseNdjson = (t: string) => t.trim().split("\n").map((l) => JSON.parse(l));

describe("server-side duration enforcement", () => {
  it("measures a real WAV file", async () => {
    const d = await probeDuration(wav(3), "audio/wav");
    expect(d).toBeGreaterThan(2.9); expect(d).toBeLessThan(3.1);
  });
  it("returns undefined for audio without readable metadata", async () => { expect(await probeDuration(WEBM, "audio/webm")).toBeUndefined(); });
  it("rejects a recording longer than the limit even if the client reports a short one", async () => {
    const { app } = makeApp(); // limit is 60s
    const r = await request(app).post("/api/voice-sync").set(bearer()).field("duration_seconds", "5").attach("audio", wav(75), { filename: "a.wav", contentType: "audio/wav" });
    expect(r.status).toBe(413); expect(r.body.error.code).toBe("recording_too_long");
  });
  it("accepts a recording within the limit", async () => {
    const { app } = makeApp();
    const r = await request(app).post("/api/voice-sync").set(bearer()).attach("audio", wav(10), { filename: "a.wav", contentType: "audio/wav" });
    expect(r.status).toBe(200);
  });
});

describe("progress streaming (X-Progress: stream)", () => {
  it("emits transcribing, extracting, then done with the full result", async () => {
    const { app } = makeApp();
    const r = await request(app).post("/api/voice-sync").set(bearer()).set("X-Progress", "stream").buffer(true).parse((res, cb) => { let d = ""; res.on("data", (c: Buffer) => (d += c)); res.on("end", () => cb(null, d)); }).attach("audio", WEBM, "a.webm");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/ndjson/);
    const ev = parseNdjson(r.body as string);
    expect(ev.map((e) => e.stage)).toEqual(["transcribing", "extracting", "done"]);
    expect(ev[2].result.status).toBe("awaiting_review");
    expect(ev[2].result.task.client_name).toBe("Daniel");
  });
  it("reports a failure inside the stream and never leaks internals", async () => {
    const { app } = makeApp({ extractor: { extract: async () => { throw new Error("secret-internal"); } } });
    const r = await request(app).post("/api/voice-sync").set(bearer()).set("X-Progress", "stream").buffer(true).parse((res, cb) => { let d = ""; res.on("data", (c: Buffer) => (d += c)); res.on("end", () => cb(null, d)); }).attach("audio", WEBM, "a.webm");
    const ev = parseNdjson(r.body as string);
    expect(ev.map((e) => e.stage)).toEqual(["transcribing", "extracting", "error"]);
    expect(ev[2].error.code).toBe("internal_error");
    expect(r.body).not.toContain("secret-internal");
  });
  it("reports a known upstream error code in the stream", async () => {
    const { app } = makeApp({ transcriber: { transcribe: async () => { throw new AppError(422, "empty_transcript", "No speech was detected in the recording."); } } });
    const r = await request(app).post("/api/voice-sync").set(bearer()).set("X-Progress", "stream").buffer(true).parse((res, cb) => { let d = ""; res.on("data", (c: Buffer) => (d += c)); res.on("end", () => cb(null, d)); }).attach("audio", WEBM, "a.webm");
    const ev = parseNdjson(r.body as string);
    expect(ev.at(-1)).toMatchObject({ stage: "error", error: { code: "empty_transcript" } });
  });
  it("still returns normal JSON errors for validation failures before streaming starts", async () => {
    const { app } = makeApp();
    const r = await request(app).post("/api/voice-sync").set(bearer()).set("X-Progress", "stream").attach("audio", Buffer.from("not audio at all, definitely"), "a.webm");
    expect(r.status).toBe(415);
  });
});
