import type { Logger } from "./logger";

/** Lets the readiness check tell the load balancer to stop sending traffic before the process exits. */
export class Lifecycle { draining = false; }

export interface ClosableServer { close(cb?: (err?: Error) => void): unknown }
export interface ShutdownOptions { server: ClosableServer; lifecycle: Lifecycle; log: Logger; timeoutMs?: number; exit?: (code: number) => void; proc?: Pick<NodeJS.Process, "on"> }
/**
 * On SIGTERM or SIGINT: report "not ready", stop accepting connections, let requests in flight finish,
 * then exit. If they have not finished in time, exit anyway with a failure code. Also logs and exits on crashes.
 */
export function installShutdown({ server, lifecycle, log, timeoutMs = 25_000, exit = (c) => process.exit(c), proc = process }: ShutdownOptions) {
  let started = false;
  const stop = (reason: string, code: number) => {
    if (started) return; started = true; lifecycle.draining = true;
    log.info("shutting down", { reason });
    const timer = setTimeout(() => { log.error("shutdown timed out, exiting", { timeout_ms: timeoutMs }); exit(1); }, timeoutMs); timer.unref?.();
    server.close((err) => { clearTimeout(timer); if (err) log.error("error while closing", { error: err.message }); exit(err ? 1 : code); });
  };
  proc.on("SIGTERM", () => stop("SIGTERM", 0));
  proc.on("SIGINT", () => stop("SIGINT", 0));
  proc.on("unhandledRejection", (e) => { log.error("unhandled rejection", { error: String((e as Error)?.message ?? e) }); stop("unhandledRejection", 1); });
  proc.on("uncaughtException", (e) => { log.error("uncaught exception", { error: e.message }); stop("uncaughtException", 1); });
  return stop;
}
