// WCAG 2.1 contrast check for the colour pairs used in the UI (AA = 4.5:1 normal text, 3:1 large/UI).
const lum = (hex) => { const c = hex.replace("#", "").match(/../g).map((h) => parseInt(h, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const pairs = [
  ["body text on page", "#0b1530", "#f3f6fc"], ["body text on card", "#0b1530", "#ffffff"], ["landing muted text on white", "#4a5875", "#ffffff"], ["landing muted on tint", "#4a5875", "#eef3fb"],
  ["primary button", "#ffffff", "#1f6bff"], ["primary button hover", "#ffffff", "#1a5fe6"], ["landing link blue on navy", "#5b8cff", "#0a1330"], ["landing gradient end on navy", "#8b6cff", "#0a1330"], ["landing muted on navy", "#b9c6e4", "#0a1330"],
  ["slate-600 on white (secondary text)", "#475569", "#ffffff"], ["slate-600 on slate-100 (column bg)", "#475569", "#f1f5f9"], ["slate-600 on slate-50", "#475569", "#f8fafc"],
  ["high badge", "#991b1b", "#fef2f2"], ["medium badge", "#78350f", "#fffbeb"], ["low badge", "#065f46", "#ecfdf5"],
  ["error text", "#7f1d1d", "#fef2f2"], ["warning text", "#78350f", "#fffbeb"], ["current stage", "#1450c0", "#eff6ff"], ["done stage", "#064e3b", "#ecfdf5"],
  ["overdue red on white", "#b91c1c", "#ffffff"], ["success text", "#064e3b", "#ecfdf5"],
];
let bad = 0;
for (const [n, f, b] of pairs) { const r = ratio(f, b); const ok = r >= 4.5; if (!ok) bad++; console.log(`${ok ? "PASS" : "FAIL"}  ${r.toFixed(2)}  ${n}`); }
process.exit(bad ? 1 : 0);
