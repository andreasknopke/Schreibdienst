import type { RichTextFormatRange } from '@/lib/richTextFormatting';

/** Field types used throughout the app. */
export type BefundField = 'methodik' | 'befund' | 'beurteilung';

/**
 * A single block inside a Befund field.
 *
 * - `type === 'baustein'`: originated from a template; `templateId` references
 *   the original template for LLM adaption.
 * - `type === 'freitext'`: free‑text block without a template relationship.
 */
export interface EditorBlock {
  id: string;
  type: 'baustein' | 'freitext';
  name: string;                       // human‑readable label (template name or "Freitext")
  templateId?: number;
  field: BefundField;
  originalContent: string;            // content at creation time (used as LLM base)
  currentText: string;
  formatRanges: RichTextFormatRange[];
}

/** A map from field to its ordered list of blocks. */
export type EditorBlocksByField = Record<BefundField, EditorBlock[]>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create an initial `EditorBlock` of type `freitext` from an existing text.
 */
export function createFreitextBlock(
  field: BefundField,
  text: string,
  formatRanges?: RichTextFormatRange[],
): EditorBlock {
  return {
    id: crypto.randomUUID(),
    type: 'freitext',
    name: 'Freitext',
    field,
    originalContent: text,
    currentText: text,
    formatRanges: formatRanges ?? [],
  };
}

/**
 * Create an initial `EditorBlock` of type `baustein` from a template.
 */
export function createBausteinBlock(
  field: BefundField,
  templateId: number,
  name: string,
  content: string,
  formatRanges?: RichTextFormatRange[],
): EditorBlock {
  return {
    id: crypto.randomUUID(),
    type: 'baustein',
    name,
    templateId,
    field,
    originalContent: content,
    currentText: content,
    formatRanges: formatRanges ?? [],
  };
}

/**
 * Return an empty `EditorBlocksByField` map.
 */
export function emptyEditorBlocksByField(): EditorBlocksByField {
  return { methodik: [], befund: [], beurteilung: [] };
}

/**
 * Create the initial blocks for all three fields from raw text values.
 * Each field gets a single `freitext` block.
 */
export function initializeBlocksFromText(
  texts: Record<BefundField, string>,
  formats: Record<BefundField, RichTextFormatRange[]>,
): EditorBlocksByField {
  const fields: BefundField[] = ['methodik', 'befund', 'beurteilung'];
  const blocks: EditorBlocksByField = emptyEditorBlocksByField();
  for (const field of fields) {
    blocks[field] = [createFreitextBlock(field, texts[field], formats[field])];
  }
  return blocks;
}

/**
 * Ensure a field has at least one block. If empty, create a freitext block
 * from the given text. Returns the (possibly updated) map.
 */
export function ensureFieldHasBlocks(
  prev: EditorBlocksByField,
  field: BefundField,
  text: string,
  formatRanges?: RichTextFormatRange[],
): EditorBlocksByField {
  if (prev[field].length > 0) return prev;
  return {
    ...prev,
    [field]: [createFreitextBlock(field, text, formatRanges)],
  };
}
