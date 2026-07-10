import { diffChars } from 'diff';

export const RICH_TEXT_RENDER_MARKER = '\u200B';

export interface RichTextSelection {
  start: number;
  end: number;
  direction: 'forward' | 'backward' | 'none';
}

export interface RichTextFormatRange {
  start: number;
  end: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface RichTextSegment extends RichTextFormatRange {
  text: string;
}

export interface RichTextSelectionBounds {
  start: number;
  end: number;
}

export function normalizeRichTextRanges(ranges: RichTextFormatRange[], textLength: number): RichTextFormatRange[] {
  const cleaned = ranges
    .map((range) => ({
      ...range,
      start: Math.max(0, Math.min(range.start, textLength)),
      end: Math.max(0, Math.min(range.end, textLength)),
    }))
    .filter((range) => range.end > range.start && (range.bold || range.italic || range.underline))
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const merged: RichTextFormatRange[] = [];
  for (const range of cleaned) {
    const previous = merged[merged.length - 1];
    if (
      previous
      && previous.end >= range.start
      && Boolean(previous.bold) === Boolean(range.bold)
      && Boolean(previous.italic) === Boolean(range.italic)
      && Boolean(previous.underline) === Boolean(range.underline)
    ) {
      previous.end = Math.max(previous.end, range.end);
      continue;
    }
    merged.push({ ...range });
  }

  return merged;
}

export function getRichTextSelectionBounds(
  selection: RichTextSelection | null | undefined,
): RichTextSelectionBounds {
  if (!selection) {
    return { start: 0, end: 0 };
  }

  return {
    start: Math.min(selection.start, selection.end),
    end: Math.max(selection.start, selection.end),
  };
}

function isFormatEnabledAt(ranges: RichTextFormatRange[], offset: number, key: keyof Pick<RichTextFormatRange, 'bold' | 'italic' | 'underline'>): boolean {
  return ranges.some((range) => range.start <= offset && range.end > offset && Boolean(range[key]));
}

export function isRichTextFormatActiveAcrossSelection(
  ranges: RichTextFormatRange[],
  start: number,
  end: number,
  key: keyof Pick<RichTextFormatRange, 'bold' | 'italic' | 'underline'>,
): boolean {
  if (end <= start) {
    return false;
  }

  const breakpoints = new Set<number>([start, end]);
  for (const range of ranges) {
    if (range.end <= start || range.start >= end) continue;
    breakpoints.add(Math.max(start, range.start));
    breakpoints.add(Math.min(end, range.end));
  }

  const sortedBreakpoints = Array.from(breakpoints).sort((left, right) => left - right);
  for (let index = 0; index < sortedBreakpoints.length - 1; index += 1) {
    const segmentStart = sortedBreakpoints[index];
    const segmentEnd = sortedBreakpoints[index + 1];
    if (segmentEnd <= segmentStart) continue;
    if (!isFormatEnabledAt(ranges, segmentStart, key)) {
      return false;
    }
  }

  return true;
}

export function setRichTextFormatForSelection(
  ranges: RichTextFormatRange[],
  textLength: number,
  start: number,
  end: number,
  key: keyof Pick<RichTextFormatRange, 'bold' | 'italic' | 'underline'>,
  enabled: boolean,
): RichTextFormatRange[] {
  const normalizedStart = Math.max(0, Math.min(start, textLength));
  const normalizedEnd = Math.max(normalizedStart, Math.min(end, textLength));
  if (normalizedEnd <= normalizedStart) {
    return normalizeRichTextRanges(ranges, textLength);
  }

  const normalizedRanges = normalizeRichTextRanges(ranges, textLength);
  const breakpoints = new Set<number>([0, textLength, normalizedStart, normalizedEnd]);

  for (const range of normalizedRanges) {
    breakpoints.add(range.start);
    breakpoints.add(range.end);
  }

  const sortedBreakpoints = Array.from(breakpoints).sort((left, right) => left - right);
  const nextRanges: RichTextFormatRange[] = [];

  for (let index = 0; index < sortedBreakpoints.length - 1; index += 1) {
    const segmentStart = sortedBreakpoints[index];
    const segmentEnd = sortedBreakpoints[index + 1];
    if (segmentEnd <= segmentStart) continue;

    const segment: RichTextFormatRange = {
      start: segmentStart,
      end: segmentEnd,
      bold: isFormatEnabledAt(normalizedRanges, segmentStart, 'bold'),
      italic: isFormatEnabledAt(normalizedRanges, segmentStart, 'italic'),
      underline: isFormatEnabledAt(normalizedRanges, segmentStart, 'underline'),
    };

    if (segmentEnd > normalizedStart && segmentStart < normalizedEnd) {
      segment[key] = enabled;
    }

    nextRanges.push(segment);
  }

  return normalizeRichTextRanges(nextRanges, textLength);
}

export function buildRichTextSegments(text: string, formats: RichTextFormatRange[]): RichTextSegment[] {
  if (!text) return [];

  const breakpoints = new Set<number>([0, text.length]);
  for (const range of formats) {
    const start = Math.max(0, Math.min(range.start, text.length));
    const end = Math.max(start, Math.min(range.end, text.length));
    if (start === end) continue;
    breakpoints.add(start);
    breakpoints.add(end);
  }

  const sortedBreakpoints = Array.from(breakpoints).sort((a, b) => a - b);
  const segments: RichTextSegment[] = [];

  for (let index = 0; index < sortedBreakpoints.length - 1; index += 1) {
    const start = sortedBreakpoints[index];
    const end = sortedBreakpoints[index + 1];
    const segmentText = text.slice(start, end);
    if (!segmentText) continue;

    let bold = false;
    let italic = false;
    let underline = false;

    for (const range of formats) {
      if (range.start >= end || range.end <= start) continue;
      bold = bold || Boolean(range.bold);
      italic = italic || Boolean(range.italic);
      underline = underline || Boolean(range.underline);
    }

    segments.push({ text: segmentText, start, end, bold, italic, underline });
  }

  return segments;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildRichTextHtml(text: string, formats: RichTextFormatRange[]): string {
  const segments = buildRichTextSegments(text, formats);

  let html = segments.map((segment, index) => {
    let escapedText = escapeHtml(segment.text);

    if (index === segments.length - 1 && segment.text.endsWith('\n')) {
      escapedText += RICH_TEXT_RENDER_MARKER;
    }

    if (segment.underline) {
      escapedText = `<u>${escapedText}</u>`;
    }

    if (segment.italic) {
      escapedText = `<em style="font-style:italic;font-synthesis:style;font-synthesis-small-caps:none">${escapedText}</em>`;
    }

    if (segment.bold) {
      escapedText = `<strong>${escapedText}</strong>`;
    }

    return escapedText;
  }).join('');

  // Convert line breaks to HTML: preserve empty lines for paragraph separation.
  // Each \n\n (or more) represents empty lines between paragraphs.
  // Single \n within text becomes <br> inside a paragraph.
  const lines = html.split('\n');
  const blocks: string[] = [];
  let currentParagraph: string[] = [];
  let wasEmpty = false;

  for (const line of lines) {
    if (line === '') {
      // Empty line (consecutive \n → empty string from split)
      if (currentParagraph.length > 0) {
        blocks.push(`<p>${currentParagraph.join('<br>')}</p>`);
        currentParagraph = [];
        wasEmpty = true;
      } else if (wasEmpty) {
        // Another consecutive empty line → empty paragraph
        blocks.push('<p><br></p>');
      } else {
        wasEmpty = true;
      }
    } else {
      wasEmpty = false;
      currentParagraph.push(line);
    }
  }

  // Flush remaining paragraph content (trailing empty lines are already handled
  // in the loop above, so we only flush non-empty content here).
  if (currentParagraph.length > 0) {
    blocks.push(`<p>${currentParagraph.join('<br>')}</p>`);
  }

  if (blocks.length > 0) {
    html = blocks.join('');
  } else {
    html = html.replace(/\n/g, '<br>');
  }

  return html;
}

function remapOffset(oldOffset: number, diffs: ReturnType<typeof diffChars>): number {
  let oldIndex = 0;
  let newIndex = 0;

  for (const part of diffs) {
    const partLength = part.value.length;
    if (part.added) {
      newIndex += partLength;
      continue;
    }

    if (part.removed) {
      if (oldOffset <= oldIndex + partLength) {
        return newIndex;
      }
      oldIndex += partLength;
      continue;
    }

    if (oldOffset <= oldIndex + partLength) {
      return newIndex + (oldOffset - oldIndex);
    }

    oldIndex += partLength;
    newIndex += partLength;
  }

  return newIndex;
}

export function remapRichTextRanges(
  previousText: string,
  nextText: string,
  ranges: RichTextFormatRange[],
): RichTextFormatRange[] {
  if (ranges.length === 0) return ranges;
  if (previousText === nextText) return ranges;

  const diffs = diffChars(previousText, nextText);
  const remapped = ranges.map((range) => {
    const start = remapOffset(range.start, diffs);
    const end = remapOffset(range.end, diffs);
    return {
      ...range,
      start: Math.min(start, end),
      end: Math.max(start, end),
    };
  });

  return normalizeRichTextRanges(remapped, nextText.length);
}

/**
 * Generiert Suchvarianten für ein Text-Segment, das Template-Optionen
 * in der Form `[Option1/Option2]` enthalten kann.
 *
 * Das LLM löst solche Option-Marker typischerweise auf, z.B.:
 *   `[Linker/Rechter] Fuß` → `Linker Fuß` oder `Rechter Fuß`
 *
 * Strategien (in dieser Reihenfolge):
 * 1. Original-Text (exakt)
 * 2. Ohne Klammern, aber mit Inhalt: `Linker/Rechter Fuß`
 * 3. Jede einzelne Option mit dem restlichen Text: `Linker Fuß`, `Rechter Fuß`
 * 4. Ohne den gesamten `[...]`-Block inkl. Inhalt: ` Fuß` → getrimmt: `Fuß`
 */
function* generateSegmentVariants(text: string): Generator<string> {
  // 1. Original
  yield text;

  // 2. Ohne umschließende Klammern «[» / «]», Inhalt bleibt
  const noBrackets = text.replace(/\[([^\]]*)\]/g, '$1');
  if (noBrackets !== text) yield noBrackets;

  // 3. Für jede Option im Marker: Option + Rest
  //    Z. B. «[Linker/Rechter] Fuß» → «Linker Fuß», «Rechter Fuß»
  const optionMatch = text.match(/\[([^\]]+)\]/);
  if (optionMatch) {
    const before = text.slice(0, optionMatch.index);
    const after = text.slice(optionMatch.index! + optionMatch[0].length);
    const options = optionMatch[1].split('/').map((s) => s.trim()).filter(Boolean);
    for (const opt of options) {
      yield (before + opt + after).replace(/\s+/g, ' ').trim();
    }
  }

  // 4. Kompletten «[…]»-Block entfernen (Inhalt + Klammern)
  const stripped = text.replace(/\[[^\]]*\]\s*/g, '').trim();
  if (stripped && stripped !== text) yield stripped;
}

/**
 * Inhalts-basierte Format-Übertragung für LLM-adaptierte Texte.
 *
 * Sucht für jede Format-Range das originale Text-Segment im neuen Text und
 * überträgt die Formatierung an die gefundene Position. Segmente, die das
 * LLM entfernt oder stark verändert hat, verlieren ihre Formatierung.
 *
 * Behandelt LLM-typische Textveränderungen:
 * - Auflösung von Template-Optionen `[a/b]` → `a` oder `b`
 * - Umstellung von Sätzen/Absätzen
 * - Einschübe von Zusatztext (z. B. Widerspruchs-Prüfung)
 * - Zeilenumbruch-Erhaltung
 *
 * @param previousText – Originaltext (mit Formatierung)
 * @param nextText     – LLM-Output (adaptierter Text)
 * @param ranges       – Format-Ranges aus previousText
 * @returns Format-Ranges, auf nextText gemappt
 */
export function remapRichTextRangesByContent(
  previousText: string,
  nextText: string,
  ranges: RichTextFormatRange[],
): RichTextFormatRange[] {
  if (ranges.length === 0) return ranges;
  if (previousText === nextText) return ranges;

  const result: RichTextFormatRange[] = [];

  // Sortierte Arbeitskopie der Ranges
  const sorted = [...ranges].sort((a, b) => a.start - b.start);

  // Segment-Grenzen berechnen
  const segments: Array<{
    text: string;
    range: RichTextFormatRange | null;
  }> = [];

  let cursor = 0;
  for (const r of sorted) {
    if (r.start > cursor) {
      segments.push({ text: previousText.slice(cursor, r.start), range: null });
    }
    segments.push({ text: previousText.slice(r.start, r.end), range: r });
    cursor = r.end;
  }
  if (cursor < previousText.length) {
    segments.push({ text: previousText.slice(cursor), range: null });
  }

  // Freitext-Segmente zwischen formatierten Blöcken sammeln für Kontext
  for (const seg of segments) {
    if (!seg.range) continue;

    // Versuche alle Suchvarianten
    let bestMatch: { start: number; end: number } | null = null;

    for (const variant of generateSegmentVariants(seg.text)) {
      if (!variant) continue;

      // Exakte Suche im gesamten nextText
      let pos = nextText.indexOf(variant);
      if (pos !== -1) {
        bestMatch = { start: pos, end: pos + variant.length };
        break;
      }

      // Whitespace-tolerant: Mehrfach-Leerzeichen normalisieren
      const normVariant = variant.replace(/\s+/g, ' ');
      const normNext = nextText.replace(/\s+/g, ' ');
      pos = normNext.indexOf(normVariant);
      if (pos !== -1) {
        // Position zurück in den Original-Text mappen
        const beforeOrig = nextText.slice(0, pos);
        const approxPos = pos + (beforeOrig.length - beforeOrig.replace(/\s+/g, ' ').length);
        bestMatch = { start: approxPos, end: approxPos + variant.length };
        break;
      }

      // Similaritäts-Fallback für kurze Texte (einzelne Wörter)
      if (variant.length >= 3) {
        // Suche nach dem längsten gemeinsamen Wort-Ende
        const words = variant.split(/\s+/);
        if (words.length >= 2) {
          // Versuche, den letzten Teil des Varianten zu matchen
          const lastWords = words.slice(-Math.min(2, words.length)).join(' ');
          pos = nextText.indexOf(lastWords);
          if (pos !== -1) {
            // Rückwärts expandieren: schauen ob wir den Anfang auch finden
            const startWord = words.slice(0, -Math.min(2, words.length));
            if (startWord.length > 0) {
              const beforeText = nextText.slice(0, pos);
              const beforeWords = beforeText.split(/\s+/);
              const lastBefore = beforeWords[beforeWords.length - 1];
              if (lastBefore && startWord.includes(lastBefore)) {
                const approxStart = pos - lastBefore.length - 1;
                if (approxStart >= 0) {
                  bestMatch = { start: approxStart, end: pos + lastWords.length };
                  break;
                }
              }
            }
            if (!bestMatch) {
              bestMatch = { start: pos, end: pos + lastWords.length };
              break;
            }
          }
        }
      }
    }

    // Fallback: Similaritäts-Suche im gesamten nextText
    if (!bestMatch && seg.text.length >= 3) {
      let bestScore = 0.6; // Mindest-Ähnlichkeit
      // Suche nach dem längsten Wort des Segments
      const words = seg.text.split(/[\s,;.]+/).filter((w) => w.length >= 3);
      for (const word of words) {
        const cleanWord = word.replace(/[[\]/]/g, '');
        if (!cleanWord || cleanWord.length < 3) continue;
        // Finde das Wort im nextText (es könnte leicht angepasst sein)
        const wordPattern = cleanWord.toLowerCase();
        const nextLower = nextText.toLowerCase();
        let searchFrom = 0;
        while (searchFrom < nextLower.length) {
          const idx = nextLower.indexOf(wordPattern, searchFrom);
          if (idx === -1) break;
          // Prüfe ob es ein ganzer Wort-Treffer ist
          const before = idx > 0 ? nextText[idx - 1] : ' ';
          const afterIdx = idx + wordPattern.length;
          const after = afterIdx < nextText.length ? nextText[afterIdx] : ' ';
          if (/\s/.test(before) && /\s/.test(after)) {
            bestMatch = { start: idx, end: afterIdx };
            break;
          }
          searchFrom = idx + 1;
        }
        if (bestMatch) break;
      }
    }

    if (bestMatch) {
      result.push({
        start: bestMatch.start,
        end: bestMatch.end,
        bold: seg.range.bold,
        italic: seg.range.italic,
        underline: seg.range.underline,
      });
    }
    // Nicht gefunden: Formatierung verfällt (LLM hat den Inhalt geändert)
  }

  return normalizeRichTextRanges(result, nextText.length);
}
