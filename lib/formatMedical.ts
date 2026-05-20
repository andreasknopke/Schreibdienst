"use client";
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from 'docx';
import { buildRichTextSegments, type RichTextFormatRange } from '@/lib/richTextFormatting';

export function normalizeGermanText(input: string): string {
  let t = input.trim();
  t = t.replace(/\r\n|\r/g, '\n');
  t = t.replace(/\n{3,}/g, '\n\n');
  t = t.replace(/[ \t]{2,}/g, ' ');
  t = t.replace(/\s+([,.:;!?])/g, '$1');
  t = t.replace(/([\p{L}\d])\s+(\.)/gu, '$1.');
  // Sentence case heuristic
  t = t
    .split(/(?<=[.!?])\s+/)
    .map((s) => {
      const trimmed = s.trim();
      if (!trimmed) return '';
      return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    })
    .join(' ');
  // Smart quotes simple
  t = t.replace(/\"(.*?)\"/g, '„$1“');
  return t;
}

export function formatAsArztbrief(text: string): string {
  const sections = ensureSections(text, [
    'Anamnese',
    'Befund',
    'Diagnose',
    'Therapie',
    'Empfehlung',
  ]);
  return sections;
}

export function formatAsBefund(text: string): string {
  const sections = ensureSections(text, [
    'Fragestellung',
    'Durchführung',
    'Befund',
    'Beurteilung',
    'Empfehlung',
  ]);
  return sections;
}

function ensureSections(text: string, order: string[]): string {
  const lines = text.split('\n');
  const hasAnyHeader = lines.some((l) => /^\s*([A-ZÄÖÜ][\wÄÖÜäöüß ]{2,}):/.test(l));
  if (hasAnyHeader) return text; // already structured

  const paras = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const parts: string[] = [];
  for (let i = 0; i < order.length; i++) {
    const head = order[i];
    const body = paras[i] ?? '';
    parts.push(`${head}:\n${body}\n`);
  }
  return parts.join('\n');
}

function buildRunsForRange(text: string, formats: RichTextFormatRange[], start: number, end: number): TextRun[] {
  const lineText = text.slice(start, end);
  if (!lineText) return [];

  const segments = buildRichTextSegments(lineText, formats.map((range) => ({
    ...range,
    start: Math.max(0, range.start - start),
    end: Math.max(0, range.end - start),
  })));

  if (segments.length === 0) {
    return [new TextRun(lineText)];
  }

  return segments.map((segment) => new TextRun({
    text: segment.text,
    bold: segment.bold,
    italics: segment.italic,
    underline: segment.underline ? {} : undefined,
  }));
}

export async function exportDocx(text: string, mode: 'arztbrief' | 'befund', formats: RichTextFormatRange[] = []) {
  const title = mode === 'befund' ? 'Befundbericht' : 'Arztbrief';
  const paragraphs: Paragraph[] = [];
  paragraphs.push(new Paragraph({
    heading: HeadingLevel.TITLE,
    children: [new TextRun(title)],
  }));

  const lines = text.split('\n');
  let offset = 0;
  for (const line of lines) {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    const headingMatch = line.match(/^([A-ZÄÖÜ][\wÄÖÜäöüß ]{2,}):\s*$/);

    if (headingMatch) {
      paragraphs.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 120 },
        children: [new TextRun(headingMatch[1])],
      }));
    } else {
      paragraphs.push(new Paragraph({
        children: buildRunsForRange(text, formats, lineStart, lineEnd),
      }));
    }

    offset = lineEnd + 1;
  }

  const doc = new Document({ sections: [{ properties: {}, children: paragraphs }] });
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title}.docx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
