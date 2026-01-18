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

// Basis-Prompt - so kurz wie möglich für schnelle Verarbeitung
const BASE_PROMPT = `Korrigiere NUR falsch erkannte medizinische Fachbegriffe. Ändere nichts anderes. Gib nur den Text zurück.
Beispiele: "Hirn Druck Zeichen"→"Hirndruckzeichen", "M R T"→"MRT", "Liquoraus"→"Liquorraum"`;

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

    // Wähle nur relevante Begriffe (max 50 für Geschwindigkeit)
    const terms = referenceTerms || [];
    const relevantTerms = selectRelevantTerms(terms, text, 50);
    
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
      const prompt = `${cachedSystemPrompt}\n\nInput: ${text}\nOutput:`;
      
      response = await fetch(`${lmStudioUrl}/v1/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: lmStudioModel,
          prompt,
          temperature: 0.1,
          max_tokens: 200,
          stop: ['\n\n', 'Input:'],
          cache_prompt: true,
        }),
      });
    } else {
      // Chat API - Standard
      response = await fetch(`${lmStudioUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: lmStudioModel,
          messages: [
            { role: 'system', content: cachedSystemPrompt },
            { role: 'user', content: text }
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
    
    // Bereinige Output (manchmal fügt das Modell Zusätze hinzu)
    corrected = corrected.split('\n')[0].trim();
    
    const changed = corrected !== text;

    console.log(`[QuickCorrect] ${elapsed}ms${changed ? ` | "${text}" → "${corrected}"` : ''}`);

    return NextResponse.json({ 
      corrected, 
      changed, 
      elapsed,
      cached: cachedTermsHash === termsHash
    });

  } catch (error: any) {
    console.error('[QuickCorrect] Error:', error);
    // Im catch haben wir keinen Zugriff auf text, geben leeres Ergebnis zurück
    return NextResponse.json({ corrected: '', changed: false, error: error.message });
  }
}
