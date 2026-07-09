'use client';

import type { EditorBlock } from '@/lib/editorBlocks';

interface EditorBlockSidebarProps {
  blocks: EditorBlock[];
  activeBlockId: string | null;
  fieldLabel: string;
  onAddBaustein: () => void;
  onBlockSelect: (blockId: string) => void;
  onDeleteBlock: (blockId: string) => void;
}

const BLOCK_ICONS: Record<EditorBlock['type'], string> = {
  baustein: '📋',
  freitext: '✏️',
};

export default function EditorBlockSidebar({
  blocks,
  activeBlockId,
  fieldLabel,
  onAddBaustein,
  onBlockSelect,
  onDeleteBlock,
}: EditorBlockSidebarProps) {
  if (blocks.length <= 1 && blocks[0]?.type === 'freitext') {
    // Nur ein Freitext-Block – Sidebar nahezu leer anzeigen (trotzdem "+" Button)
  }

  return (
    <div className="flex flex-col w-44 min-w-[11rem] border-r border-gray-200 dark:border-gray-700 pr-3 mr-3">
      {/* Header */}
      <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold mb-2 mt-1">
        Blöcke
      </div>

      {/* Block-Liste */}
      <div className="flex-1 space-y-1 overflow-y-auto">
        {blocks.map((block) => (
          <div
            key={block.id}
            className={`
              group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer text-xs
              transition-colors duration-150 select-none
              ${
                block.id === activeBlockId
                  ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 font-medium ring-1 ring-blue-300 dark:ring-blue-700'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/50'
              }
            `}
            onClick={() => onBlockSelect(block.id)}
            title={`${block.type === 'baustein' ? 'Baustein' : 'Freitext'}: ${block.name}`}
          >
            <span className="text-sm leading-none shrink-0">{BLOCK_ICONS[block.type]}</span>
            <span className="truncate flex-1">{block.name}</span>
            {block.id === activeBlockId && (
              <span className="text-[9px] text-blue-500 dark:text-blue-400 shrink-0 font-normal">
                aktiv
              </span>
            )}
            {blocks.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteBlock(block.id);
                }}
                className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-opacity text-sm leading-none shrink-0"
                title="Block entfernen"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Trennlinie + Hinzufügen-Button */}
      {blocks.length > 0 && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-2 mt-2">
          <button
            onClick={onAddBaustein}
            className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-md text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/50 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            title="Baustein für {fieldLabel} auswählen"
          >
            <span className="text-sm leading-none">+</span>
            <span>Baustein</span>
          </button>
        </div>
      )}
    </div>
  );
}
