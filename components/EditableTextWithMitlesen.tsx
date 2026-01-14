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
 * 
 * New approach: Compare normalized word sequences, ignoring formatting.
 * 1. Extract words from original (with timestamps)
 * 2. Extract words from formatted text (with char positions)
 * 3. Diff the normalized word sequences
 * 4. Map timestamps based on word-level diff
 * 
 * This ignores formatting differences (newlines, brackets) and focuses only on words.
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
  
  // Parse formatted text into words with their positions
  const formattedWords = parseWords(formattedText);
  if (formattedWords.length === 0) return result;
  
  // Build normalized word strings for comparison
  // This strips all formatting - just space-separated normalized words
  const origWordString = originalWords.map(w => w.normalized).join(' ');
  const formattedWordString = formattedWords.map(w => w.normalized).join(' ');
  
  // Diff the normalized word sequences
  const diffs = diffWordsWithSpace(origWordString, formattedWordString);
  
  // Track position in both word arrays
  let origIdx = 0;
  let formattedIdx = 0;
  
  // Process each diff part
  for (const diff of diffs) {
    const words = diff.value?.split(/\s+/).filter(w => w.length > 0) || [];
    const wordCount = words.length;
    
    if (diff.removed) {
      // Words in original that were removed - skip them in original
      origIdx += wordCount;
      continue;
    }
    
    if (diff.added) {
      // Words added to formatted text - they need interpolated timestamps
      // For now, mark them as needing interpolation and advance formattedIdx
      for (let i = 0; i < wordCount && formattedIdx < formattedWords.length; i++) {
        const fw = formattedWords[formattedIdx];
        // Mark for interpolation (will be filled in second pass)
        formattedIdx++;
      }
      continue;
    }
    
    // Unchanged words - direct timestamp mapping
    for (let i = 0; i < wordCount && origIdx < originalWords.length && formattedIdx < formattedWords.length; i++) {
      const origWord = originalWords[origIdx];
      const fw = formattedWords[formattedIdx];
      
      result.set(fw.charPos, {
        word: fw.word,
        start: origWord.start,
        end: origWord.end,
        isInterpolated: false,
        charPos: fw.charPos
      });
      
      origIdx++;
      formattedIdx++;
    }
  }
  
  // Second pass: Interpolate timestamps for words that weren't matched
  const audioDuration = originalWords[originalWords.length - 1].end;
  
  for (let i = 0; i < formattedWords.length; i++) {
    const fw = formattedWords[i];
    if (result.has(fw.charPos)) continue; // Already has timestamp
    
    // Find nearest anchors (words with real timestamps)
    let prevAnchor: { idx: number; end: number } | null = null;
    let nextAnchor: { idx: number; start: number } | null = null;
    
    for (let j = i - 1; j >= 0; j--) {
      const ts = result.get(formattedWords[j].charPos);
      if (ts && !ts.isInterpolated) {
        prevAnchor = { idx: j, end: ts.end };
        break;
      }
    }
    
    for (let j = i + 1; j < formattedWords.length; j++) {
      const ts = result.get(formattedWords[j].charPos);
      if (ts && !ts.isInterpolated) {
        nextAnchor = { idx: j, start: ts.start };
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
      // No anchors at all
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [localText, setLocalText] = useState(text);
  
  // Dedicated edit mode state
  const [isManualEditMode, setIsManualEditMode] = useState(false);
  const [editModeText, setEditModeText] = useState('');
  
  // Sync with prop changes (only when not in manual edit mode)
  useEffect(() => {
    if (!isManualEditMode) {
      setLocalText(text);
    }
  }, [text, isManualEditMode]);
  
  // Enter manual edit mode
  const handleStartEdit = useCallback(() => {
    setEditModeText(localText);
    setIsManualEditMode(true);
    // Focus textarea after render
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 50);
  }, [localText]);
  
  // Cancel manual edit - discard changes
  const handleCancelEdit = useCallback(() => {
    setEditModeText('');
    setIsManualEditMode(false);
  }, []);
  
  // Apply manual edit - save changes and exit edit mode
  const handleApplyEdit = useCallback(() => {
    setLocalText(editModeText);
    onChange(editModeText);
    setIsManualEditMode(false);
    setEditModeText('');
  }, [editModeText, onChange]);
  
  // Build STABLE timestamp table based on the saved/initial text (not localText)
  // This ensures timestamps don't jump around during manual editing
  const stableTimestampTable = useMemo(() => {
    return buildTimestampTable(originalSegments, text, originalText);
  }, [originalSegments, text, originalText]);
  
  // Get stable timestamped words from the saved text
  const stableTimestampedWords = useMemo(() => {
    return getOrderedTimestampedWords(stableTimestampTable, text);
  }, [stableTimestampTable, text]);
  
  // Map timestamps from stable text to current localText
  // Uses word-sequence matching to handle insertions/deletions
  const timestampedWords = useMemo(() => {
    if (localText === text) {
      // No manual edits - use stable timestamps directly
      return stableTimestampedWords;
    }
    
    // Manual edits detected - need to remap timestamps
    const localWords = parseWords(localText);
    const stableWords = parseWords(text);
    
    if (localWords.length === 0) return [];
    if (stableTimestampedWords.length === 0) return [];
    
    // Build a map of stable word timestamps by normalized word and approximate position
    // Key: normalized word + position bucket (to handle duplicates)
    const result: TimestampedWord[] = [];
    
    // Use diff to match words between stable and local text
    const stableWordString = stableWords.map(w => w.normalized).join(' ');
    const localWordString = localWords.map(w => w.normalized).join(' ');
    const diffs = diffWordsWithSpace(stableWordString, localWordString);
    
    let stableIdx = 0;
    let localIdx = 0;
    
    for (const diff of diffs) {
      const words = diff.value?.split(/\s+/).filter(w => w.length > 0) || [];
      const wordCount = words.length;
      
      if (diff.removed) {
        // Words in stable that were removed in local - skip them
        stableIdx += wordCount;
        continue;
      }
      
      if (diff.added) {
        // Words added in local - they need interpolated timestamps
        for (let i = 0; i < wordCount && localIdx < localWords.length; i++) {
          const lw = localWords[localIdx];
          // Interpolate based on surrounding timestamps
          let estimatedStart = 0;
          let estimatedEnd = 0.2;
          
          if (stableIdx > 0 && stableIdx <= stableTimestampedWords.length) {
            const prevTs = stableTimestampedWords[stableIdx - 1];
            estimatedStart = prevTs.end + 0.1;
            estimatedEnd = estimatedStart + 0.2;
          } else if (stableIdx < stableTimestampedWords.length) {
            const nextTs = stableTimestampedWords[stableIdx];
            estimatedStart = Math.max(0, nextTs.start - 0.2);
            estimatedEnd = nextTs.start;
          }
          
          result.push({
            word: lw.word,
            start: estimatedStart,
            end: estimatedEnd,
            isInterpolated: true,
            charPos: lw.charPos
          });
          localIdx++;
        }
        continue;
      }
      
      // Unchanged - direct mapping
      for (let i = 0; i < wordCount && stableIdx < stableTimestampedWords.length && localIdx < localWords.length; i++) {
        const stableTs = stableTimestampedWords[stableIdx];
        const lw = localWords[localIdx];
        
        result.push({
          word: lw.word,
          start: stableTs.start,
          end: stableTs.end,
          isInterpolated: stableTs.isInterpolated,
          charPos: lw.charPos
        });
        
        stableIdx++;
        localIdx++;
      }
    }
    
    return result;
  }, [localText, text, stableTimestampedWords]);
  
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
  
  // Auto-scroll to current word (only when playing and not in edit mode)
  useEffect(() => {
    if (!showMitlesen || !isAudioActive || currentWordIndex < 0 || !containerRef.current || isManualEditMode) return;
    const currentEl = containerRef.current.querySelector('[data-current="true"]');
    if (currentEl) {
      currentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentWordIndex, showMitlesen, isAudioActive, isManualEditMode]);
  
  // Click on word to seek audio (only when not in edit mode)
  const handleWordClick = useCallback((timestamp?: { start: number }) => {
    if (isManualEditMode) return;
    if (timestamp && audioRef.current) {
      audioRef.current.currentTime = timestamp.start;
    }
  }, [audioRef, isManualEditMode]);
  
  // Calculate match quality
  const matchQuality = useMemo(() => {
    if (timestampedWords.length === 0) return 0;
    const matched = timestampedWords.filter(w => !w.isInterpolated).length;
    return Math.round((matched / timestampedWords.length) * 100);
  }, [timestampedWords]);
  
  // Compute diff changes using the diff library
  // Now tracking by character position to avoid marking all identical words
  const diffResult = useMemo(() => {
    // Diff zwischen Original (vor KI) und aktuellem Text
    const llmDiff = diffWordsWithSpace(originalText || '', localText || '');
    
    // Diff zwischen gespeichertem Text und aktuellem Text (manuelle Änderungen)
    const manualDiff = savedText ? diffWordsWithSpace(savedText, localText || '') : [];
    
    // Track manual changes by CHARACTER POSITION in localText
    const manualAddedPositions = new Set<number>();
    let localCharPos = 0;
    let savedCharPos = 0;
    
    for (const part of manualDiff) {
      if (part.removed) {
        // Skip removed characters from saved text position
        savedCharPos += part.value?.length || 0;
        continue;
      }
      
      const text = part.value || '';
      if (part.added) {
        // Mark these character positions as manually added
        for (let i = 0; i < text.length; i++) {
          if (text[i].trim()) { // Only mark non-whitespace
            manualAddedPositions.add(localCharPos + i);
          }
        }
      }
      localCharPos += text.length;
    }
    
    // Build list of words with their diff status and character positions
    const wordsWithDiffStatus: { word: string; isAdded: boolean; isManual: boolean; isWhitespace: boolean; charPos: number }[] = [];
    let currentCharPos = 0;
    
    for (const part of llmDiff) {
      if (part.removed) continue;
      
      const tokens = part.value?.split(/(\s+)/) || [];
      for (const token of tokens) {
        if (token.length === 0) continue;
        
        const isWhitespace = token.trim().length === 0;
        
        // Check if any character in this word was manually added
        let isManual = false;
        for (let i = 0; i < token.length && !isManual; i++) {
          if (manualAddedPositions.has(currentCharPos + i)) {
            isManual = true;
          }
        }
        
        wordsWithDiffStatus.push({
          word: token,
          isAdded: !isWhitespace && part.added === true,
          isManual: !isWhitespace && isManual,
          isWhitespace,
          charPos: currentCharPos
        });
        
        currentCharPos += token.length;
      }
    }
    
    return { wordsWithDiffStatus, manualAddedPositions };
  }, [originalText, localText, savedText]);

  // Build a map of diff status for each word based on character position
  // This ensures only the specific word instance is marked, not all identical words
  const wordDiffStatusMap = useMemo(() => {
    const map = new Map<number, { isAdded: boolean; isManual: boolean }>();
    for (const item of diffResult.wordsWithDiffStatus) {
      if (!item.isWhitespace) {
        map.set(item.charPos, { isAdded: item.isAdded, isManual: item.isManual });
      }
    }
    return map;
  }, [diffResult.wordsWithDiffStatus]);

  // Render content with Mitlesen and optional Diff highlighting
  // Uses timestampedWords for consistent word iteration
  const renderContent = () => {
    const elements: React.ReactNode[] = [];
    
    // Parse text to get words and whitespace with character positions
    const tokens = localText.split(/(\s+)/);
    let wordIdx = 0;
    let charPos = 0;
    
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.length === 0) continue;
      
      const isWhitespace = token.trim().length === 0;
      const tokenCharPos = charPos;
      charPos += token.length;
      
      if (isWhitespace) {
        elements.push(<span key={i}>{token}</span>);
        continue;
      }
      
      // Get timestamp for this word
      const tsWord = wordIdx < timestampedWords.length ? timestampedWords[wordIdx] : null;
      const isCurrent = showMitlesen && wordIdx === currentWordIndex && currentWordIndex >= 0;
      const isPast = showMitlesen && isAudioActive && tsWord && audioCurrentTime > tsWord.end;
      
      // Get diff status for styling (only if showDiff is on) - now by character position
      let diffClass = '';
      if (showDiff) {
        const diffStatus = wordDiffStatusMap.get(tokenCharPos);
        if (diffStatus?.isManual) {
          diffClass = 'bg-blue-200 text-blue-900 dark:bg-blue-600 dark:text-white font-medium rounded px-0.5 ';
        } else if (diffStatus?.isAdded) {
          diffClass = 'bg-green-200 text-green-900 dark:bg-green-600 dark:text-white font-medium rounded px-0.5 ';
        }
      }
      
      wordIdx++;
      
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
          {token}
        </span>
      );
    }
    
    return elements;
  };

  // Manual Edit Mode UI - full textarea for editing
  if (isManualEditMode) {
    return (
      <div className="relative" ref={containerRef}>
        {/* Edit mode header */}
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
            ✏️ Bearbeitungsmodus
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleCancelEdit}
              className="px-3 py-1 text-xs font-medium rounded bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 transition-colors"
            >
              Abbrechen
            </button>
            <button
              onClick={handleApplyEdit}
              className="px-3 py-1 text-xs font-medium rounded bg-blue-500 hover:bg-blue-600 text-white transition-colors"
            >
              ✓ Übernehmen
            </button>
          </div>
        </div>
        
        {/* Simple textarea for editing - no React interference */}
        <textarea
          ref={textareaRef}
          value={editModeText}
          onChange={(e) => setEditModeText(e.target.value)}
          className={`w-full p-3 rounded-lg text-sm leading-relaxed border outline-none min-h-[200px] max-h-[400px] resize-y bg-white dark:bg-gray-900 border-blue-400 dark:border-blue-500 focus:ring-2 focus:ring-blue-500 ${className}`}
          style={{ whiteSpace: 'pre-wrap' }}
          disabled={disabled}
        />
      </div>
    );
  }

  // Simple rendering when both diff and mitlesen are off
  if (!showDiff && !showMitlesen) {
    return (
      <div className="relative">
        {/* Edit button */}
        {!disabled && (
          <button
            onClick={handleStartEdit}
            className="absolute top-2 right-2 z-10 p-1.5 rounded bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
            title="Text bearbeiten"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
        )}
        <div
          ref={editableRef}
          className={`w-full p-3 rounded-lg text-sm leading-relaxed border outline-none min-h-[200px] bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 ${className}`}
          style={{ whiteSpace: 'pre-wrap' }}
        >
          {localText}
        </div>
      </div>
    );
  }
  
  return (
    <div className="relative" ref={containerRef}>
      {/* Header with stats and edit button */}
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
        <div className="flex items-center gap-2">
          {showMitlesen && isAudioActive && (
            <span className="text-gray-500">{audioCurrentTime.toFixed(1)}s</span>
          )}
          {/* Edit button */}
          {!disabled && (
            <button
              onClick={handleStartEdit}
              className="flex items-center gap-1 px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
              title="Text manuell bearbeiten"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              <span>Bearbeiten</span>
            </button>
          )}
        </div>
      </div>
      
      {/* Read-only content with highlights */}
      <div
        ref={editableRef}
        className={`w-full p-3 rounded-lg text-sm leading-relaxed border outline-none overflow-auto min-h-[200px] max-h-[400px] bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 ${className}`}
        style={{ whiteSpace: 'pre-wrap' }}
      >
        {renderContent()}
      </div>
    </div>
  );
}
