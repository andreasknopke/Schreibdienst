import { NextRequest, NextResponse } from 'next/server';
import { getRuntimeConfigWithRequest } from '@/lib/configDb';

export const runtime = 'nodejs';

/**
 * Schnelle Fachwort-Korrektur mit LM Studio (lokal)
 * Korrigiert nur medizinische Fachbegriffe, keine Grammatik/Satzbau
 * 
 * Optimierungen:
 * 1. Stabiler System-Prompt für KV-Cache Wiederverwendung
 * 2. Kurzer, kompakter Prompt
 * 3. Nur relevante Begriffe (max 50)
 * 4. Completion API falls verfügbar
 */

// Cache für den letzten System-Prompt (zur KV-Cache Optimierung)
let cachedSystemPrompt: string | null = null;
let cachedTermsHash: string | null = null;

// Basis-Prompt mit strikten Regeln gegen Meta-Kommentare
const BASE_PROMPT = `Du korrigierst medizinische Fachbegriffe in diktiertem Text.

REGELN:
1. Korrigiere NUR falsch erkannte medizinische Fachbegriffe
2. Ändere NICHTS anderes (keine Grammatik, keine Umformulierungen)
3. Gib AUSSCHLIESSLICH den korrigierten Text zwischen den Markierungen zurück
4. VERBOTEN: "Keine Korrekturen", "Der korrigierte Text lautet", Erklärungen, Kommentare
5. Wenn keine Korrektur nötig: Gib den Text UNVERÄNDERT zurück

Beispiele:
"Hirn Druck Zeichen" → "Hirndruckzeichen"
"M R T" → "MRT"  
"Liquoraus" → "Liquorraum"
"Die Ventrikel sind normweit" → "Die Ventrikel sind normweit"`;

// Marker für Input/Output
const INPUT_MARKER_START = '<<<DIKTAT_START>>>';
const INPUT_MARKER_END = '<<<DIKTAT_ENDE>>>';

function hashTerms(terms: string[]): string {
  // Nur die ersten 50 Begriffe für stabilen Hash
  return terms.slice(0, 50).sort().join('|');
}

function selectRelevantTerms(terms: string[], inputText: string, maxTerms: number = 50): string[] {
  if (terms.length <= maxTerms) return terms;
  
  // Priorisiere Begriffe die dem Input ähneln
  const inputLower = inputText.toLowerCase();
  const inputWords = inputLower.split(/\s+/);
  
  // Sortiere nach Relevanz (Begriffe die Teile des Inputs enthalten)
  const scored = terms.map(term => {
    const termLower = term.toLowerCase();
    let score = 0;
    
    // Exakter Match im Input
    if (inputLower.includes(termLower)) score += 10;
    
    // Teilweise Übereinstimmung
    for (const word of inputWords) {
      if (word.length > 3 && termLower.includes(word)) score += 3;
      if (word.length > 3 && word.includes(termLower.slice(0, 4))) score += 2;
    }
    
    return { term, score };
  });
  
  // Top N nach Score, dann alphabetisch für Stabilität
  return scored
    .sort((a, b) => b.score - a.score || a.term.localeCompare(b.term))
    .slice(0, maxTerms)
    .map(s => s.term);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, referenceTerms, dictionaryCorrections } = body;

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Text fehlt' }, { status: 400 });
    }

    // LM Studio URL aus Umgebungsvariable
    const lmStudioUrl = process.env.LLM_STUDIO_URL || 'http://localhost:1234';
    const lmStudioModel = process.env.LLM_STUDIO_MODEL || 'meta-llama-3.1-8b-instruct';
    const useCompletionApi = process.env.LLM_USE_COMPLETION === 'true';

    // Wähle nur relevante Begriffe (max 150 für bessere Korrektur)
    const terms = referenceTerms || [];
    const relevantTerms = selectRelevantTerms(terms, text, 150);
    
    // Wörterbuch-Korrekturen formatieren
    const dictCorrections = dictionaryCorrections || [];
    const dictContext = dictCorrections.length > 0
      ? `\nUser-Wörterbuch (falsch→richtig, auch ähnliche Fehler korrigieren): ${dictCorrections.map((d: {wrong: string, correct: string}) => `"${d.wrong}"→"${d.correct}"`).join(', ')}`
      : '';
    
    // Hash für Cache-Stabilität (kombiniert Begriffe und Wörterbuch)
    const termsHash = hashTerms(relevantTerms) + '|' + dictCorrections.map((d: {wrong: string, correct: string}) => `${d.wrong}:${d.correct}`).join(',');
    
    // System-Prompt nur neu bauen wenn sich etwas ändert
    if (cachedSystemPrompt === null || cachedTermsHash !== termsHash) {
      const termsContext = relevantTerms.length > 0
        ? `\nFachbegriffe: ${relevantTerms.join(', ')}`
        : '';

      cachedSystemPrompt = BASE_PROMPT + termsContext + dictContext;
      cachedTermsHash = termsHash;
      console.log(`[QuickCorrect] Prompt aktualisiert (${relevantTerms.length} Begriffe, ${dictCorrections.length} Wörterbuch-Einträge)`);
    }

    const startTime = Date.now();
    let response: Response;

    if (useCompletionApi) {
      // Completion API - effizienter, kein Chat-Overhead
      const prompt = `${cachedSystemPrompt}\n\n${INPUT_MARKER_START}${text}${INPUT_MARKER_END}\n\nKorrigierter Text:`;
      
      response = await fetch(`${lmStudioUrl}/v1/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: lmStudioModel,
          prompt,
          temperature: 0.1,
          max_tokens: 200,
          stop: ['\n\n', INPUT_MARKER_START, 'Input:'],
          cache_prompt: true,
        }),
      });
    } else {
      // Chat API - Standard mit Markern
      const userContent = `${INPUT_MARKER_START}${text}${INPUT_MARKER_END}`;
      
      response = await fetch(`${lmStudioUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: lmStudioModel,
          messages: [
            { role: 'system', content: cachedSystemPrompt },
            { role: 'user', content: userContent }
          ],
          temperature: 0.1,
          max_tokens: 200,
          cache_prompt: true,
        }),
      });
    }

    const elapsed = Date.now() - startTime;

    if (!response.ok) {
      const error = await response.text();
      console.error('[QuickCorrect] LM Studio error:', error);
      return NextResponse.json({ corrected: text, changed: false, error: 'API error' });
    }

    const data = await response.json();
    
    // Extrahiere Text je nach API
    let corrected: string;
    if (useCompletionApi) {
      corrected = data.choices?.[0]?.text?.trim() || text;
    } else {
      corrected = data.choices?.[0]?.message?.content?.trim() || text;
    }
    
    // Entferne Marker falls das LLM sie zurückgibt
    corrected = corrected
      .replace(INPUT_MARKER_START, '')
      .replace(INPUT_MARKER_END, '')
      .trim();
    
    // Bereinige Output (manchmal fügt das Modell Zusätze hinzu)
    corrected = corrected.split('\n')[0].trim();
    
    // Wenn leer → Original zurück
    if (!corrected) {
      return NextResponse.json({ corrected: text, changed: false, elapsed, filtered: true });
    }
    
    // ÄHNLICHKEITS-CHECK: Wenn sich der Text zu stark unterscheidet → Original nehmen
    // Berechne Wort-Überlappung (Jaccard-Ähnlichkeit)
    const inputWords = new Set(text.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const outputWords = new Set(corrected.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    
    // Gemeinsame Wörter
    const intersection = new Set([...inputWords].filter(w => outputWords.has(w)));
    // Vereinigung
    const union = new Set([...inputWords, ...outputWords]);
    
    // Jaccard-Ähnlichkeit: intersection / union
    const similarity = union.size > 0 ? intersection.size / union.size : 1;
    
    // Wenn Ähnlichkeit < 70% → zu unterschiedlich, nehme Original
    const MIN_SIMILARITY = 0.7;
    if (similarity < MIN_SIMILARITY) {
      console.warn(`[QuickCorrect] Text zu unterschiedlich (${(similarity * 100).toFixed(0)}% Ähnlichkeit), nehme Original`);
      return NextResponse.json({ corrected: text, changed: false, elapsed, filtered: true, similarity });
    }
    
    // Längenvalidierung: Ausgabe darf nicht viel länger/kürzer sein als Input
    const lengthRatio = corrected.length / text.length;
    if (lengthRatio > 1.5 || lengthRatio < 0.5) {
      console.warn(`[QuickCorrect] Länge zu unterschiedlich (${(lengthRatio * 100).toFixed(0)}%), nehme Original`);
      return NextResponse.json({ corrected: text, changed: false, elapsed, filtered: true });
    }
    
    const changed = corrected !== text;

    console.log(`[QuickCorrect] ${elapsed}ms | ${(similarity * 100).toFixed(0)}% ähnlich${changed ? ` | "${text}" → "${corrected}"` : ''}`);

    return NextResponse.json({ 
      corrected, 
      changed, 
      elapsed,
      similarity,
      cached: cachedTermsHash === termsHash
    });

  } catch (error: any) {
    console.error('[QuickCorrect] Error:', error);
    // Im catch haben wir keinen Zugriff auf text, geben leeres Ergebnis zurück
    return NextResponse.json({ corrected: '', changed: false, error: error.message });
  }
}
