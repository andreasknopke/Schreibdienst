"use client";

import { useEffect, useMemo } from 'react';
import { buildRichTextHtml, RICH_TEXT_RENDER_MARKER, type RichTextFormatRange, type RichTextSelection } from '@/lib/richTextFormatting';

interface RichTextDictationEditorProps {
  editorRef: React.RefObject<HTMLDivElement | null>;
  value: string;
  formats: RichTextFormatRange[];
  selection?: RichTextSelection | null;
  className?: string;
  placeholder?: string;
  readOnly?: boolean;
  onChange: (value: string, editor: HTMLDivElement) => void;
  onSelectionChange: (editor: HTMLDivElement) => void;
  onFocus?: (editor: HTMLDivElement) => void;
  onBlur?: () => void;
  onWordDoubleClick?: (info: { word: string; start: number; end: number; clientX: number; clientY: number }, editor: HTMLDivElement) => void;
}


function getEditorText(editor: HTMLDivElement): string {
  return editor.textContent?.split(RICH_TEXT_RENDER_MARKER).join('') ?? '';
}

function getLogicalTextLength(text: string): number {
  return text.split(RICH_TEXT_RENDER_MARKER).join('').length;
}

function getLogicalOffsetFromRaw(text: string, rawOffset: number): number {
  let logicalOffset = 0;
  for (let index = 0; index < Math.min(rawOffset, text.length); index += 1) {
    if (text[index] === RICH_TEXT_RENDER_MARKER) continue;
    logicalOffset += 1;
  }
  return logicalOffset;
}

function getRawOffsetFromLogical(text: string, logicalOffset: number): number {
  if (logicalOffset <= 0) return 0;

  let visibleCount = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === RICH_TEXT_RENDER_MARKER) continue;
    visibleCount += 1;
    if (visibleCount >= logicalOffset) {
      return index + 1;
    }
  }

  return text.length;
}

function getNodeOffset(root: HTMLDivElement, targetNode: Node, targetOffset: number): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let currentNode = walker.nextNode();

  while (currentNode) {
    const nodeText = currentNode.textContent ?? '';
    const textLength = getLogicalTextLength(nodeText);
    if (currentNode === targetNode) {
      return offset + getLogicalOffsetFromRaw(nodeText, targetOffset);
    }
    offset += textLength;
    currentNode = walker.nextNode();
  }

  return offset;
}

function resolveSelection(root: HTMLDivElement): RichTextSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    return null;
  }

  const start = getNodeOffset(root, range.startContainer, range.startOffset);
  const end = getNodeOffset(root, range.endContainer, range.endOffset);
  return {
    start,
    end,
    direction: selection.anchorNode === range.endContainer && selection.anchorOffset === range.endOffset ? 'backward' : 'none',
  };
}

function findTextPosition(root: HTMLDivElement, targetOffset: number): { node: Node; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let traversed = 0;
  let currentNode = walker.nextNode();

  while (currentNode) {
    const nodeText = currentNode.textContent ?? '';
    const textLength = getLogicalTextLength(nodeText);
    if (targetOffset <= traversed + textLength) {
      return {
        node: currentNode,
        offset: getRawOffsetFromLogical(nodeText, Math.max(0, Math.min(targetOffset - traversed, textLength))),
      };
    }
    traversed += textLength;
    currentNode = walker.nextNode();
  }

  if (root.lastChild) {
    const lastNode = root.lastChild;
    const nodeText = lastNode.textContent ?? '';
    return { node: lastNode, offset: nodeText.length };
  }

  return null;
}

function restoreSelection(root: HTMLDivElement, selection: RichTextSelection | null | undefined) {
  if (!selection) return;
  const startPosition = findTextPosition(root, selection.start);
  const endPosition = findTextPosition(root, selection.end);
  if (!startPosition || !endPosition) return;

  const range = document.createRange();
  range.setStart(startPosition.node, startPosition.offset);
  range.setEnd(endPosition.node, endPosition.offset);

  const currentSelection = window.getSelection();
  if (!currentSelection) return;
  currentSelection.removeAllRanges();
  currentSelection.addRange(range);
}

function insertPlainText(text: string) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function getFormatsForSelection(formats: RichTextFormatRange[], start: number, end: number): RichTextFormatRange[] {
  return formats
    .filter((range) => range.end > start && range.start < end)
    .map((range) => ({
      ...range,
      start: Math.max(range.start, start) - start,
      end: Math.min(range.end, end) - start,
    }));
}

function buildClipboardHtml(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
}

export default function RichTextDictationEditor({
  editorRef,
  value,
  formats,
  selection,
  className = '',
  placeholder,
  readOnly = false,
  onChange,
  onSelectionChange,
  onFocus,
  onBlur,
  onWordDoubleClick,
}: RichTextDictationEditorProps) {
  const html = useMemo(() => buildRichTextHtml(value, formats), [value, formats]);
  const formatSignature = useMemo(() => JSON.stringify(formats), [formats]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const currentText = getEditorText(editor);
    const currentSignature = editor.dataset.formatSignature ?? '[]';
    const currentHtml = editor.innerHTML;
    if (currentText === value && currentSignature === formatSignature && currentHtml === html) {
      return;
    }

    editor.innerHTML = html;
    editor.dataset.formatSignature = formatSignature;

    if (document.activeElement === editor) {
      restoreSelection(editor, selection);
    }
  }, [editorRef, value, html, selection, formatSignature]);

  return (
    <div className="relative">
      {placeholder && !value && (
        <div className="pointer-events-none absolute left-3 top-3 text-sm text-gray-400 dark:text-gray-500">
          {placeholder}
        </div>
      )}
      <div
        className="pointer-events-none absolute bottom-2 right-2 z-10 h-3 w-3 opacity-70"
        style={{
          backgroundImage: 'linear-gradient(135deg, transparent 0 42%, currentColor 42% 50%, transparent 50% 64%, currentColor 64% 72%, transparent 72% 100%)',
        }}
      />
      <div
        ref={editorRef}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        className={className}
        onInput={(event) => onChange(getEditorText(event.currentTarget), event.currentTarget)}
        onFocus={(event) => onFocus?.(event.currentTarget)}
        onBlur={onBlur}
        onKeyUp={(event) => onSelectionChange(event.currentTarget)}
        onMouseUp={(event) => onSelectionChange(event.currentTarget)}
        onClick={(event) => onSelectionChange(event.currentTarget)}
        onDoubleClick={(event) => {
          if (!onWordDoubleClick) return;
          const editor = event.currentTarget;
          const sel = window.getSelection();
          if (!sel || sel.rangeCount === 0) return;
          const range = sel.getRangeAt(0);
          if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return;
          const word = sel.toString().trim();
          if (!word || /[\s]/.test(word)) return;
          const start = getNodeOffset(editor, range.startContainer, range.startOffset);
          const end = getNodeOffset(editor, range.endContainer, range.endOffset);
          onWordDoubleClick({ word, start, end, clientX: event.clientX, clientY: event.clientY }, editor);
        }}
        onPaste={(event) => {
          event.preventDefault();
          const pastedText = event.clipboardData.getData('text/plain');
          insertPlainText(pastedText);
          onChange(getEditorText(event.currentTarget), event.currentTarget);
        }}
        onCopy={(event) => {
          const resolvedSelection = resolveSelection(event.currentTarget);
          if (!resolvedSelection || resolvedSelection.start === resolvedSelection.end) return;

          const start = Math.min(resolvedSelection.start, resolvedSelection.end);
          const end = Math.max(resolvedSelection.start, resolvedSelection.end);
          const selectedText = value.slice(start, end).normalize('NFC');
          const selectedFormats = getFormatsForSelection(formats, start, end);
          const selectedHtml = buildRichTextHtml(selectedText, selectedFormats).normalize('NFC');

          event.preventDefault();
          event.clipboardData.setData('text/plain', selectedText);
          event.clipboardData.setData('text/html', buildClipboardHtml(selectedHtml));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            insertPlainText('\n');
            onChange(getEditorText(event.currentTarget), event.currentTarget);
          }
        }}
        role="textbox"
        aria-multiline="true"
        spellCheck={false}
        style={{ whiteSpace: 'break-spaces', resize: 'vertical', overflow: 'auto' }}
      />
    </div>
  );
}

export function getRichTextSelection(editor: HTMLDivElement): RichTextSelection | null {
  return resolveSelection(editor);
}
