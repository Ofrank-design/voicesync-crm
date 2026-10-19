/** Best-effort server-side duration probe. Returns undefined when the container has no duration metadata
 *  (common for streamed MediaRecorder WebM); callers then fall back to the client-reported value. */
export type DurationProbe = (audio: Buffer, mime: string) => Promise<number | undefined>;

export const probeDuration: DurationProbe = async (audio, mime) => {
  try {
    const mm = await import("music-metadata");
    const meta = await mm.parseBuffer(audio, { mimeType: mime }, { duration: true });
    const d = meta.format.duration;
    return typeof d === "number" && Number.isFinite(d) && d > 0 ? d : undefined;
  } catch {
    return undefined;
  }
};
