"use client";

/**
 * Zeigt Text an und hebt Inhalte in [eckigen Klammern] mit grünem Hintergrund hervor.
 */
export default function BracketHighlight({ text, className = '' }: { text: string; className?: string }) {
  if (!text) return null;

  const parts: { type: 'text' | 'bracket'; content: string }[] = [];
  let lastIndex = 0;
  const bracketRegex = /\[([^\]]*)\]/g;
  let match: RegExpExecArray | null;

  while ((match = bracketRegex.exec(text)) !== null) {
    // Text vor der Klammer
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    // Klammer-Inhalt
    parts.push({ type: 'bracket', content: match[0] });
    lastIndex = match.index + match[0].length;
  }

  // Rest nach der letzten Klammer
  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) });
  }

  if (parts.length === 0) {
    return <span className={className}>{text}</span>;
  }

  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.type === 'bracket' ? (
          <span
            key={i}
            className="bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200 rounded px-0.5 font-medium"
          >
            {part.content}
          </span>
        ) : (
          <span key={i}>{part.content}</span>
        )
      )}
    </span>
  );
}
