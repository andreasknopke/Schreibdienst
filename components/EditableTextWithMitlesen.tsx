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
 * Build a timestamp lookup table for the formatted text using diff information.
 * This approach uses the diff between original and formatted text to:
 * - Unchanged words: get their exact timestamp from original
 * - Added words: interpolate between surrounding anchors
 * - Removed words: skip them but advance the original word index
 * 
 * This is robust because it uses the actual change information rather than guessing.
 */
function buildTimestampTable(
  originalSegments: TranscriptSegment[],
  formattedText: string,
  originalTranscriptText?: string
): Map<number, TimestampedWord> {
  const result = new Map<number, TimestampedWord>();
  
  // Extract original words with timestamps
  const originalWords = extractOriginalWords(originalSegments);
  if (originalWords.length === 0) return result;
  
  // Build the original text from segments if not provided
  const origText = originalTranscriptText || originalWords.map(w => w.word).join(' ');
  
  // Compute diff between original transcript and formatted text
  const diffs = diffWordsWithSpace(origText, formattedText);
  
  // Parse formatted text to get word positions
  const formattedWordPositions = parseWords(formattedText);
  
  // Create a map from normalized word to its positions in formatted text
  const formattedWordPosMap = new Map<string, number[]>();
  for (const fw of formattedWordPositions) {
    const key = fw.normalized;
    if (!formattedWordPosMap.has(key)) {
      formattedWordPosMap.set(key, []);
    }
    formattedWordPosMap.get(key)!.push(fw.charPos);
  }
  
  // First pass: Build a list of words with their status and timestamps
  // Each entry: { word, charPos, status: 'unchanged'|'added'|'replaced', timestamp? }
  interface WordEntry {
    word: string;
    charPos: number;
    status: 'unchanged' | 'added';
    originalWordIdx?: number; // Index in originalWords array
  }
  
  const wordEntries: WordEntry[] = [];
  let origWordIdx = 0; // Current position in original words
  let formattedCharPos = 0; // Current character position in formatted text
  
  for (const diff of diffs) {
    const text = diff.value || '';
    
    if (diff.removed) {
      // These words were in original but removed in formatted text
      // Count how many words and advance origWordIdx
      const removedWords = text.split(/\s+/).filter(w => w.trim().length > 0);
      origWordIdx += removedWords.length;
      // Don't add to wordEntries, don't advance formattedCharPos
      continue;
    }
    
    if (diff.added) {
      // These words were added in formatted text (not in original)
      // They need interpolated timestamps
      const tokens = text.split(/(\s+)/);
      for (const token of tokens) {
        if (token.length === 0) continue;
        
        if (token.trim().length === 0) {
          // Whitespace - just advance position
          formattedCharPos += token.length;
        } else {
          // Added word - needs interpolation
          wordEntries.push({
            word: token,
            charPos: formattedCharPos,
            status: 'added'
          });
          formattedCharPos += token.length;
        }
      }
      continue;
    }
    
    // Unchanged: these words exist in both original and formatted
    const tokens = text.split(/(\s+)/);
    for (const token of tokens) {
      if (token.length === 0) continue;
      
      if (token.trim().length === 0) {
        // Whitespace
        formattedCharPos += token.length;
      } else {
        // Unchanged word - has exact timestamp
        wordEntries.push({
          word: token,
          charPos: formattedCharPos,
          status: 'unchanged',
          originalWordIdx: origWordIdx
        });
        origWordIdx++;
        formattedCharPos += token.length;
      }
    }
  }
  
  // Second pass: Assign timestamps
  // Unchanged words get their exact timestamp
  // Added words get interpolated timestamps
  
  const audioDuration = originalWords.length > 0 ? originalWords[originalWords.length - 1].end : 0;
  
  // First, set timestamps for unchanged words
  for (const entry of wordEntries) {
    if (entry.status === 'unchanged' && entry.originalWordIdx !== undefined) {
      const origWord = originalWords[entry.originalWordIdx];
      if (origWord) {
        result.set(entry.charPos, {
          word: entry.word,
          start: origWord.start,
          end: origWord.end,
          isInterpolated: false,
          charPos: entry.charPos
        });
      }
    }
  }
  
  // Then, interpolate timestamps for added words
  for (let i = 0; i < wordEntries.length; i++) {
    const entry = wordEntries[i];
    if (entry.status !== 'added') continue;
    if (result.has(entry.charPos)) continue; // Already set
    
    // Find previous and next unchanged words
    let prevAnchor: { idx: number; start: number; end: number } | null = null;
    let nextAnchor: { idx: number; start: number; end: number } | null = null;
    
    for (let j = i - 1; j >= 0; j--) {
      const ts = result.get(wordEntries[j].charPos);
      if (ts && !ts.isInterpolated) {
        prevAnchor = { idx: j, start: ts.start, end: ts.end };
        break;
      }
    }
    
    for (let j = i + 1; j < wordEntries.length; j++) {
      const ts = result.get(wordEntries[j].charPos);
      if (ts && !ts.isInterpolated) {
        nextAnchor = { idx: j, start: ts.start, end: ts.end };
        break;
      }
    }
    
    // Interpolate
    let estimatedStart: number;
    let estimatedEnd: number;
    
    if (prevAnchor && nextAnchor) {
      const totalWords = nextAnchor.idx - prevAnchor.idx;
      const wordOffset = i - prevAnchor.idx;
      const fraction = wordOffset / totalWords;
      const timeSpan = nextAnchor.start - prevAnchor.end;
      estimatedStart = prevAnchor.end + (timeSpan * fraction);
      estimatedEnd = estimatedStart + Math.min(0.3, timeSpan / totalWords);
    } else if (prevAnchor) {
      const wordsAfter = i - prevAnchor.idx;
      estimatedStart = prevAnchor.end + (wordsAfter * 0.15);
      estimatedEnd = estimatedStart + 0.2;
    } else if (nextAnchor) {
      const wordsBefore = nextAnchor.idx - i;
      estimatedStart = Math.max(0, nextAnchor.start - (wordsBefore * 0.2));
      estimatedEnd = estimatedStart + 0.2;
    } else {
      // No anchors - linear distribution
      const fraction = i / wordEntries.length;
      estimatedStart = fraction * audioDuration;
      estimatedEnd = estimatedStart + 0.2;
    }
    
    result.set(entry.charPos, {
      word: entry.word,
      start: estimatedStart,
      end: Math.min(estimatedEnd, audioDuration),
      isInterpolated: true,
      charPos: entry.charPos
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
  // Uses diff between original transcript and formatted text for robust mapping
  const timestampTable = useMemo(() => {
    return buildTimestampTable(originalSegments, localText, originalText);
  }, [originalSegments, localText, originalText]);
  
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
