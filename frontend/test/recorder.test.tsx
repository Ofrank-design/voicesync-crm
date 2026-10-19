import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Recorder } from "@/components/Recorder";
import { pickMimeType } from "@/lib/useRecorder";

class FakeMR {
  static isTypeSupported = (t: string) => t === "audio/webm;codecs=opus";
  state = "inactive"; mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((e: { data: Blob }) => void) | null = null; onstop: (() => void) | null = null; onerror: (() => void) | null = null;
  constructor(public stream: MediaStream) {}
  start() { this.state = "recording"; setTimeout(() => this.ondataavailable?.({ data: new Blob([new Uint8Array(100)]) }), 0); }
  stop() { this.state = "inactive"; this.onstop?.(); }
  pause() { this.state = "paused"; } resume() { this.state = "recording"; }
}
const track = () => ({ stop: vi.fn(), onended: null });
let tracks: ReturnType<typeof track>[];

beforeEach(() => {
  tracks = [track()];
  vi.stubGlobal("MediaRecorder", FakeMR);
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }));
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => tracks, getAudioTracks: () => tracks }) } });
});
afterEach(() => vi.unstubAllGlobals());

describe("Recorder", () => {
  it("does not request the microphone until the user clicks record", () => {
    render(<Recorder onSubmit={() => {}} />);
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /record voice note/i })).toBeEnabled();
  });
  it("records, stops, previews, and submits the blob", async () => {
    const onSubmit = vi.fn();
    render(<Recorder onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: /record voice note/i }));
    await userEvent.click(await screen.findByRole("button", { name: /stop/i }));
    expect(await screen.findByLabelText(/recording preview/i)).toBeInTheDocument();
    expect(tracks[0]!.stop).toHaveBeenCalled(); // mic released after stop
    await userEvent.click(screen.getByRole("button", { name: /send note/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.any(Blob), expect.any(Number));
    expect(screen.getByRole("button", { name: /discard/i })).toBeInTheDocument();
  });
  it("shows a clear message when permission is denied", async () => {
    (navigator.mediaDevices.getUserMedia as any).mockRejectedValue(Object.assign(new Error("x"), { name: "NotAllowedError" }));
    render(<Recorder onSubmit={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /record voice note/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/blocked/i);
  });
  it("shows a clear message when no microphone exists", async () => {
    (navigator.mediaDevices.getUserMedia as any).mockRejectedValue(Object.assign(new Error("x"), { name: "NotFoundError" }));
    render(<Recorder onSubmit={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /record voice note/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not find a microphone/i);
  });
  it("handles unsupported browsers", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    render(<Recorder onSubmit={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/cannot record audio/i);
    expect(screen.getByRole("button", { name: /record voice note/i })).toBeDisabled();
  });
  it("stops media tracks when unmounted mid-recording", async () => {
    const { unmount } = render(<Recorder onSubmit={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /record voice note/i }));
    await screen.findByRole("button", { name: /stop/i });
    unmount();
    await waitFor(() => expect(tracks[0]!.stop).toHaveBeenCalled());
  });
  it("shows processing progress and a cancel control", () => {
    const onCancel = vi.fn();
    render(<Recorder onSubmit={() => {}} busy progress={{ label: "Uploading… 40%", pct: 40 }} onCancelProcessing={onCancel} />);
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
    expect(screen.getByText(/uploading… 40%/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /record voice note/i })).toBeNull();
  });
});

describe("pickMimeType", () => {
  it("picks the first supported container", () => { expect(pickMimeType(FakeMR)).toBe("audio/webm;codecs=opus"); });
  it("prefers mp4 on Safari-like browsers", () => { expect(pickMimeType({ isTypeSupported: (t) => t === "audio/mp4" })).toBe("audio/mp4"); });
  it("returns undefined when MediaRecorder is missing", () => { expect(pickMimeType(undefined)).toBeUndefined(); });
});
