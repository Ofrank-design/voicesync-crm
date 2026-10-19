const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
const lbl = (l: Record<string, string>) => { const k = Object.keys(l).sort(); return k.length ? `{${k.map((x) => `${x}="${esc(l[x]!)}"`).join(",")}}` : ""; };
const BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60];

/** A small Prometheus compatible registry. No user IDs, transcripts or keys are ever used as labels. */
export class Metrics {
  private counters = new Map<string, { help: string; v: Map<string, number> }>();
  private hists = new Map<string, { help: string; v: Map<string, { b: number[]; sum: number; n: number }> }>();
  private gauges: Array<{ name: string; help: string; read: () => Array<[Record<string, string>, number]> }> = [];
  inc(name: string, help: string, labels: Record<string, string> = {}, by = 1) {
    const c = this.counters.get(name) ?? { help, v: new Map() }; this.counters.set(name, c);
    const k = lbl(labels); c.v.set(k, (c.v.get(k) ?? 0) + by);
  }
  observe(name: string, help: string, labels: Record<string, string>, seconds: number) {
    const h = this.hists.get(name) ?? { help, v: new Map() }; this.hists.set(name, h);
    const k = lbl(labels); const e = h.v.get(k) ?? { b: BUCKETS.map(() => 0), sum: 0, n: 0 }; h.v.set(k, e);
    BUCKETS.forEach((b, i) => { if (seconds <= b) e.b[i]!++; }); e.sum += seconds; e.n++;
  }
  gauge(name: string, help: string, read: () => Array<[Record<string, string>, number]>) { this.gauges.push({ name, help, read }); }
  render(): string {
    const out: string[] = [];
    for (const [n, c] of this.counters) { out.push(`# HELP ${n} ${c.help}`, `# TYPE ${n} counter`); for (const [k, v] of c.v) out.push(`${n}${k} ${v}`); }
    for (const [n, h] of this.hists) {
      out.push(`# HELP ${n} ${h.help}`, `# TYPE ${n} histogram`);
      for (const [k, e] of h.v) {
        const base = k ? k.slice(1, -1) + "," : "";
        for (const [i, b] of BUCKETS.entries()) out.push(`${n}_bucket{${base}le="${b}"} ${e.b[i]}`);
        out.push(`${n}_bucket{${base}le="+Inf"} ${e.n}`, `${n}_sum${k} ${e.sum}`, `${n}_count${k} ${e.n}`);
      }
    }
    for (const g of this.gauges) { out.push(`# HELP ${g.name} ${g.help}`, `# TYPE ${g.name} gauge`); for (const [l, v] of g.read()) out.push(`${g.name}${lbl(l)} ${v}`); }
    return out.join("\n") + "\n";
  }
}
