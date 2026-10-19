export interface DetectedAudio { ext: "webm" | "ogg" | "wav" | "mp4" | "mp3" | "flac"; mime: string }

/** Detect the real container from magic bytes rather than trusting the client MIME type. */
export function detectAudioFormat(buf: Buffer): DetectedAudio | null {
  if (buf.length < 12) return null;
  const ascii = (s: number, e: number) => buf.toString("latin1", s, e);
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { ext: "webm", mime: "audio/webm" };
  if (ascii(0, 4) === "OggS") return { ext: "ogg", mime: "audio/ogg" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return { ext: "wav", mime: "audio/wav" };
  if (ascii(4, 8) === "ftyp") return { ext: "mp4", mime: "audio/mp4" };
  if (ascii(0, 4) === "fLaC") return { ext: "flac", mime: "audio/flac" };
  if (ascii(0, 3) === "ID3" || (buf[0] === 0xff && ((buf[1] ?? 0) & 0xe0) === 0xe0)) return { ext: "mp3", mime: "audio/mpeg" };
  return null;
}
