"use client";
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { diffWordsWithSpace } from 'diff';

// Word with timestamp for highlighting
interface TimestampedWord {
  word: string;
  start: number;
  end: number;
  isInterpolated?: boolean;
}

// Segment interface for word-level highlighting
interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  words?: {
    word: string;
    start: number;
    end: number;
  }[];
}

// Diff types for word marking
type DiffType = 'unchanged' | 'added' | 'removed' | 'manual';

interface WordWithDiff {
  word: string;
  diffType: DiffType;
  timestamp?: { start: number; end: number; isInterpolated?: boolean };
}

interface EditableTextWithMitlesenProps {
  // Text content
  text: string; // Current text (after LLM + manual edits)
  originalText: string; // Raw transcript before LLM (for diff)
  savedText: string; // Last saved version (to detect manual changes)
  onChange: (newText: string) => void;
  
  // Audio playback
  originalSegments: TranscriptSegment[];
  audioCurrentTime: number;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  
  // Display options
  showDiff?: boolean;
  showMitlesen?: boolean;
  className?: string;
  disabled?: boolean;
}

/**
 * Maps timestamps from original transcription to any text using word matching.
 */
function mapTimestampsToText(
  originalSegments: TranscriptSegment[],
  text: string
): TimestampedWord[] {
  // Extract all words with timestamps from original segments
  const originalWords: { word: string; start: number; end: number }[] = [];
  for (const segment of originalSegments) {
    if (segment.words) {
      for (const word of segment.words) {
        if (word.start !== undefined && word.end !== undefined) {
          originalWords.push({
            word: word.word.toLowerCase().replace(/[.,!?;:"""„''()\[\]]/g, ''),
            start: word.start,
            end: word.end
          });
        }
      }
    }
  }
  
  if (originalWords.length === 0) {
    return [];
  }
  
  const textWords = text.split(/\s+/).filter(w => w.length > 0);
  const result: TimestampedWord[] = [];
  
  let origIdx = 0;
  const audioDuration = originalWords.length > 0 
    ? originalWords[originalWords.length - 1].end 
    : 0;
  
  for (let i = 0; i < textWords.length; i++) {
    const word = textWords[i];
    const wordNorm = word.toLowerCase().replace(/[.,!?;:"""„''()\[\]]/g, '');
    
    // Look for matching word with lookahead
    let foundMatch = false;
    const maxLookahead = Math.min(8, originalWords.length - origIdx);
    
    for (let lookahead = 0; lookahead < maxLookahead; lookahead++) {
      const checkIdx = origIdx + lookahead;
      if (checkIdx < originalWords.length) {
        const origWord = originalWords[checkIdx];
        
        if (origWord.word === wordNorm || 
            origWord.word.includes(wordNorm) || 
            wordNorm.includes(origWord.word) ||
            (wordNorm.length > 3 && origWord.word.length > 3 && 
             (origWord.word.startsWith(wordNorm.slice(0, 3)) || wordNorm.startsWith(origWord.word.slice(0, 3))))) {
          result.push({
            word: word,
            start: origWord.start,
            end: origWord.end,
            isInterpolated: false
          });
          origIdx = checkIdx + 1;
          foundMatch = true;
          break;
        }
      }
    }
    
    if (!foundMatch) {
      const prevEnd = result.length > 0 ? result[result.length - 1].end : 0;
      const nextStart = origIdx < originalWords.length 
        ? originalWords[origIdx].start 
        : audioDuration;
      
      const wordDuration = Math.min(0.4, (nextStart - prevEnd) * 0.6);
      
      result.push({
        word: word,
        start: prevEnd,
        end: prevEnd + wordDuration,
        isInterpolated: true
      });
    }
  }
  
  return result;
}

/**
 * Computes word-level diff with timestamps
 */
function computeDiffWithTimestamps(
  originalText: string,
  correctedText: string,
  savedText: string,
  timestampedWords: TimestampedWord[]
): WordWithDiff[] {
  const result: WordWithDiff[] = [];
  
  // First: diff original vs corrected (LLM changes)
  const llmDiffs = diffWordsWithSpace(originalText, correctedText);
  
  // Then: diff savedText vs correctedText (manual changes since last save)
  const manualDiffs = diffWordsWithSpace(savedText, correctedText);
  
  // Build a set of manually added words
  const manualAddedWords = new Set<string>();
  for (const diff of manualDiffs) {
    if (diff.added && diff.value) {
      const words = diff.value.trim().split(/\s+/);
      words.forEach(w => manualAddedWords.add(w.toLowerCase()));
    }
  }
  
  // Process LLM diffs and mark manual changes
  let tsIdx = 0;
  for (const diff of llmDiffs) {
    if (diff.removed) {
      // Removed by LLM - don't show in final text
      continue;
    }
    
    const words = diff.value?.split(/(\s+)/) || [];
    for (const word of words) {
      if (word.trim().length === 0) continue;
      
      // Check if this is a manual addition (not in savedText)
      const isManual = manualAddedWords.has(word.toLowerCase());
      
      let diffType: DiffType = 'unchanged';
      if (isManual) {
        diffType = 'manual';
      } else if (diff.added) {
        diffType = 'added';
      }
      
      // Find timestamp for this word
      const ts = tsIdx < timestampedWords.length ? timestampedWords[tsIdx] : undefined;
      if (ts && ts.word.toLowerCase().replace(/[.,!?;:"""„''()\[\]]/g, '') === 
                word.toLowerCase().replace(/[.,!?;:"""„''()\[\]]/g, '')) {
        result.push({
          word: word,
          diffType,
          timestamp: { start: ts.start, end: ts.end, isInterpolated: ts.isInterpolated }
        });
        tsIdx++;
      } else {
        result.push({
          word: word,
          diffType,
          timestamp: ts ? { start: ts.start, end: ts.end, isInterpolated: true } : undefined
        });
      }
    }
  }
  
  return result;
}

export default function EditableTextWithMitlesen({
  text,
  originalText,
  savedText,
  onChange,
  originalSegments,
  audioCurrentTime,
  audioRef,
  showDiff = false,
  showMitlesen = false,
  className = '',
  disabled = false,
}: EditableTextWithMitlesenProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editableRef = useRef<HTMLDivElement>(null);
  const [localText, setLocalText] = useState(text);
  
  // Sync with prop changes
  useEffect(() => {
    setLocalText(text);
  }, [text]);
  
  // Map timestamps to current text
  const timestampedWords = useMemo(() => {
    return mapTimestampsToText(originalSegments, localText);
  }, [originalSegments, localText]);
  
  // Detect if audio is playing (time is changing)
  const prevTimeRef = useRef(audioCurrentTime);
  const [isAudioActive, setIsAudioActive] = useState(false);
  
  useEffect(() => {
    // If time changed, audio is active
    if (Math.abs(audioCurrentTime - prevTimeRef.current) > 0.01) {
      setIsAudioActive(true);
      prevTimeRef.current = audioCurrentTime;
    }
    // Reset after 500ms of no change
    const timer = setTimeout(() => {
      if (Math.abs(audioCurrentTime - prevTimeRef.current) < 0.01) {
        setIsAudioActive(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [audioCurrentTime]);
  
  // Find current word index based on audio time
  const currentWordIndex = useMemo(() => {
    if (!showMitlesen || !isAudioActive) return -1;
    for (let i = 0; i < timestampedWords.length; i++) {
      const word = timestampedWords[i];
      if (audioCurrentTime >= word.start && audioCurrentTime < word.end) {
        return i;
      }
    }
    for (let i = 0; i < timestampedWords.length; i++) {
      if (timestampedWords[i].start > audioCurrentTime) {
        return Math.max(0, i - 1);
      }
    }
    return timestampedWords.length - 1;
  }, [timestampedWords, audioCurrentTime, showMitlesen, isAudioActive]);
  
  // Auto-scroll to current word
  useEffect(() => {
    if (!showMitlesen || !isAudioActive || currentWordIndex < 0 || !containerRef.current) return;
    const currentEl = containerRef.current.querySelector('[data-current="true"]');
    if (currentEl) {
      currentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentWordIndex, showMitlesen, isAudioActive]);
  
  // Handle text input
  const handleInput = useCallback((e: React.FormEvent<HTMLDivElement>) => {
    const newText = e.currentTarget.innerText || '';
    setLocalText(newText);
    onChange(newText);
  }, [onChange]);
  
  // Click on word to seek audio
  const handleWordClick = useCallback((timestamp?: { start: number }) => {
    if (timestamp && audioRef.current) {
      audioRef.current.currentTime = timestamp.start;
    }
  }, [audioRef]);
  
  // Calculate match quality
  const matchQuality = useMemo(() => {
    if (timestampedWords.length === 0) return 0;
    const matched = timestampedWords.filter(w => !w.isInterpolated).length;
    return Math.round((matched / timestampedWords.length) * 100);
  }, [timestampedWords]);
  
  // Render words with highlighting
  const words = localText.split(/(\s+)/);
  let wordIdx = 0;
  
  // Simple rendering when diff/mitlesen are off
  if (!showDiff && !showMitlesen) {
    return (
      <div className="relative">
        <div
          ref={editableRef}
          contentEditable={!disabled}
          suppressContentEditableWarning
          onInput={handleInput}
          className={`w-full p-3 rounded-lg text-sm leading-relaxed border outline-none min-h-[200px] bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-blue-500 ${className}`}
          style={{ whiteSpace: 'pre-wrap' }}
        >
          {localText}
        </div>
      </div>
    );
  }
  
  return (
    <div className="relative" ref={containerRef}>
      {/* Header with stats */}
      <div className="flex items-center justify-between mb-1 text-xs">
        <div className="flex items-center gap-2">
          {showMitlesen && (
            <span className="text-green-600 dark:text-green-400">
              🎯 Timestamp-Match: {matchQuality}%
            </span>
          )}
          {showDiff && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 bg-green-200 dark:bg-green-800 rounded"></span>
              <span className="text-gray-500">KI hinzugefügt</span>
              <span className="inline-block w-2 h-2 bg-blue-200 dark:bg-blue-800 rounded ml-2"></span>
              <span className="text-gray-500">Manuell</span>
            </span>
          )}
        </div>
        {showMitlesen && isAudioActive && (
          <span className="text-gray-500">{audioCurrentTime.toFixed(1)}s</span>
        )}
      </div>
      
      {/* Editable content */}
      <div
        ref={editableRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={handleInput}
        className={`w-full p-3 rounded-lg text-sm leading-relaxed border outline-none overflow-auto min-h-[200px] max-h-[400px] bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-blue-500 ${className}`}
        style={{ whiteSpace: 'pre-wrap' }}
      >
        {words.map((word, idx) => {
          // Whitespace
          if (word.trim().length === 0) {
            return <span key={idx}>{word}</span>;
          }
          
          const tsWord = wordIdx < timestampedWords.length ? timestampedWords[wordIdx] : null;
          const isCurrent = showMitlesen && isAudioActive && wordIdx === currentWordIndex;
          const isPast = showMitlesen && tsWord && audioCurrentTime > tsWord.end;
          wordIdx++;
          
          // Determine diff styling
          let diffClass = '';
          if (showDiff && savedText !== originalText) {
            // Check if word was added by LLM (in corrected but not in original)
            const origWords = originalText.toLowerCase().split(/\s+/);
            const wordLower = word.toLowerCase().replace(/[.,!?;:"""„''()\[\]]/g, '');
            if (!origWords.some(ow => ow.replace(/[.,!?;:"""„''()\[\]]/g, '') === wordLower)) {
              diffClass = 'bg-green-100 dark:bg-green-900/40 ';
            }
          }
          
          // Check for manual changes (in current but not in saved)
          if (showDiff && savedText) {
            const savedWords = savedText.toLowerCase().split(/\s+/);
            const wordLower = word.toLowerCase().replace(/[.,!?;:"""„''()\[\]]/g, '');
            const currWords = localText.toLowerCase().split(/\s+/);
            // If word is in current text but not in saved text, it's a manual addition
            if (!savedWords.some(sw => sw.replace(/[.,!?;:"""„''()\[\]]/g, '') === wordLower) &&
                currWords.some(cw => cw.replace(/[.,!?;:"""„''()\[\]]/g, '') === wordLower)) {
              diffClass = 'bg-blue-100 dark:bg-blue-900/40 ';
            }
          }
          
          return (
            <span
              key={idx}
              data-current={isCurrent}
              onClick={() => handleWordClick(tsWord ? { start: tsWord.start } : undefined)}
              className={`${diffClass}${
                isCurrent 
                  ? 'bg-yellow-300 dark:bg-yellow-600 font-semibold rounded px-0.5 ' 
                  : isPast 
                    ? 'text-gray-400 dark:text-gray-500 ' 
                    : ''
              }${tsWord?.isInterpolated ? 'italic ' : ''}cursor-pointer transition-colors duration-100`}
              title={tsWord ? `${tsWord.start.toFixed(1)}s${tsWord.isInterpolated ? ' (geschätzt)' : ''}` : undefined}
            >
              {word}
            </span>
          );
        })}
      </div>
    </div>
  );
}
