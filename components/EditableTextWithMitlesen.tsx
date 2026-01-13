"use client";
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { diffWordsWithSpace } from 'diff';

// Word with timestamp for highlighting
interface TimestampedWord {
  word: string;
  start: number;
  end: number;
  isInterpolated?: boolean;
  charPos: number; // Character position in the text
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

// Parsed word from any text
interface ParsedWord {
  word: string;
  normalized: string;
  charPos: number;
  index: number;
}

// Original word with timestamp
interface OriginalWord {
  word: string;
  normalized: string;
  start: number;
  end: number;
  index: number;
  used: boolean; // Track if already matched
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
 * Normalizes a word for comparison (lowercase, remove punctuation)
 */
function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[.,!?;:"""„''()\[\]<>«»–—\-\/\\@#$%^&*+=|~`]/g, '').trim();
}

/**
 * Parse text into words with positions
 */
function parseWords(text: string): ParsedWord[] {
  const words: ParsedWord[] = [];
  const regex = /\S+/g;
  let match;
  let index = 0;
  
  while ((match = regex.exec(text)) !== null) {
    words.push({
      word: match[0],
      normalized: normalizeWord(match[0]),
      charPos: match.index,
      index: index++
    });
  }
  
  return words;
}

/**
 * Extract original words with timestamps from segments
 */
function extractOriginalWords(segments: TranscriptSegment[]): OriginalWord[] {
  const words: OriginalWord[] = [];
  let index = 0;
  
  for (const segment of segments) {
    if (segment.words) {
      for (const word of segment.words) {
        if (word.start !== undefined && word.end !== undefined) {
          words.push({
            word: word.word,
            normalized: normalizeWord(word.word),
            start: word.start,
            end: word.end,
            index: index++,
            used: false
          });
        }
      }
    }
  }
  
  return words;
}

/**
 * Build a timestamp lookup table for the formatted text.
 * Maps each word position in the formatted text to its timestamp.
 * Uses unchanged words between original and formatted text to anchor timestamps.
 */
function buildTimestampTable(
  originalSegments: TranscriptSegment[],
  formattedText: string
): Map<number, TimestampedWord> {
  const result = new Map<number, TimestampedWord>();
  
  // Extract original words with timestamps
  const originalWords = extractOriginalWords(originalSegments);
  if (originalWords.length === 0) return result;
  
  // Parse formatted text into words
  const formattedWords = parseWords(formattedText);
  if (formattedWords.length === 0) return result;
  
  // Reset usage flags
  originalWords.forEach(w => w.used = false);
  
  // Build index of original words by normalized form for O(1) lookup
  const originalWordIndex = new Map<string, OriginalWord[]>();
  for (const ow of originalWords) {
    if (ow.normalized.length > 0) {
      if (!originalWordIndex.has(ow.normalized)) {
        originalWordIndex.set(ow.normalized, []);
      }
      originalWordIndex.get(ow.normalized)!.push(ow);
    }
  }
  
  // First pass: Find exact matches (unchanged words)
  // Track which formatted words have direct matches
  const directMatches: (OriginalWord | null)[] = new Array(formattedWords.length).fill(null);
  let lastMatchedOrigIdx = -1;
  
  for (let i = 0; i < formattedWords.length; i++) {
    const fw = formattedWords[i];
    if (fw.normalized.length === 0) continue;
    
    // Look for matching original words
    const candidates = originalWordIndex.get(fw.normalized) || [];
    
    // Find the best candidate: unused, after last match, closest to expected position
    let bestMatch: OriginalWord | null = null;
    let bestScore = -Infinity;
    
    for (const candidate of candidates) {
      if (candidate.used) continue;
      if (candidate.index <= lastMatchedOrigIdx) continue;
      
      // Score based on proximity to expected position
      const expectedIdx = lastMatchedOrigIdx + 1;
      const distance = candidate.index - expectedIdx;
      // Prefer candidates that are close to where we expect them
      // But allow some gap for insertions/deletions
      const score = -distance;
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = candidate;
      }
    }
    
    if (bestMatch) {
      bestMatch.used = true;
      directMatches[i] = bestMatch;
      lastMatchedOrigIdx = bestMatch.index;
      
      result.set(fw.charPos, {
        word: fw.word,
        start: bestMatch.start,
        end: bestMatch.end,
        isInterpolated: false,
        charPos: fw.charPos
      });
    }
  }
  
  // Second pass: Interpolate timestamps for unmatched words
  // Use surrounding matched words to estimate timestamps
  const audioDuration = originalWords[originalWords.length - 1].end;
  
  for (let i = 0; i < formattedWords.length; i++) {
    const fw = formattedWords[i];
    if (result.has(fw.charPos)) continue; // Already matched
    
    // Find nearest matched words before and after
    let prevMatch: { idx: number; ts: TimestampedWord } | null = null;
    let nextMatch: { idx: number; ts: TimestampedWord } | null = null;
    
    for (let j = i - 1; j >= 0; j--) {
      const ts = result.get(formattedWords[j].charPos);
      if (ts && !ts.isInterpolated) {
        prevMatch = { idx: j, ts };
        break;
      }
    }
    
    for (let j = i + 1; j < formattedWords.length; j++) {
      const ts = result.get(formattedWords[j].charPos);
      if (ts && !ts.isInterpolated) {
        nextMatch = { idx: j, ts };
        break;
      }
    }
    
    // Interpolate based on position between anchors
    let estimatedStart: number;
    let estimatedEnd: number;
    
    if (prevMatch && nextMatch) {
      // Interpolate between two known points
      const totalWords = nextMatch.idx - prevMatch.idx;
      const wordOffset = i - prevMatch.idx;
      const fraction = wordOffset / totalWords;
      const timeDelta = nextMatch.ts.start - prevMatch.ts.end;
      estimatedStart = prevMatch.ts.end + (timeDelta * fraction);
      estimatedEnd = estimatedStart + 0.2; // Assume 200ms per word
    } else if (prevMatch) {
      // After last match - extrapolate forward
      const wordsAfter = i - prevMatch.idx;
      estimatedStart = prevMatch.ts.end + (wordsAfter * 0.15);
      estimatedEnd = estimatedStart + 0.2;
    } else if (nextMatch) {
      // Before first match - extrapolate backward
      const wordsBefore = nextMatch.idx - i;
      estimatedStart = Math.max(0, nextMatch.ts.start - (wordsBefore * 0.2));
      estimatedEnd = estimatedStart + 0.2;
    } else {
      // No matches at all - use linear distribution
      const fraction = i / formattedWords.length;
      estimatedStart = fraction * audioDuration;
      estimatedEnd = estimatedStart + 0.2;
    }
    
    result.set(fw.charPos, {
      word: fw.word,
      start: estimatedStart,
      end: Math.min(estimatedEnd, audioDuration),
      isInterpolated: true,
      charPos: fw.charPos
    });
  }
  
  return result;
}

/**
 * Create an array of timestamped words in order for the text
 */
function getOrderedTimestampedWords(
  timestampTable: Map<number, TimestampedWord>,
  text: string
): TimestampedWord[] {
  const parsedWords = parseWords(text);
  const result: TimestampedWord[] = [];
  
  for (const pw of parsedWords) {
    const ts = timestampTable.get(pw.charPos);
    if (ts) {
      result.push(ts);
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
  
  // Build timestamp table: maps character positions to timestamps
  // This is the core of the new approach - builds a stable mapping
  const timestampTable = useMemo(() => {
    return buildTimestampTable(originalSegments, localText);
  }, [originalSegments, localText]);
  
  // Get ordered array of timestamped words for iteration
  const timestampedWords = useMemo(() => {
    return getOrderedTimestampedWords(timestampTable, localText);
  }, [timestampTable, localText]);
  
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
    
    // Baue eine Liste von Wörtern mit ihrem Diff-Status
    const wordsWithDiffStatus: { word: string; isAdded: boolean; isManual: boolean; isWhitespace: boolean }[] = [];
    for (const part of llmDiff) {
      if (part.removed) continue;
      
      const tokens = part.value?.split(/(\s+)/) || [];
      for (const token of tokens) {
        if (token.length === 0) continue;
        
        const isWhitespace = token.trim().length === 0;
        const wordNorm = token.toLowerCase().replace(/[.,!?;:"""„''()\[\]]/g, '');
        
        wordsWithDiffStatus.push({
          word: token,
          isAdded: !isWhitespace && part.added === true,
          isManual: !isWhitespace && manualAddedWords.has(wordNorm),
          isWhitespace
        });
      }
    }
    
    return { wordsWithDiffStatus, manualAddedWords };
  }, [originalText, localText, savedText]);

  // Render content with Mitlesen and optional Diff highlighting
  // This approach tracks character position to find timestamps
  const renderContent = () => {
    const elements: React.ReactNode[] = [];
    
    // If we have diff info, use it; otherwise just iterate through words
    if (showDiff) {
      // Use diff-based rendering with character position tracking
      let charPos = 0; // Track position in localText
      let wordIdx = 0; // Track which word we're on for currentWordIndex comparison
      
      for (let i = 0; i < diffResult.wordsWithDiffStatus.length; i++) {
        const item = diffResult.wordsWithDiffStatus[i];
        
        // Whitespace - render as-is and advance charPos
        if (item.isWhitespace) {
          elements.push(<span key={i}>{item.word}</span>);
          charPos += item.word.length;
          continue;
        }
        
        // Find this word's actual position in localText
        // Search from current charPos to handle duplicates correctly
        const wordPosInText = localText.indexOf(item.word, charPos);
        
        // Get timestamp using the actual character position
        const tsWord = wordPosInText !== -1 ? timestampTable.get(wordPosInText) : null;
        
        // Check if this is the current word being played
        const isCurrent = showMitlesen && wordIdx === currentWordIndex && currentWordIndex >= 0;
        const isPast = showMitlesen && isAudioActive && tsWord && audioCurrentTime > tsWord.end;
        
        // Update charPos to after this word
        if (wordPosInText !== -1) {
          charPos = wordPosInText + item.word.length;
        } else {
          charPos += item.word.length;
        }
        wordIdx++;
        
        // Determine diff styling
        let diffClass = '';
        if (item.isManual) {
          diffClass = 'bg-blue-200 text-blue-900 dark:bg-blue-600 dark:text-white font-medium rounded px-0.5 ';
        } else if (item.isAdded) {
          diffClass = 'bg-green-200 text-green-900 dark:bg-green-600 dark:text-white font-medium rounded px-0.5 ';
        }
        
        elements.push(
          <span
            key={i}
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
            {item.word}
          </span>
        );
      }
    } else {
      // Non-diff rendering: iterate through text preserving whitespace
      // Split text but keep whitespace as separate tokens
      const tokens = localText.split(/(\s+)/);
      let charPos = 0; // Track position in text
      let wordIdx = 0; // Track word index for currentWordIndex comparison
      
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.length === 0) continue;
        
        const isWhitespace = token.trim().length === 0;
        
        if (isWhitespace) {
          elements.push(<span key={i}>{token}</span>);
          charPos += token.length;
          continue;
        }
        
        // Find this word's actual position in localText
        const wordPosInText = localText.indexOf(token, charPos);
        
        // Get timestamp using the actual character position
        const tsWord = wordPosInText !== -1 ? timestampTable.get(wordPosInText) : null;
        const isCurrent = showMitlesen && wordIdx === currentWordIndex && currentWordIndex >= 0;
        const isPast = showMitlesen && isAudioActive && tsWord && audioCurrentTime > tsWord.end;
        
        // Update charPos
        if (wordPosInText !== -1) {
          charPos = wordPosInText + token.length;
        } else {
          charPos += token.length;
        }
        wordIdx++;
        
        elements.push(
          <span
            key={i}
            data-current={isCurrent}
            onClick={() => handleWordClick(tsWord ? { start: tsWord.start } : undefined)}
            className={`${
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

  // Simple rendering when both diff and mitlesen are off
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
        {renderContent()}
      </div>
    </div>
  );
}
