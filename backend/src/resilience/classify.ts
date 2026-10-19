/** Errors that mean "the provider is struggling", as opposed to "the request or setup is wrong". */
export const isTransient = (code: string) => /_(unavailable|timeout|billing)$/.test(code) || code === "upstream_rate_limited";
/** Only genuine provider trouble moves a circuit breaker. A circuit that is already open is not new evidence. */
export const countsAgainstBreaker = isTransient;
/** Worth trying the configured backup provider for. */
export const fallbackEligible = (code: string) => isTransient(code) || code.endsWith("_circuit_open");
