/**
 * Text difference calculation for highlighting changes between
 * formatted transcription and LLM-corrected text.
 */

export interface DiffSegment {
  type: 'unchanged' | 'added' | 'removed' | 'modified';
  text: string;
  originalText?: string; // For 'modified' segments: what was the original text
}

/**
 * Tokenize text into words and punctuation, preserving whitespace info.
 */
function tokenize(text: string): string[] {
  // Split by word boundaries, keeping punctuation separate
  // This regex matches words, punctuation, or whitespace sequences
  const tokens: string[] = [];
  const regex = /(\s+|[^\s\wäöüÄÖÜß]+|[\wäöüÄÖÜß]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    tokens.push(match[0]);
  }
  return tokens;
}

/**
 * Normalize a token for comparison (lowercase, trim extra spaces).
 */
function normalizeToken(token: string): string {
  return token.toLowerCase().trim();
}

/**
 * Check if a token is just whitespace.
 */
function isWhitespace(token: string): boolean {
  return /^\s+$/.test(token);
}

/**
 * Check if a token is punctuation.
 */
function isPunctuation(token: string): boolean {
  return /^[^\s\wäöüÄÖÜß]+$/.test(token);
}

/**
 * Compute the Longest Common Subsequence (LCS) of two token arrays.
 * Returns indices of matching tokens.
 */
function computeLCS(tokens1: string[], tokens2: string[]): number[][] {
  const m = tokens1.length;
  const n = tokens2.length;
  
  // Build LCS matrix
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (normalizeToken(tokens1[i - 1]) === normalizeToken(tokens2[j - 1])) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  
  // Backtrack to find actual LCS
  const lcs: number[][] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (normalizeToken(tokens1[i - 1]) === normalizeToken(tokens2[j - 1])) {
      lcs.unshift([i - 1, j - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  
  return lcs;
}

/**
 * Calculate word-level diff between original and corrected text.
 * Returns an array of DiffSegments for rendering.
 * 
 * @param original - The original text (after textFormatting, before LLM correction)
 * @param corrected - The LLM-corrected text
 * @returns Array of diff segments for display
 */
export function calculateTextDiff(original: string, corrected: string): DiffSegment[] {
  if (!original && !corrected) {
    return [];
  }
  
  if (!original) {
    return [{ type: 'added', text: corrected }];
  }
  
  if (!corrected) {
    return [{ type: 'removed', text: original, originalText: original }];
  }
  
  const tokens1 = tokenize(original);
  const tokens2 = tokenize(corrected);
  
  // Get LCS for alignment
  const lcs = computeLCS(tokens1, tokens2);
  
  const result: DiffSegment[] = [];
  
  let i1 = 0;
  let i2 = 0;
  
  for (const [lcs1, lcs2] of lcs) {
    // Handle tokens before this LCS match
    const removed: string[] = [];
    const added: string[] = [];
    
    while (i1 < lcs1) {
      removed.push(tokens1[i1]);
      i1++;
    }
    
    while (i2 < lcs2) {
      added.push(tokens2[i2]);
      i2++;
    }
    
    // Determine if this is a modification or separate add/remove
    if (removed.length > 0 && added.length > 0) {
      // Check if they're similar enough to be a "modification"
      const removedText = removed.join('');
      const addedText = added.join('');
      
      // Filter out pure whitespace differences
      const removedNoWs = removed.filter(t => !isWhitespace(t));
      const addedNoWs = added.filter(t => !isWhitespace(t));
      
      if (removedNoWs.length === 0 && addedNoWs.length === 0) {
        // Only whitespace changed - keep the corrected version without highlighting
        result.push({ type: 'unchanged', text: addedText });
      } else {
        result.push({
          type: 'modified',
          text: addedText,
          originalText: removedText
        });
      }
    } else {
      if (removed.length > 0) {
        // Pure removal (text was deleted)
        // We'll show this as a marker that something was removed
        const removedText = removed.join('');
        if (!removed.every(t => isWhitespace(t))) {
          result.push({
            type: 'removed',
            text: '', // Empty in corrected, but we track original
            originalText: removedText
          });
        }
      }
      
      if (added.length > 0) {
        const addedText = added.join('');
        if (added.every(t => isWhitespace(t))) {
          result.push({ type: 'unchanged', text: addedText });
        } else {
          result.push({ type: 'added', text: addedText });
        }
      }
    }
    
    // Add the matching token from corrected text
    result.push({ type: 'unchanged', text: tokens2[lcs2] });
    i1 = lcs1 + 1;
    i2 = lcs2 + 1;
  }
  
  // Handle remaining tokens after last LCS match
  const removed: string[] = [];
  const added: string[] = [];
  
  while (i1 < tokens1.length) {
    removed.push(tokens1[i1]);
    i1++;
  }
  
  while (i2 < tokens2.length) {
    added.push(tokens2[i2]);
    i2++;
  }
  
  if (removed.length > 0 && added.length > 0) {
    const removedText = removed.join('');
    const addedText = added.join('');
    const removedNoWs = removed.filter(t => !isWhitespace(t));
    const addedNoWs = added.filter(t => !isWhitespace(t));
    
    if (removedNoWs.length === 0 && addedNoWs.length === 0) {
      result.push({ type: 'unchanged', text: addedText });
    } else {
      result.push({
        type: 'modified',
        text: addedText,
        originalText: removedText
      });
    }
  } else {
    if (removed.length > 0) {
      const removedText = removed.join('');
      if (!removed.every(t => isWhitespace(t))) {
        result.push({
          type: 'removed',
          text: '',
          originalText: removedText
        });
      }
    }
    
    if (added.length > 0) {
      const addedText = added.join('');
      if (added.every(t => isWhitespace(t))) {
        result.push({ type: 'unchanged', text: addedText });
      } else {
        result.push({ type: 'added', text: addedText });
      }
    }
  }
  
  // Merge consecutive unchanged segments
  const merged: DiffSegment[] = [];
  for (const segment of result) {
    const last = merged[merged.length - 1];
    if (last && last.type === 'unchanged' && segment.type === 'unchanged') {
      last.text += segment.text;
    } else {
      merged.push(segment);
    }
  }
  
  return merged;
}

/**
 * Check if there are any meaningful differences between texts.
 */
export function hasSignificantDiff(original: string, corrected: string): boolean {
  const diff = calculateTextDiff(original, corrected);
  return diff.some(s => s.type !== 'unchanged');
}
