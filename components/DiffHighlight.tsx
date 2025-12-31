"use client";
import { useState, useRef, useEffect } from 'react';
import { DiffSegment, calculateTextDiff } from '@/lib/textDiff';

interface DiffHighlightProps {
  /** The original text (after textFormatting, before LLM correction) */
  originalText: string;
  /** The LLM-corrected text */
  correctedText: string;
  /** CSS class for the container */
  className?: string;
  /** Whether to show the diff view (toggle) */
  showDiff?: boolean;
}

/**
 * Tooltip component that shows on hover
 */
function Tooltip({ 
  children, 
  content, 
  visible 
}: { 
  children: React.ReactNode; 
  content: string; 
  visible: boolean;
}) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (visible && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPosition({
        x: rect.left + rect.width / 2,
        y: rect.top - 8
      });
    }
  }, [visible]);
  
  return (
    <span ref={triggerRef} className="relative inline">
      {children}
      {visible && content && (
        <div
          ref={tooltipRef}
          className="fixed z-[100] px-2 py-1 text-xs font-mono bg-gray-900 text-white rounded shadow-lg 
                     whitespace-pre-wrap max-w-xs transform -translate-x-1/2 -translate-y-full pointer-events-none"
          style={{
            left: position.x,
            top: position.y,
          }}
        >
          <div className="text-orange-300 mb-0.5 text-[10px] uppercase tracking-wide">Original:</div>
          <div className="text-gray-100">{content}</div>
          {/* Arrow */}
          <div 
            className="absolute left-1/2 transform -translate-x-1/2 top-full w-0 h-0 
                       border-l-4 border-r-4 border-t-4 
                       border-l-transparent border-r-transparent border-t-gray-900"
          />
        </div>
      )}
    </span>
  );
}

/**
 * Single diff segment with appropriate styling and tooltip
 */
function DiffSegmentView({ segment }: { segment: DiffSegment }) {
  const [showTooltip, setShowTooltip] = useState(false);
  
  switch (segment.type) {
    case 'unchanged':
      return <span>{segment.text}</span>;
      
    case 'added':
      return (
        <span 
          className="bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-200 
                     border-b-2 border-green-400 dark:border-green-600 rounded-sm px-0.5"
          title="Neu hinzugefügt"
        >
          {segment.text}
        </span>
      );
      
    case 'removed':
      // Show a marker for removed text
      if (!segment.originalText) return null;
      return (
        <Tooltip content={segment.originalText} visible={showTooltip}>
          <span 
            className="inline-block w-3 h-3 mx-0.5 align-middle cursor-help
                       bg-red-200 dark:bg-red-900/50 rounded-full
                       border border-red-400 dark:border-red-600
                       text-red-600 dark:text-red-400 text-[8px] leading-3 text-center"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            title="Text gelöscht - hover für Original"
          >
            −
          </span>
        </Tooltip>
      );
      
    case 'modified':
      return (
        <Tooltip content={segment.originalText || ''} visible={showTooltip}>
          <span 
            className="bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-100
                       border-b-2 border-amber-400 dark:border-amber-500 rounded-sm px-0.5
                       cursor-help transition-colors hover:bg-amber-200 dark:hover:bg-amber-900/60"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
          >
            {segment.text}
          </span>
        </Tooltip>
      );
      
    default:
      return <span>{segment.text}</span>;
  }
}

/**
 * Component that displays text with diff highlighting.
 * Hover over highlighted sections to see the original text.
 */
export default function DiffHighlight({ 
  originalText, 
  correctedText, 
  className = '',
  showDiff = true
}: DiffHighlightProps) {
  const [diff, setDiff] = useState<DiffSegment[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  
  useEffect(() => {
    if (showDiff && originalText && correctedText) {
      const calculatedDiff = calculateTextDiff(originalText, correctedText);
      setDiff(calculatedDiff);
      setHasChanges(calculatedDiff.some(s => s.type !== 'unchanged'));
    } else {
      setDiff([]);
      setHasChanges(false);
    }
  }, [originalText, correctedText, showDiff]);
  
  // If diff is disabled or no changes, just show the corrected text
  if (!showDiff || !hasChanges) {
    return (
      <div className={className}>
        {correctedText}
      </div>
    );
  }
  
  return (
    <div className={className}>
      {/* Legend */}
      <div className="flex flex-wrap gap-3 mb-3 text-xs text-gray-500 dark:text-gray-400 border-b pb-2 border-gray-200 dark:border-gray-700">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 bg-amber-100 dark:bg-amber-900/40 border-b-2 border-amber-400 rounded-sm"></span>
          <span>Geändert (hover für Original)</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 bg-green-100 dark:bg-green-900/50 border-b-2 border-green-400 rounded-sm"></span>
          <span>Hinzugefügt</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 bg-red-200 dark:bg-red-900/50 border border-red-400 rounded-full text-[8px] leading-3 text-center text-red-600">−</span>
          <span>Gelöscht (hover)</span>
        </span>
      </div>
      
      {/* Diff content */}
      <div className="whitespace-pre-wrap font-mono text-sm leading-relaxed">
        {diff.map((segment, index) => (
          <DiffSegmentView key={index} segment={segment} />
        ))}
      </div>
    </div>
  );
}

/**
 * Compact diff statistics component
 */
export function DiffStats({ originalText, correctedText }: { originalText: string; correctedText: string }) {
  const [stats, setStats] = useState({ added: 0, removed: 0, modified: 0 });
  
  useEffect(() => {
    if (originalText && correctedText) {
      const diff = calculateTextDiff(originalText, correctedText);
      const newStats = { added: 0, removed: 0, modified: 0 };
      
      for (const segment of diff) {
        if (segment.type === 'added') newStats.added++;
        else if (segment.type === 'removed') newStats.removed++;
        else if (segment.type === 'modified') newStats.modified++;
      }
      
      setStats(newStats);
    }
  }, [originalText, correctedText]);
  
  const total = stats.added + stats.removed + stats.modified;
  if (total === 0) return null;
  
  return (
    <div className="flex gap-2 text-xs">
      {stats.modified > 0 && (
        <span className="text-amber-600 dark:text-amber-400">
          {stats.modified} geändert
        </span>
      )}
      {stats.added > 0 && (
        <span className="text-green-600 dark:text-green-400">
          {stats.added} hinzugefügt
        </span>
      )}
      {stats.removed > 0 && (
        <span className="text-red-600 dark:text-red-400">
          {stats.removed} gelöscht
        </span>
      )}
    </div>
  );
}
