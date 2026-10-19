export type Level = "debug" | "info" | "warn" | "error" | "silent";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
/** Anything that could carry a secret, a recording, or what someone said is replaced before it reaches a log. */
const SENSITIVE = /authorization|cookie|token|secret|password|api[_-]?key|transcript|audio|apikey|bearer/i;
export function redact(v: unknown, depth = 0): unknown {
  if (depth > 5 || v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => redact(x, depth + 1));
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, SENSITIVE.test(k) ? "[redacted]" : redact(x, depth + 1)]));
}
export interface Logger { debug(msg: string, f?: object): void; info(msg: string, f?: object): void; warn(msg: string, f?: object): void; error(msg: string, f?: object): void }
/** One JSON object per line, easy to ship to any log service. */
export function makeLogger(level: Level, sink: (line: string) => void = (l) => process.stdout.write(l + "\n")): Logger {
  const emit = (lv: Exclude<Level, "silent">) => (msg: string, f: object = {}) => {
    if (ORDER[lv] < ORDER[level]) return;
    sink(JSON.stringify({ ts: new Date().toISOString(), level: lv, msg, ...(redact(f) as object) }));
  };
  return { debug: emit("debug"), info: emit("info"), warn: emit("warn"), error: emit("error") };
}
export const silentLogger: Logger = makeLogger("silent");
