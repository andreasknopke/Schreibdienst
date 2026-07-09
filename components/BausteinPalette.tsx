'use client';

interface BausteinPaletteProps {
  templates: Array<{ id: number; name: string; content: string }>;
  onAddBaustein: (template: { id: number; name: string; content: string }) => void;
  onClose: () => void;
}

export default function BausteinPalette({
  templates,
  onAddBaustein,
  onClose,
}: BausteinPaletteProps) {
  return (
    <div
      className="
        overflow-y-auto rounded-r-xl border
        border-gray-200 dark:border-gray-700
        bg-white/95 dark:bg-gray-900/95
        shadow-2xl backdrop-blur-sm
        pointer-events-auto
        w-60
      "
      style={{ maxHeight: '70vh' }}
    >
      <div className="px-3 py-2.5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-800 dark:text-gray-200">
          Verfügbare Bausteine
        </h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-base leading-none"
          title="Schliessen"
        >
          ✕
        </button>
      </div>

      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {templates.length === 0 && (
          <div className="px-3 py-4 text-xs text-gray-400 dark:text-gray-500 text-center">
            Keine Bausteine für dieses Feld.
          </div>
        )}
        {templates.map((tpl) => (
          <button
            key={tpl.id}
            onClick={() => onAddBaustein(tpl)}
            className="w-full text-left px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors flex items-start gap-2"
            title={`"${tpl.name}" einfügen`}
          >
            <span className="text-sm leading-none mt-0.5 shrink-0">📋</span>
            <div className="min-w-0">
              <div className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">
                {tpl.name}
              </div>
              <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 line-clamp-2 leading-relaxed">
                {tpl.content.substring(0, 120)}
                {tpl.content.length > 120 ? '…' : ''}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
