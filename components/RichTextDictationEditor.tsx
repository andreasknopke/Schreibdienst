"use client";

import { useEffect, useMemo, useRef } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $isElementNode,
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  INSERT_LINE_BREAK_COMMAND,
  KEY_ENTER_COMMAND,
  type LexicalNode,
  LineBreakNode,
  ParagraphNode,
  TextNode,
} from 'lexical';
import {
  buildRichTextHtml,
  buildRichTextSegments,
  type RichTextFormatRange,
  type RichTextSelection,
} from '@/lib/richTextFormatting';

interface RichTextDictationEditorProps {
  editorRef: React.RefObject<HTMLDivElement | null>;
  value: string;
  formats: RichTextFormatRange[];
  selection?: RichTextSelection | null;
  className?: string;
  placeholder?: string;
  readOnly?: boolean;
  onChange: (value: string, editor: HTMLDivElement, formats?: RichTextFormatRange[]) => void;
  onSelectionChange: (editor: HTMLDivElement) => void;
  onFocus?: (editor: HTMLDivElement) => void;
  onBlur?: () => void;
  onWordDoubleClick?: (info: { word: string; start: number; end: number; clientX: number; clientY: number }, editor: HTMLDivElement) => void;
}

interface LastAppliedState {
  value: string;
  formatSignature: string;
}

const lexicalTheme = {
  text: {
    bold: 'font-bold',
    italic: 'italic',
    underline: 'underline',
    strikethrough: 'line-through',
    underlineStrikethrough: 'underline line-through',
  },
};

function getEditorText(editor: HTMLDivElement): string {
  return editor.textContent ?? '';
}

function isLineBreakDomNode(node: Node): node is HTMLBRElement {
  return node instanceof HTMLBRElement;
}

function getLogicalNodeLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.length ?? 0;
  }

  if (isLineBreakDomNode(node)) {
    return 1;
  }

  let total = 0;
  node.childNodes.forEach((childNode) => {
    total += getLogicalNodeLength(childNode);
  });
  return total;
}

function getOffsetBeforeNode(root: HTMLDivElement, targetNode: Node): number {
  let offset = 0;
  let currentNode: Node | null = targetNode;

  while (currentNode && currentNode !== root) {
    let sibling = currentNode.previousSibling;
    while (sibling) {
      offset += getLogicalNodeLength(sibling);
      sibling = sibling.previousSibling;
    }
    currentNode = currentNode.parentNode;
  }

  return offset;
}

function getOffsetWithinElement(targetNode: Node, targetOffset: number): number {
  let offset = 0;
  const childNodes = Array.from(targetNode.childNodes);

  for (let index = 0; index < Math.min(targetOffset, childNodes.length); index += 1) {
    offset += getLogicalNodeLength(childNodes[index]);
  }

  return offset;
}

function getNodeOffset(root: HTMLDivElement, targetNode: Node, targetOffset: number): number {
  if (targetNode === root) {
    return getOffsetWithinElement(root, targetOffset);
  }

  const baseOffset = getOffsetBeforeNode(root, targetNode);

  if (targetNode.nodeType === Node.TEXT_NODE) {
    const textLength = targetNode.textContent?.length ?? 0;
    return baseOffset + Math.min(targetOffset, textLength);
  }

  return baseOffset + getOffsetWithinElement(targetNode, targetOffset);
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
  function visit(node: Node, traversed: number): { node: Node; offset: number; traversed: number } | null {
    if (node.nodeType === Node.TEXT_NODE) {
      const textLength = node.textContent?.length ?? 0;
      // targetOffset liegt in diesem Text-Node
      if (targetOffset < traversed + textLength) {
        return {
          node,
          offset: Math.max(0, targetOffset - traversed),
          traversed,
        };
      }
      // targetOffset liegt EXAKT am Ende dieses Text-Nodes
      if (targetOffset === traversed + textLength) {
        return {
          node,
          offset: textLength,
          traversed,
        };
      }
      // targetOffset liegt dahinter → weitersuchen (kein return null!)
      // Fall-through zum Geschwister-Loop
    }

    if (isLineBreakDomNode(node)) {
      if (targetOffset <= traversed) {
        // Cursor vor oder auf diesem <br> → Position davor
        const parentNode = node.parentNode;
        if (!parentNode) {
          return null;
        }
        const siblingIndex = Array.from(parentNode.childNodes).indexOf(node);
        return { node: parentNode, offset: siblingIndex, traversed };
      }
      if (targetOffset === traversed + 1) {
        // Cursor genau nach diesem <br>
        const parentNode = node.parentNode;
        if (!parentNode) {
          return null;
        }
        const siblingIndex = Array.from(parentNode.childNodes).indexOf(node);
        return { node: parentNode, offset: siblingIndex + 1, traversed };
      }
      // targetOffset liegt weiter dahinter → weitersuchen
    }

    // Für Nicht-Blatt-Knoten: Kinder durchgehen
    let childTraversed = traversed;
    for (const childNode of Array.from(node.childNodes)) {
      const childLength = getLogicalNodeLength(childNode);
      // Nur in Kind eintauchen, wenn targetOffset in dessen Bereich liegt
      if (targetOffset <= childTraversed + childLength) {
        const result = visit(childNode, childTraversed);
        if (result) {
          return result;
        }
        // Kein Treffer → nächsten Geschwister versuchen
      }
      childTraversed += childLength;
    }

    // Nichts gefunden in diesem Unterbaum
    return null;
  }

  const result = visit(root, 0);
  if (result) {
    return { node: result.node, offset: result.offset };
  }

  // Fallback: ans Ende des letzten Kindes
  if (root.lastChild) {
    const lastNode = root.lastChild;
    if (isLineBreakDomNode(lastNode) && lastNode.parentNode) {
      const siblingIndex = Array.from(lastNode.parentNode.childNodes).indexOf(lastNode);
      return { node: lastNode.parentNode, offset: siblingIndex + 1 };
    }
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

function applySegmentFormatting(node: TextNode, segment: RichTextFormatRange) {
  if (segment.bold) {
    node.toggleFormat('bold');
  }
  if (segment.italic) {
    node.toggleFormat('italic');
  }
  if (segment.underline) {
    node.toggleFormat('underline');
  }
}

function writeContentToEditor(value: string, formats: RichTextFormatRange[]) {
  const root = $getRoot();
  root.clear();

  const paragraph = $createParagraphNode();
  const segments = buildRichTextSegments(value, formats);

  if (segments.length === 0) {
    paragraph.append($createTextNode(''));
    root.append(paragraph);
    return;
  }

  for (const segment of segments) {
    const fragments = segment.text.split('\n');
    for (let index = 0; index < fragments.length; index += 1) {
      const fragment = fragments[index];
      if (fragment) {
        const textNode = $createTextNode(fragment);
        applySegmentFormatting(textNode, segment);
        paragraph.append(textNode);
      }

      if (index < fragments.length - 1) {
        paragraph.append($createLineBreakNode());
      }
    }
  }

  root.append(paragraph);
}

function extractTextAndFormatsFromLexicalNode(
  node: LexicalNode,
  state: { text: string; formats: RichTextFormatRange[] },
) {
  if (node instanceof TextNode) {
    const text = node.getTextContent();
    if (!text) {
      return;
    }

    const start = state.text.length;
    state.text += text;
    const end = state.text.length;

    if (node.hasFormat('bold') || node.hasFormat('italic') || node.hasFormat('underline')) {
      state.formats.push({
        start,
        end,
        bold: node.hasFormat('bold') || undefined,
        italic: node.hasFormat('italic') || undefined,
        underline: node.hasFormat('underline') || undefined,
      });
    }
    return;
  }

  if (node instanceof LineBreakNode) {
    state.text += '\n';
    return;
  }

  const children = $isElementNode(node) ? node.getChildren() : [];
  children.forEach((child) => extractTextAndFormatsFromLexicalNode(child, state));

  if (node instanceof ParagraphNode) {
    state.text += '\n';
  }
}

function extractTextAndFormatsFromEditor(): { text: string; formats: RichTextFormatRange[] } {
  const root = $getRoot();
  const state = { text: '', formats: [] as RichTextFormatRange[] };
  const children = root.getChildren();

  children.forEach((child, index) => {
    extractTextAndFormatsFromLexicalNode(child, state);
    if (child instanceof ParagraphNode && index === children.length - 1 && state.text.endsWith('\n')) {
      state.text = state.text.slice(0, -1);
    }
  });

  return {
    text: state.text,
    formats: state.formats,
  };
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

function RootBindingPlugin({
  editorRef,
  readOnly,
}: {
  editorRef: React.RefObject<HTMLDivElement | null>;
  readOnly: boolean;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  useEffect(() => {
    return editor.registerRootListener((rootElement) => {
      editorRef.current = rootElement as HTMLDivElement | null;
    });
  }, [editor, editorRef]);

  return null;
}

function ExternalStateSyncPlugin({
  value,
  formats,
  selection,
  lastAppliedRef,
  suppressOnChangeRef,
}: {
  value: string;
  formats: RichTextFormatRange[];
  selection?: RichTextSelection | null;
  lastAppliedRef: React.MutableRefObject<LastAppliedState>;
  suppressOnChangeRef: React.MutableRefObject<boolean>;
}) {
  const [editor] = useLexicalComposerContext();
  const formatSignature = useMemo(() => JSON.stringify(formats), [formats]);

  useEffect(() => {
    const lastApplied = lastAppliedRef.current;
    if (lastApplied.value === value && lastApplied.formatSignature === formatSignature) {
      const rootElement = editor.getRootElement() as HTMLDivElement | null;
      if (rootElement) {
        restoreSelection(rootElement, selection);
      }
      return;
    }

    suppressOnChangeRef.current = true;
    editor.update(() => {
      writeContentToEditor(value, formats);
    });
    lastAppliedRef.current = { value, formatSignature };

    queueMicrotask(() => {
      const rootElement = editor.getRootElement() as HTMLDivElement | null;
      if (rootElement) {
        restoreSelection(rootElement, selection);
      }
    });
  }, [editor, formatSignature, formats, lastAppliedRef, selection, suppressOnChangeRef, value]);

  return null;
}

function EnterKeyPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        event?.preventDefault();
        editor.dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor]);

  return null;
}

function EditorSurface({
  className,
  placeholder,
  value,
  formats,
  onSelectionChange,
  onFocus,
  onBlur,
  onWordDoubleClick,
}: {
  className: string;
  placeholder?: string;
  value: string;
  formats: RichTextFormatRange[];
  onSelectionChange: (editor: HTMLDivElement) => void;
  onFocus?: (editor: HTMLDivElement) => void;
  onBlur?: () => void;
  onWordDoubleClick?: (info: { word: string; start: number; end: number; clientX: number; clientY: number }, editor: HTMLDivElement) => void;
}) {
  const [editor] = useLexicalComposerContext();

  return (
    <RichTextPlugin
      contentEditable={
        <ContentEditable
          className={className}
          onFocus={(event) => onFocus?.(event.currentTarget)}
          onBlur={onBlur}
          onKeyUp={(event) => onSelectionChange(event.currentTarget)}
          onMouseUp={(event) => onSelectionChange(event.currentTarget)}
          onClick={(event) => onSelectionChange(event.currentTarget)}
          onDoubleClick={(event) => {
            if (!onWordDoubleClick) return;
            const rootElement = event.currentTarget;
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return;
            const range = sel.getRangeAt(0);
            if (!rootElement.contains(range.startContainer) || !rootElement.contains(range.endContainer)) return;
            const word = sel.toString().trim();
            if (!word || /[\s]/.test(word)) return;
            const start = getNodeOffset(rootElement, range.startContainer, range.startOffset);
            const end = getNodeOffset(rootElement, range.endContainer, range.endOffset);
            onWordDoubleClick({ word, start, end, clientX: event.clientX, clientY: event.clientY }, rootElement);
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
          spellCheck={false}
          style={{ whiteSpace: 'pre-wrap', resize: 'vertical', overflow: 'auto' }}
        />
      }
      placeholder={
        placeholder ? (
          <div className="pointer-events-none absolute left-3 top-3 text-sm text-gray-400 dark:text-gray-500">
            {placeholder}
          </div>
        ) : null
      }
      ErrorBoundary={LexicalErrorBoundary}
    />
  );
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
  const lastAppliedRef = useRef<LastAppliedState>({ value: '', formatSignature: '[]' });
  const suppressOnChangeRef = useRef(false);
  const formatSignature = useMemo(() => JSON.stringify(formats), [formats]);
  const initialConfig = useMemo(() => ({
    namespace: 'schreibdienst-rich-text',
    onError: (error: Error) => {
      throw error;
    },
    theme: lexicalTheme,
    editable: !readOnly,
    nodes: [ParagraphNode, TextNode, LineBreakNode],
    editorState: () => {
      writeContentToEditor(value, formats);
      lastAppliedRef.current = { value, formatSignature };
    },
  }), [formatSignature, formats, readOnly, value]);

  return (
    <div className="relative">
      <div
        className="pointer-events-none absolute bottom-2 right-2 z-10 h-3 w-3 opacity-70"
        style={{
          backgroundImage: 'linear-gradient(135deg, transparent 0 42%, currentColor 42% 50%, transparent 50% 64%, currentColor 64% 72%, transparent 72% 100%)',
        }}
      />
      <LexicalComposer initialConfig={initialConfig}>
        <RootBindingPlugin editorRef={editorRef} readOnly={readOnly} />
        <ExternalStateSyncPlugin
          value={value}
          formats={formats}
          selection={selection}
          lastAppliedRef={lastAppliedRef}
          suppressOnChangeRef={suppressOnChangeRef}
        />
        <EnterKeyPlugin />
        <HistoryPlugin />
        <OnChangePlugin
          ignoreSelectionChange={true}
          onChange={(editorState, editor) => {
            if (suppressOnChangeRef.current) {
              suppressOnChangeRef.current = false;
              return;
            }

            const rootElement = editor.getRootElement() as HTMLDivElement | null;
            if (!rootElement) {
              return;
            }

            const nextState = editorState.read(() => extractTextAndFormatsFromEditor());
            lastAppliedRef.current = { value: nextState.text, formatSignature: JSON.stringify(nextState.formats) };
            onChange(nextState.text, rootElement, nextState.formats);
          }}
        />
        <EditorSurface
          className={className}
          placeholder={placeholder}
          value={value}
          formats={formats}
          onSelectionChange={onSelectionChange}
          onFocus={onFocus}
          onBlur={onBlur}
          onWordDoubleClick={onWordDoubleClick}
        />
      </LexicalComposer>
    </div>
  );
}

export function getRichTextSelection(editor: HTMLDivElement): RichTextSelection | null {
  return resolveSelection(editor);
}
