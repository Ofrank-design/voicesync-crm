/** Crisp wordmark for light surfaces. The supplied logo image (white text) is used on dark surfaces. */
export function BrandMark({ size = 28 }: { size?: number }) {
  const bars = [[4, 27], [24, 62], [44, 100], [64, 59], [84, 27]] as const;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <defs><linearGradient id="vs-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#c026d3" /><stop offset=".5" stopColor="#3b6cff" /><stop offset="1" stopColor="#06b6d4" /></linearGradient></defs>
      {bars.map(([x, h]) => <rect key={x} x={x} y={(100 - h) / 2} width="14" height={h} rx="7" fill="url(#vs-g)" />)}
    </svg>
  );
}
export function BrandLogo() {
  return <img src="/logo-dark-text.png" alt="VoiceSync CRM" width={216} height={36} style={{ height: "2.1rem", width: "auto" }} />;
}
