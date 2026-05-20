"use client";

import { useEffect, useMemo } from 'react';
import { buildRichTextHtml, type RichTextFormatRange, type RichTextSelection } from '@/lib/richTextFormatting';

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
}


function getEditorText(editor: HTMLDivElement): string {
  return editor.textContent?.replace(/\u200B/g, '') ?? '';
}

function getNodeOffset(root: HTMLDivElement, targetNode: Node, targetOffset: number): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let currentNode = walker.nextNode();

  while (currentNode) {
    const textLength = currentNode.textContent?.length ?? 0;
    if (currentNode === targetNode) {
      return offset + Math.min(targetOffset, textLength);
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
    const textLength = currentNode.textContent?.length ?? 0;
    if (targetOffset <= traversed + textLength) {
      return {
        node: currentNode,
        offset: Math.max(0, Math.min(targetOffset - traversed, textLength)),
      };
    }
    traversed += textLength;
    currentNode = walker.nextNode();
  }

  if (root.lastChild) {
    const lastNode = root.lastChild;
    const textLength = lastNode.textContent?.length ?? 0;
    return { node: lastNode, offset: textLength };
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
}: RichTextDictationEditorProps) {
  const html = useMemo(() => buildRichTextHtml(value, formats), [value, formats]);
  const formatSignature = useMemo(() => JSON.stringify(formats), [formats]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const currentText = getEditorText(editor);
    const currentSignature = editor.dataset.formatSignature ?? '[]';
    if (currentText === value && currentSignature === formatSignature) {
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
        onPaste={(event) => {
          event.preventDefault();
          const pastedText = event.clipboardData.getData('text/plain');
          insertPlainText(pastedText);
          onChange(getEditorText(event.currentTarget), event.currentTarget);
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
        style={{ whiteSpace: 'pre-wrap', resize: 'vertical', overflow: 'auto' }}
      />
    </div>
  );
}

export function getRichTextSelection(editor: HTMLDivElement): RichTextSelection | null {
  return resolveSelection(editor);
}
