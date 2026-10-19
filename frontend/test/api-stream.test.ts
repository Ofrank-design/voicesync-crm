import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseProgressStream, uploadVoiceNote, type ApiError } from "@/lib/api";

vi.mock("@/lib/auth", () => ({ getAccessToken: async () => "tok", AUTH_MODE: "supabase" }));

const result = { request_id: "r", transcript: "t", task: { client_name: "D", location: "", action_item: "A", follow_up_date: "", priority: "medium" }, status: "awaiting_review", reference_date: "2026-10-14", timezone: "UTC", warnings: [] };

describe("parseProgressStream", () => {
  const collect = () => { const ev: any[] = []; return { ev, on: { stage: (s: any) => ev.push(s), done: (r: any) => ev.push(["done", r]), error: (e: ApiError) => ev.push(["error", e.code]) } }; };
  it("parses complete lines and keeps a partial trailing line for later", () => {
    const { ev, on } = collect();
    const text = '{"stage":"transcribing"}\n{"stage":"extracting"}\n{"stage":"do';
    const used = parseProgressStream(text, 0, on);
    expect(ev).toEqual(["transcribing", "extracting"]);
    const full = text + `ne","result":${JSON.stringify(result)}}\n`;
    parseProgressStream(full, used, on);
    expect(ev[2]).toEqual(["done", result]);
  });
  it("maps stream errors and ignores garbage lines", () => {
    const { ev, on } = collect();
    parseProgressStream('garbage\n{"stage":"error","error":{"code":"empty_transcript","message":"No speech"}}\n', 0, on);
    expect(ev).toEqual([["error", "empty_transcript"]]);
  });
});

class FakeXHR {
  static last: FakeXHR; status = 0; responseText = ""; timeout = 0; headers: Record<string, string> = {};
  upload: any = {}; onload: any; onerror: any; ontimeout: any; onabort: any; onprogress: any;
  open() { FakeXHR.last = this; } setRequestHeader(k: string, v: string) { this.headers[k] = v; } send() {} abort() { this.onabort?.(); }
  respond(status: number, text: string) { this.status = status; this.responseText = text; this.onload?.(); }
}
beforeEach(() => vi.stubGlobal("XMLHttpRequest", FakeXHR));
afterEach(() => vi.unstubAllGlobals());
const upload = (signal = new AbortController().signal, cb = { onUpload: vi.fn(), onStage: vi.fn() }) => ({ cb, p: uploadVoiceNote(new Blob(["x"], { type: "audio/webm" }), { durationSeconds: 3, timezone: "UTC", referenceDate: "2026-10-14" }, cb, signal) });

describe("uploadVoiceNote", () => {
  it("sends auth + stream headers and resolves with the final result", async () => {
    const { p, cb } = upload();
    await Promise.resolve();
    const x = FakeXHR.last;
    expect(x.headers).toMatchObject({ Authorization: "Bearer tok", "X-Progress": "stream" });
    x.upload.onprogress({ lengthComputable: true, loaded: 50, total: 100 });
    expect(cb.onUpload).toHaveBeenCalledWith(50);
    x.status = 200; x.responseText = '{"stage":"transcribing"}\n'; x.onprogress();
    expect(cb.onStage).toHaveBeenCalledWith("transcribing");
    x.respond(200, `{"stage":"transcribing"}\n{"stage":"extracting"}\n{"stage":"done","result":${JSON.stringify(result)}}\n`);
    await expect(p).resolves.toMatchObject({ transcript: "t" });
    expect(cb.onStage).toHaveBeenCalledWith("extracting");
  });
  it("surfaces JSON errors from validation failures", async () => {
    const { p } = upload(); await Promise.resolve();
    FakeXHR.last.respond(415, JSON.stringify({ error: { code: "unsupported_audio", message: "Unsupported audio" } }));
    await expect(p).rejects.toMatchObject({ code: "unsupported_audio", status: 415 });
  });
  it("surfaces errors reported inside the stream", async () => {
    const { p } = upload(); await Promise.resolve();
    FakeXHR.last.respond(200, '{"stage":"transcribing"}\n{"stage":"error","error":{"code":"transcription_unavailable","message":"Down"}}\n');
    await expect(p).rejects.toMatchObject({ code: "transcription_unavailable" });
  });
  it("fails (never hangs) if the stream ends without a result", async () => {
    const { p } = upload(); await Promise.resolve();
    FakeXHR.last.respond(200, '{"stage":"transcribing"}\n');
    await expect(p).rejects.toMatchObject({ code: "incomplete_response" });
  });
  it("maps network errors, timeouts and cancellation", async () => {
    let u = upload(); await Promise.resolve(); FakeXHR.last.onerror();
    await expect(u.p).rejects.toMatchObject({ code: "network" });
    u = upload(); await Promise.resolve(); FakeXHR.last.ontimeout();
    await expect(u.p).rejects.toMatchObject({ code: "timeout" });
    const ctl = new AbortController(); u = upload(ctl.signal); await Promise.resolve(); ctl.abort();
    await expect(u.p).rejects.toMatchObject({ code: "cancelled" });
  });
});
