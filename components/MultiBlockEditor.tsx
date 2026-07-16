'use client';

import type { EditorBlock } from '@/lib/editorBlocks';
import type { RichTextFormatRange, RichTextSelection } from '@/lib/richTextFormatting';
import RichTextDictationEditor from '@/components/RichTextDictationEditor';
import { type RefObject } from 'react';

interface MultiBlockEditorProps {
  blocks: EditorBlock[];
  activeBlockId: string | null;
  editorRef: RefObject<HTMLDivElement | null>;
  value: string;
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
  contradictionMode?: 'wortgetreu' | 'optionen';
  onContradictionModeChange?: (mode: 'wortgetreu' | 'optionen') => void;
  checkContradictions?: boolean;
  onCheckContradictionsChange?: (checked: boolean) => void;
  onBlockActivate: (blockId: string) => void;
  onDeleteBlock: (blockId: string) => void;
  onReorderBlocks: (blockIds: string[]) => void;
  onChange: (value: string, editor: HTMLDivElement, formats?: RichTextFormatRange[]) => void;
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
  value,
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
  checkContradictions,
  onCheckContradictionsChange,
  onBlockActivate,
  onDeleteBlock,
  onReorderBlocks,
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
          value={value}
          formats={fieldFormats}
          selection={selection}
          className={className}
          onChange={(value, editor, formats) => onChange(value, editor, formats)}
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
      {blocks.map((block, index) => {
        const isActive = block.id === activeBlockId;
        const isFirst = index === 0;
        const isLast = index === blocks.length - 1;

        const moveUp = (e: React.MouseEvent) => {
          e.stopPropagation();
          if (isFirst) return;
          const ids = blocks.map((b) => b.id);
          [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
          onReorderBlocks(ids);
        };

        const moveDown = (e: React.MouseEvent) => {
          e.stopPropagation();
          if (isLast) return;
          const ids = blocks.map((b) => b.id);
          [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
          onReorderBlocks(ids);
        };

        const copyBlock = async (e: React.MouseEvent) => {
          e.stopPropagation();
          try {
            await navigator.clipboard.writeText(block.currentText || block.originalContent);
          } catch { /* silent */ }
        };

        if (isActive) {
          return (
            <div
              key={block.id}
              className="group rounded-md border border-blue-300 dark:border-blue-700 overflow-hidden"
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
              onDrop={(e) => {
                e.preventDefault();
                const draggedId = e.dataTransfer.getData('text/plain');
                if (!draggedId || draggedId === block.id) return;
                const ids = blocks.map((b) => b.id);
                const fromIdx = ids.indexOf(draggedId);
                const toIdx = ids.indexOf(block.id);
                if (fromIdx === -1 || toIdx === -1) return;
                ids.splice(fromIdx, 1);
                ids.splice(toIdx, 0, draggedId);
                onReorderBlocks(ids);
              }}
            >
              <div
                className="flex items-center gap-1.5 px-2 py-1 bg-blue-50 dark:bg-blue-900/30 border-b border-blue-200 dark:border-blue-800 rounded-t-md cursor-grab active:cursor-grabbing"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', block.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
              >
                <span className="text-xs leading-none">{getBlockIcon(block.type)}</span>
                {block.type === 'baustein' && (
                  <>
                    <div className="flex rounded border border-emerald-300 dark:border-emerald-700 overflow-hidden shrink-0">
                      <button
                        type="button"
                        className={`px-1 py-0.5 text-[9px] transition-colors ${
                          (contradictionMode ?? 'wortgetreu') === 'wortgetreu'
                            ? 'bg-emerald-600 text-white'
                            : 'text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-800/40'
                        }`}
                        onClick={() => onContradictionModeChange?.('wortgetreu')}
                        title="Diktierten Text möglichst genau übernehmen"
                      >
                        wortgetreu
                      </button>
                      <button
                        type="button"
                        className={`px-1 py-0.5 text-[9px] transition-colors ${
                          contradictionMode === 'optionen'
                            ? 'bg-emerald-600 text-white'
                            : 'text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-800/40'
                        }`}
                        onClick={() => onContradictionModeChange?.('optionen')}
                        title="Nur aus [Optionen] im Baustein auswählen"
                      >
                        optionen
                      </button>
                    </div>
                    <label className="flex items-center gap-0.5 text-[9px] text-emerald-600 dark:text-emerald-400 cursor-pointer select-none shrink-0">
                      <input
                        type="checkbox"
                        checked={!!checkContradictions}
                        onChange={(e) => onCheckContradictionsChange?.(e.target.checked)}
                        className="rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500 dark:border-emerald-700 w-2.5 h-2.5"
                      />
                      Widerspruchsprüfung
                    </label>
                  </>
                )}
                <span className="text-[11px] font-medium text-blue-700 dark:text-blue-300 truncate flex-1">
                  {block.name}
                </span>
                <span className="text-[10px] text-blue-500 dark:text-blue-400 bg-blue-100 dark:bg-blue-800/50 px-1.5 py-0.5 rounded-full">
                  aktiv
                </span>
                <button
                  onClick={moveUp}
                  disabled={isFirst}
                  className="opacity-0 group-hover:opacity-100 px-0.5 text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 transition-opacity text-xs leading-none shrink-0 disabled:opacity-0 disabled:pointer-events-none"
                  title="Nach oben verschieben"
                >
                  ▲
                </button>
                <button
                  onClick={moveDown}
                  disabled={isLast}
                  className="opacity-0 group-hover:opacity-100 px-0.5 text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 transition-opacity text-xs leading-none shrink-0 disabled:opacity-0 disabled:pointer-events-none"
                  title="Nach unten verschieben"
                >
                  ▼
                </button>
                <button
                  onClick={copyBlock}
                  className="px-1 text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 text-[10px] leading-none shrink-0"
                  title="Blocktext kopieren"
                >
                  📋
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`"${block.name}" wirklich löschen?`)) {
                      onDeleteBlock(block.id);
                    }
                  }}
                  className="opacity-0 group-hover:opacity-100 text-blue-400 hover:text-red-500 dark:hover:text-red-400 transition-opacity text-sm leading-none shrink-0"
                  title="Block löschen"
                >
                  ×
                </button>
              </div>
              <RichTextDictationEditor
                editorRef={editorRef}
                value={block.currentText}
                formats={block.formatRanges}
                selection={selection}
                className={className}
                onChange={(value, editor, formats) => onChange(value, editor, formats)}
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

        // Inactive block: greyed-out preview with click-to-activate, delete & drag
        return (
          <div
            key={block.id}
            className="group rounded-md border border-gray-200 dark:border-gray-700 opacity-35 select-none hover:opacity-50 transition-opacity"
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
            onDrop={(e) => {
              e.preventDefault();
              const draggedId = e.dataTransfer.getData('text/plain');
              if (!draggedId || draggedId === block.id) return;
              const ids = blocks.map((b) => b.id);
              const fromIdx = ids.indexOf(draggedId);
              const toIdx = ids.indexOf(block.id);
              if (fromIdx === -1 || toIdx === -1) return;
              ids.splice(fromIdx, 1);
              ids.splice(toIdx, 0, draggedId);
              onReorderBlocks(ids);
            }}
          >
            <div
              className="flex items-center gap-1.5 px-2 py-1 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 rounded-t-md cursor-grab active:cursor-grabbing"
              onClick={() => onBlockActivate(block.id)}
              title={`"${block.name}" aktivieren`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', block.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
            >
              <span className="text-xs leading-none">{getBlockIcon(block.type)}</span>
              <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400 truncate flex-1">
                {block.name}
              </span>
              <button
                onClick={moveUp}
                disabled={isFirst}
                className="opacity-0 group-hover:opacity-100 px-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-opacity text-xs leading-none shrink-0 disabled:opacity-0 disabled:pointer-events-none"
                title="Nach oben verschieben"
              >
                ▲
              </button>
              <button
                onClick={moveDown}
                disabled={isLast}
                className="opacity-0 group-hover:opacity-100 px-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-opacity text-xs leading-none shrink-0 disabled:opacity-0 disabled:pointer-events-none"
                title="Nach unten verschieben"
              >
                ▼
              </button>
              <button
                onClick={copyBlock}
                className="px-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-[10px] leading-none shrink-0"
                title="Blocktext kopieren"
              >
                📋
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`"${block.name}" wirklich löschen?`)) {
                    onDeleteBlock(block.id);
                  }
                }}
                className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-opacity text-sm leading-none shrink-0"
                title="Block löschen"
              >
                ×
              </button>
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
