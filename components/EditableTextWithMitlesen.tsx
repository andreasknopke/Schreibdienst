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
 * Uses a more robust algorithm that continues even when words don't match.
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
            word: word.word.toLowerCase().replace(/[.,!?;:"""„''()\[\]]/g, '').trim(),
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
  
  const audioDuration = originalWords[originalWords.length - 1].end;
  
  // Build a map of original words for faster lookup
  // Group words by their normalized form
  const wordPositions: Map<string, number[]> = new Map();
  for (let i = 0; i < originalWords.length; i++) {
    const w = originalWords[i].word;
    if (!wordPositions.has(w)) {
      wordPositions.set(w, []);
    }
    wordPositions.get(w)!.push(i);
  }
  
  let lastMatchedOrigIdx = -1;
  
  for (let i = 0; i < textWords.length; i++) {
    const word = textWords[i];
    const wordNorm = word.toLowerCase().replace(/[.,!?;:"""„''()\[\]]/g, '').trim();
    
    if (wordNorm.length === 0) continue;
    
    // Try to find the word in original, preferring positions after lastMatchedOrigIdx
    let bestMatchIdx = -1;
    let bestMatchScore = -1;
    
    // Direct match lookup
    const directMatches = wordPositions.get(wordNorm) || [];
    for (const idx of directMatches) {
      if (idx > lastMatchedOrigIdx) {
        // Prefer matches that are close to where we expect the word to be
        const expectedPos = lastMatchedOrigIdx + 1;
        const distance = Math.abs(idx - expectedPos);
        const score = 1000 - distance; // Higher score for closer matches
        if (score > bestMatchScore) {
          bestMatchScore = score;
          bestMatchIdx = idx;
        }
      }
    }
    
    // If no direct match, try fuzzy matching within a window
    if (bestMatchIdx === -1) {
      const searchStart = Math.max(0, lastMatchedOrigIdx + 1);
      const searchEnd = Math.min(originalWords.length, searchStart + 20); // Look ahead up to 20 words
      
      for (let j = searchStart; j < searchEnd; j++) {
        const origWord = originalWords[j].word;
        
        // Fuzzy matching
        if (origWord.includes(wordNorm) || 
            wordNorm.includes(origWord) ||
            (wordNorm.length >= 4 && origWord.length >= 4 && 
             (origWord.startsWith(wordNorm.slice(0, 4)) || wordNorm.startsWith(origWord.slice(0, 4))))) {
          const distance = j - (lastMatchedOrigIdx + 1);
          const score = 500 - distance;
          if (score > bestMatchScore) {
            bestMatchScore = score;
            bestMatchIdx = j;
          }
        }
      }
    }
    
    if (bestMatchIdx !== -1) {
      // Found a match
      result.push({
        word: word,
        start: originalWords[bestMatchIdx].start,
        end: originalWords[bestMatchIdx].end,
        isInterpolated: false
      });
      lastMatchedOrigIdx = bestMatchIdx;
    } else {
      // No match - interpolate timestamp based on position
      const progress = i / textWords.length;
      const estimatedTime = progress * audioDuration;
      
      // Find the closest original word timestamp to this estimated time
      let closestIdx = 0;
      let closestDiff = Infinity;
      for (let j = 0; j < originalWords.length; j++) {
        const diff = Math.abs(originalWords[j].start - estimatedTime);
        if (diff < closestDiff) {
          closestDiff = diff;
          closestIdx = j;
        }
      }
      
      result.push({
        word: word,
        start: originalWords[closestIdx].start,
        end: originalWords[closestIdx].end,
        isInterpolated: true
      });
      
      // Don't update lastMatchedOrigIdx for interpolated words
      // This allows the algorithm to continue looking for matches
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
  
  // Map timestamps to current text - returns array of words with timestamps
  // Each word in the text gets a timestamp from the original audio
  const timestampedWords = useMemo(() => {
    return mapTimestampsToText(originalSegments, localText);
  }, [originalSegments, localText]);
  
  // Create a lookup map: word position in text -> timestamp info
  // This uses the actual character position in the text to match words
  const wordTimestampMap = useMemo(() => {
    const map = new Map<number, TimestampedWord>();
    const words = localText.split(/\s+/).filter(w => w.length > 0);
    let charPos = 0;
    
    for (let i = 0; i < words.length && i < timestampedWords.length; i++) {
      const word = words[i];
      // Find actual position in text
      const pos = localText.indexOf(word, charPos);
      if (pos !== -1) {
        map.set(pos, timestampedWords[i]);
        charPos = pos + word.length;
      }
    }
    
    return map;
  }, [localText, timestampedWords]);
  
  // Detect if audio is playing (time is changing)
  const prevTimeRef = useRef(audioCurrentTime);
  const [isAudioActive, setIsAudioActive] = useState(false);
  const lastActiveTimeRef = useRef(0);
  
  useEffect(() => {
    // If time changed, audio is active
    if (Math.abs(audioCurrentTime - prevTimeRef.current) > 0.01) {
      setIsAudioActive(true);
      lastActiveTimeRef.current = Date.now();
      prevTimeRef.current = audioCurrentTime;
    }
    // Reset after 1s of no change (longer timeout for better UX)
    const timer = setTimeout(() => {
      if (Date.now() - lastActiveTimeRef.current > 1000) {
        setIsAudioActive(false);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [audioCurrentTime]);
  
  // Find current word index based on audio time
  // Always calculate, not just when playing (so clicking works too)
  const currentWordIndex = useMemo(() => {
    if (!showMitlesen) return -1;
    if (timestampedWords.length === 0) return -1;
    
    // Find word that contains current time
    for (let i = 0; i < timestampedWords.length; i++) {
      const word = timestampedWords[i];
      if (audioCurrentTime >= word.start && audioCurrentTime < word.end) {
        return i;
      }
    }
    
    // Find closest word before current time
    for (let i = timestampedWords.length - 1; i >= 0; i--) {
      if (timestampedWords[i].start <= audioCurrentTime) {
        return i;
      }
    }
    
    // Default to first word if time is before all words
    return 0;
  }, [timestampedWords, audioCurrentTime, showMitlesen]);
  
  // Auto-scroll to current word (only when playing)
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
  
  // Compute diff changes using the diff library
  const diffResult = useMemo(() => {
    if (!showDiff) return null;
    
    // Diff zwischen Original (vor KI) und aktuellem Text
    const llmDiff = diffWordsWithSpace(originalText || '', localText || '');
    
    // Diff zwischen gespeichertem Text und aktuellem Text (manuelle Änderungen)
    const manualDiff = savedText ? diffWordsWithSpace(savedText, localText || '') : [];
    
    // Sammle manuell hinzugefügte Wörter
    const manualAddedWords = new Set<string>();
    for (const part of manualDiff) {
      if (part.added && part.value) {
        const words = part.value.split(/\s+/).filter(w => w.trim());
        words.forEach(w => manualAddedWords.add(w.toLowerCase().replace(/[.,!?;:"""„''()\[\]]/g, '')));
      }
    }
    
    return { llmDiff, manualAddedWords };
  }, [originalText, localText, savedText, showDiff]);

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
  
  // Build rendered elements from diff
  const renderDiffContent = () => {
    if (!diffResult) return localText;
    
    const elements: React.ReactNode[] = [];
    let elementKey = 0;
    let charPosition = 0; // Track position in the original localText
    
    for (const part of diffResult.llmDiff) {
      // Skip removed parts (not in final text)
      if (part.removed) continue;
      
      const tokens = part.value?.split(/(\s+)/) || [];
      
      for (const token of tokens) {
        // Whitespace - render as-is
        if (token.trim().length === 0) {
          elements.push(<span key={elementKey++}>{token}</span>);
          charPosition += token.length;
          continue;
        }
        
        // Find this word's position in localText to get its timestamp
        const wordPosInText = localText.indexOf(token, charPosition);
        const tsWord = wordPosInText !== -1 ? wordTimestampMap.get(wordPosInText) : null;
        
        // Update char position
        if (wordPosInText !== -1) {
          charPosition = wordPosInText + token.length;
        } else {
          charPosition += token.length;
        }
        
        // Check if this word is the current playing word
        const isCurrent = showMitlesen && tsWord && currentWordIndex >= 0 && 
          timestampedWords[currentWordIndex] && 
          tsWord.start === timestampedWords[currentWordIndex].start;
        
        const isPast = showMitlesen && isAudioActive && tsWord && audioCurrentTime > tsWord.end;
        
        // Determine diff styling
        let diffClass = '';
        const wordNorm = token.toLowerCase().replace(/[.,!?;:"""„''()\[\]]/g, '');
        
        // Check if manually added (blue) - kräftigere Farben
        if (diffResult.manualAddedWords.has(wordNorm)) {
          diffClass = 'bg-blue-200 text-blue-900 dark:bg-blue-600 dark:text-white font-medium rounded px-0.5 ';
        } 
        // Check if added by LLM (green) - kräftigere Farben
        else if (part.added) {
          diffClass = 'bg-green-200 text-green-900 dark:bg-green-600 dark:text-white font-medium rounded px-0.5 ';
        }
        
        elements.push(
          <span
            key={elementKey++}
            data-current={isCurrent}
            onClick={() => handleWordClick(tsWord ? { start: tsWord.start } : undefined)}
            className={`${diffClass}${
              isCurrent 
                ? 'bg-yellow-300 dark:bg-yellow-500 text-black font-semibold rounded px-0.5 ' 
                : isPast 
                  ? 'text-gray-400 dark:text-gray-500 ' 
                  : ''
            }${tsWord?.isInterpolated ? 'italic ' : ''}cursor-pointer transition-colors duration-100`}
            title={tsWord ? `${tsWord.start.toFixed(1)}s${tsWord.isInterpolated ? ' (geschätzt)' : ''}` : undefined}
          >
            {token}
          </span>
        );
      }
    }
    
    return elements;
  };
  
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
              <span className="inline-block w-3 h-3 bg-green-500 dark:bg-green-600 rounded"></span>
              <span className="text-gray-600 dark:text-gray-300">KI hinzugefügt</span>
              <span className="inline-block w-3 h-3 bg-blue-500 dark:bg-blue-600 rounded ml-2"></span>
              <span className="text-gray-600 dark:text-gray-300">Manuell</span>
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
        {renderDiffContent()}
      </div>
    </div>
  );
}
