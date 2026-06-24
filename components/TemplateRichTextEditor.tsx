"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import RichTextDictationEditor, { getRichTextSelection } from './RichTextDictationEditor';
import {
  getRichTextSelectionBounds,
  isRichTextFormatActiveAcrossSelection,
  normalizeRichTextRanges,
  remapRichTextRanges,
  setRichTextFormatForSelection,
  type RichTextFormatRange,
  type RichTextSelection,
} from '@/lib/richTextFormatting';

type RichTextFormatKey = 'bold' | 'italic' | 'underline';

interface TemplateRichTextEditorProps {
  value: string;
  formats: RichTextFormatRange[];
  onChange: (value: string, formats: RichTextFormatRange[]) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

function getDefaultSelection(text: string): RichTextSelection {
  return {
    start: text.length,
    end: text.length,
    direction: 'none',
  };
}

export default function TemplateRichTextEditor({
  value,
  formats,
  onChange,
  placeholder,
  className = 'textarea w-full text-sm min-h-[100px]',
  disabled = false,
}: TemplateRichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const valueRef = useRef(value);
  const formatsRef = useRef(formats);
  const [selection, setSelection] = useState<RichTextSelection | null>(null);
  const selectionRef = useRef<RichTextSelection | null>(null);
  const [toggles, setToggles] = useState<Record<RichTextFormatKey, boolean>>({
    bold: false,
    italic: false,
    underline: false,
  });
  const togglesRef = useRef(toggles);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    formatsRef.current = formats;
  }, [formats]);

  useEffect(() => {
    togglesRef.current = toggles;
  }, [toggles]);

  const syncSelection = useCallback((nextSelection: RichTextSelection | null) => {
    selectionRef.current = nextSelection;
    setSelection(nextSelection);
  }, []);

  const handleSelectionChange = useCallback((editor: HTMLDivElement) => {
    syncSelection(getRichTextSelection(editor) ?? getDefaultSelection(valueRef.current));
  }, [syncSelection]);

  const handleEditorChange = useCallback((nextValue: string, editor: HTMLDivElement) => {
    const previousText = valueRef.current;
    const previousFormats = formatsRef.current;
    const previousSelection = selectionRef.current ?? getDefaultSelection(previousText);
    const nextSelection = getRichTextSelection(editor) ?? getDefaultSelection(nextValue);
    const replacedLength = Math.max(0, previousSelection.end - previousSelection.start);
    const insertedLength = Math.max(0, nextValue.length - (previousText.length - replacedLength));
    const insertedStart = Math.max(0, Math.min(previousSelection.start, nextValue.length));
    const insertedEnd = Math.max(insertedStart, Math.min(insertedStart + insertedLength, nextValue.length));

    let nextFormats = remapRichTextRanges(previousText, nextValue, previousFormats);

    if (insertedEnd > insertedStart) {
      (Object.keys(togglesRef.current) as RichTextFormatKey[]).forEach((key) => {
        if (!togglesRef.current[key]) return;
        nextFormats = setRichTextFormatForSelection(nextFormats, nextValue.length, insertedStart, insertedEnd, key, true);
      });
    }

    valueRef.current = nextValue;
    formatsRef.current = nextFormats;
    syncSelection(nextSelection);
    onChange(nextValue, nextFormats);
  }, [onChange, syncSelection]);

  const handleToolbarAction = useCallback((key: RichTextFormatKey) => {
    const currentValue = valueRef.current;
    const liveSelection = editorRef.current ? getRichTextSelection(editorRef.current) : null;
    const nextSelection = liveSelection ?? selectionRef.current ?? getDefaultSelection(currentValue);
    const { start, end } = getRichTextSelectionBounds(nextSelection);

    syncSelection(nextSelection);

    if (end > start) {
      const enabled = !isRichTextFormatActiveAcrossSelection(formatsRef.current, start, end, key);
      const nextFormats = setRichTextFormatForSelection(formatsRef.current, currentValue.length, start, end, key, enabled);
      formatsRef.current = nextFormats;
      onChange(currentValue, nextFormats);
      return;
    }

    setToggles((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }, [onChange, syncSelection]);

  const buttons = useMemo<Array<{ key: RichTextFormatKey; label: string; className: string; title: string }>>(() => ([
    { key: 'bold', label: 'B', className: 'font-bold', title: 'Fett' },
    { key: 'italic', label: 'I', className: 'italic', title: 'Kursiv' },
    { key: 'underline', label: 'U', className: 'underline', title: 'Unterstrichen' },
  ]), []);

  const getButtonActive = useCallback((key: RichTextFormatKey) => {
    const currentValue = valueRef.current;
    const currentSelection = selectionRef.current ?? getDefaultSelection(currentValue);
    const { start, end } = getRichTextSelectionBounds(currentSelection);

    if (end > start) {
      return isRichTextFormatActiveAcrossSelection(formatsRef.current, start, end, key);
    }

    return togglesRef.current[key];
  }, []);

  useEffect(() => {
    if (value.length === 0) {
      syncSelection(null);
      setToggles({ bold: false, italic: false, underline: false });
    }
  }, [syncSelection, value.length]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        {buttons.map((button) => {
          const active = getButtonActive(button.key);
          return (
            <button
              key={button.key}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                handleToolbarAction(button.key);
              }}
              disabled={disabled}
              className={`inline-flex h-7 w-7 items-center justify-center rounded border text-xs transition ${active
                ? 'border-blue-500 bg-blue-100 text-blue-700 dark:border-blue-400 dark:bg-blue-900/40 dark:text-blue-200'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'} disabled:cursor-not-allowed disabled:opacity-50`}
              title={button.title}
              aria-pressed={active}
            >
              <span className={button.className}>{button.label}</span>
            </button>
          );
        })}
      </div>

      <RichTextDictationEditor
        editorRef={editorRef}
        value={value}
        formats={normalizeRichTextRanges(formats, value.length)}
        selection={selection}
        className={className}
        placeholder={placeholder}
        readOnly={disabled}
        onChange={handleEditorChange}
        onSelectionChange={handleSelectionChange}
      />
    </div>
  );
}