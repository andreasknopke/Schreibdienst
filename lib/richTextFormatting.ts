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
