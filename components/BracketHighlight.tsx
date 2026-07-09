"use client";

interface BracketPart {
  type: 'text' | 'bracket';
  /** Bei bracket: die Optionen-Strings; bei text: der Text */
  options?: string[];
  text?: string;
}

const OPT_STYLES = [
  'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200',
  'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200',
  'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200',
];

/**
 * Zeigt Text an und hebt Inhalte in [eckigen Klammern] mehrfarbig hervor.
 * [gut/schlecht/mittel] → erste Option grün, zweite gelb, dritte rot.
 */
export default function BracketHighlight({ text, className = '' }: { text: string; className?: string }) {
  if (!text) return null;

  const parts: BracketPart[] = [];
  let lastIndex = 0;
  const bracketRegex = /\[([^\]]*)\]/g;
  let match: RegExpExecArray | null;

  while ((match = bracketRegex.exec(text)) !== null) {
    // Text vor der Klammer
    if (match.index > lastIndex) {
      parts.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }
    // Klammer-Inhalt in Optionen splitten
    const inner = match[1];
    const options = inner.split('/').map(o => o.trim()).filter(Boolean);
    parts.push({ type: 'bracket', options });
    lastIndex = match.index + match[0].length;
  }

  // Rest nach der letzten Klammer
  if (lastIndex < text.length) {
    parts.push({ type: 'text', text: text.slice(lastIndex) });
  }

  if (parts.length === 0) {
    return <span className={className}>{text}</span>;
  }

  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.type === 'bracket' && part.options ? (
          <span key={i} className="rounded px-0.5 font-medium">
            <span className="opacity-50">[</span>
            {part.options.map((opt, optIdx) => (
              <span key={optIdx}>
                {optIdx > 0 && <span className="opacity-40 mx-px">/</span>}
                <span className={OPT_STYLES[optIdx % 3]}>{opt}</span>
              </span>
            ))}
            <span className="opacity-50">]</span>
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </span>
  );
}
