import { useMemo } from 'react';

type DiffLineType = 'add' | 'remove' | 'context' | 'hunk' | 'meta';

type DiffLine = {
  type: DiffLineType;
  oldLine: number | null;
  newLine: number | null;
  content: string;
};

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function parseUnifiedDiff(diffText: string): DiffLine[] {
  const lines = diffText.split('\n');
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const raw of lines) {
    if (raw.startsWith('--- ') || raw.startsWith('+++ ')) {
      result.push({ type: 'meta', oldLine: null, newLine: null, content: raw });
      continue;
    }

    const hunkMatch = HUNK_HEADER.exec(raw);
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1], 10);
      newLine = parseInt(hunkMatch[2], 10);
      result.push({ type: 'hunk', oldLine: null, newLine: null, content: raw });
      continue;
    }

    if (raw.startsWith('+')) {
      result.push({ type: 'add', oldLine: null, newLine, content: raw.slice(1) });
      newLine += 1;
      continue;
    }

    if (raw.startsWith('-')) {
      result.push({ type: 'remove', oldLine, newLine: null, content: raw.slice(1) });
      oldLine += 1;
      continue;
    }

    if (raw === '') {
      continue;
    }

    const content = raw.startsWith(' ') ? raw.slice(1) : raw;
    result.push({ type: 'context', oldLine, newLine, content });
    oldLine += 1;
    newLine += 1;
  }

  return result;
}

export default function DiffView({ diffText }: { diffText: string }) {
  const lines = useMemo(() => parseUnifiedDiff(diffText), [diffText]);

  if (!diffText.trim()) {
    return null;
  }

  return (
    <div className="diff-view" role="table" aria-label="Code diff">
      {lines.map((line, idx) => (
        <div key={idx} className={`diff-view__line diff-view__line--${line.type}`} role="row">
          <span className="diff-view__gutter">{line.oldLine ?? ''}</span>
          <span className="diff-view__gutter">{line.newLine ?? ''}</span>
          <span className="diff-view__marker">
            {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ''}
          </span>
          <span className="diff-view__content">{line.content || ' '}</span>
        </div>
      ))}
    </div>
  );
}
