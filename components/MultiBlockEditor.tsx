'use client';

import type { EditorBlock } from '@/lib/editorBlocks';
import type { RichTextFormatRange, RichTextSelection } from '@/lib/richTextFormatting';
import RichTextDictationEditor from '@/components/RichTextDictationEditor';
import { type RefObject } from 'react';

interface MultiBlockEditorProps {
  blocks: EditorBlock[];
  activeBlockId: string | null;
  editorRef: RefObject<HTMLDivElement | null>;
  /** Global field-level format ranges (used for the active block). */
  fieldFormats: RichTextFormatRange[];
  selection: RichTextSelection | null;
  className: string;
  isProcessing: boolean;
  recording: boolean;
  focused: boolean;
  showPersistentCaret: boolean;
  caretPosition: { top: number; left: number; height: number; visible: boolean };
  placeholder: string;
  contradictionMode?: 'genau' | 'einfach' | 'aus' | 'optionen';
  onContradictionModeChange?: (mode: 'genau' | 'einfach' | 'aus' | 'optionen') => void;
  onBlockActivate: (blockId: string) => void;
  onChange: (value: string, editor: HTMLDivElement) => void;
  onFocus: (editor: HTMLDivElement) => void;
  onBlur: () => void;
  onSelectionChange: (editor: HTMLDivElement) => void;
  onWordDoubleClick: (info: { word: string; start: number; end: number; clientX: number; clientY: number }, editor: HTMLDivElement) => void;
}

function getBlockIcon(type: EditorBlock['type']): string {
  return type === 'baustein' ? '📋' : '✏️';
}

export default function MultiBlockEditor({
  blocks,
  activeBlockId,
  editorRef,
  fieldFormats,
  selection,
  className,
  isProcessing,
  recording,
  focused,
  showPersistentCaret,
  caretPosition,
  placeholder,
  contradictionMode,
  onContradictionModeChange,
  onBlockActivate,
  onChange,
  onFocus,
  onBlur,
  onSelectionChange,
  onWordDoubleClick,
}: MultiBlockEditorProps) {
  // When only one freitext block exists: render the normal single editor
  const needsMultiBlock = blocks.length > 1 || blocks.some((b) => b.type === 'baustein');

  if (!needsMultiBlock) {
    return (
      <div className="relative">
        <RichTextDictationEditor
          editorRef={editorRef}
          value={blocks[0]?.currentText ?? ''}
          formats={fieldFormats}
          selection={selection}
          className={className}
          onChange={onChange}
          onFocus={onFocus}
          onBlur={onBlur}
          onSelectionChange={onSelectionChange}
          onWordDoubleClick={onWordDoubleClick}
          placeholder={placeholder}
          readOnly={isProcessing}
        />
        {showPersistentCaret && !focused && caretPosition.visible && (
          <div
            className="pointer-events-none absolute w-0.5 rounded-full bg-blue-500/80"
            style={{ top: caretPosition.top, left: caretPosition.left, height: caretPosition.height }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="relative space-y-1">
      {blocks.map((block) => {
        const isActive = block.id === activeBlockId;

        if (isActive) {
          return (
            <div key={block.id} className="rounded-md border border-blue-300 dark:border-blue-700 overflow-hidden">
              <div className="flex items-center gap-1.5 px-2 py-1 bg-blue-50 dark:bg-blue-900/30 border-b border-blue-200 dark:border-blue-800 rounded-t-md">
                <span className="text-xs leading-none">{getBlockIcon(block.type)}</span>
                <span className="text-[11px] font-medium text-blue-700 dark:text-blue-300 truncate flex-1">
                  {block.name}
                </span>
                <span className="text-[10px] text-blue-500 dark:text-blue-400 bg-blue-100 dark:bg-blue-800/50 px-1.5 py-0.5 rounded-full">
                  aktiv
                </span>
              </div>
              {/* Baustein-Indikator + Widerspruchs-Modus (nur bei Baustein-Blöcken) */}
              {block.type === 'baustein' && (
                <div className="px-2 py-1.5 bg-emerald-50/70 dark:bg-emerald-900/20 border-b border-blue-100 dark:border-blue-800/50">
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-300 italic leading-tight">
                    Neue Audio-Transkripte werden direkt in diesen Baustein eingearbeitet.
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium whitespace-nowrap">Widersprüche:</span>
                    <div className="flex rounded border border-emerald-300 dark:border-emerald-700 overflow-hidden">
                      {(['aus', 'einfach', 'genau', 'optionen'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          className={`px-1.5 py-0.5 text-[10px] transition-colors ${
                            (contradictionMode ?? 'genau') === mode
                              ? 'bg-emerald-600 text-white'
                              : 'text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-800/40'
                          }`}
                          onClick={() => onContradictionModeChange?.(mode)}
                          title={
                            mode === 'genau' ? 'Ausführliche Widerspruchsprüfung inkl. Beispiele'
                            : mode === 'einfach' ? 'Verkürzte Widerspruchsprüfung'
                            : mode === 'optionen' ? 'Aus [Optionen] im Baustein-Text auswählen'
                            : 'Keine Widerspruchsprüfung'
                          }
                        >
                          {mode === 'aus' ? 'Aus' : mode === 'einfach' ? 'Einfach' : mode === 'genau' ? 'Genau' : 'Optionen'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <RichTextDictationEditor
                editorRef={editorRef}
                value={block.currentText}
                formats={fieldFormats}
                selection={selection}
                className={className}
                onChange={onChange}
                onFocus={onFocus}
                onBlur={onBlur}
                onSelectionChange={onSelectionChange}
                onWordDoubleClick={onWordDoubleClick}
                placeholder={placeholder}
                readOnly={isProcessing}
              />
            </div>
          );
        }

        // Inactive block: greyed-out preview with click-to-activate
        return (
          <div
            key={block.id}
            className="rounded-md border border-gray-200 dark:border-gray-700 opacity-35 select-none cursor-pointer hover:opacity-50 transition-opacity"
            onClick={() => onBlockActivate(block.id)}
            title={`"${block.name}" aktivieren`}
          >
            <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 rounded-t-md">
              <span className="text-xs leading-none">{getBlockIcon(block.type)}</span>
              <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400 truncate flex-1">
                {block.name}
              </span>
              <span className="text-[10px] text-gray-400 dark:text-gray-500">—</span>
            </div>
            <div className="px-3 py-2 text-sm text-gray-400 dark:text-gray-600 font-mono whitespace-pre-wrap line-clamp-3 pointer-events-none">
              {block.currentText || '(leer)'}
            </div>
          </div>
        );
      })}
      {showPersistentCaret && !focused && caretPosition.visible && (
        <div
          className="pointer-events-none absolute w-0.5 rounded-full bg-blue-500/80"
          style={{ top: caretPosition.top, left: caretPosition.left, height: caretPosition.height }}
        />
      )}
    </div>
  );
}
