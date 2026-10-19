export function TranscriptPreview({ text }: { text: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Transcript</p>
      <p className="mt-1 rounded-lg bg-slate-50 p-3 text-sm italic" data-testid="transcript">{text}</p>
    </div>
  );
}
