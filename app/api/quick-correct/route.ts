import { NextRequest, NextResponse } from 'next/server';
import { getRuntimeConfigWithRequest } from '@/lib/configDb';

export const runtime = 'nodejs';

/**
 * Schnelle Fachwort-Korrektur mit LM Studio (lokal)
 * Korrigiert nur medizinische Fachbegriffe, keine Grammatik/Satzbau
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, referenceTerms } = body;

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Text fehlt' }, { status: 400 });
    }

    // LM Studio URL aus Umgebungsvariable
    const lmStudioUrl = process.env.LLM_STUDIO_URL || 'http://localhost:1234';
    const lmStudioModel = process.env.LLM_STUDIO_MODEL || 'meta-llama-3.1-8b-instruct';

    // Referenz-Begriffe aus Textbausteinen formatieren
    const termsContext = referenceTerms && referenceTerms.length > 0
      ? `\n\nReferenz-Fachbegriffe aus dem medizinischen Kontext:\n${referenceTerms.join(', ')}`
      : '';

    const systemPrompt = `Du bist ein medizinischer Transkriptions-Korrektor. Deine EINZIGE Aufgabe ist es, falsch erkannte medizinische Fachbegriffe zu korrigieren.

REGELN:
1. Korrigiere NUR offensichtlich falsch erkannte medizinische Fachbegriffe
2. Ändere NIEMALS Grammatik, Satzbau oder Satzstellung
3. Ändere NIEMALS normale deutsche Wörter
4. Wenn ein Wort einem Referenz-Fachbegriff ähnelt, korrigiere es entsprechend
5. Behalte Groß-/Kleinschreibung bei
6. Gib NUR den korrigierten Text zurück, keine Erklärungen

Beispiele:
- "Hirn Druck Zeichen" → "Hirndruckzeichen"
- "M R T" → "MRT"
- "Liquoraus" → "Liquorraum"
- "Die Ventrikel sind normweit" → "Die Ventrikel sind normweit" (keine Änderung nötig)
${termsContext}`;

    console.log('[QuickCorrect] Using LM Studio at', lmStudioUrl);
    const startTime = Date.now();

    const response = await fetch(`${lmStudioUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: lmStudioModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        temperature: 0.1, // Sehr niedrig für konsistente Korrekturen
        max_tokens: 500,
      }),
    });

    const elapsed = Date.now() - startTime;

    if (!response.ok) {
      const error = await response.text();
      console.error('[QuickCorrect] LM Studio error:', error);
      return NextResponse.json({ corrected: text, changed: false, error: 'API error' });
    }

    const data = await response.json();
    const corrected = data.choices?.[0]?.message?.content?.trim() || text;
    const changed = corrected !== text;

    console.log(`[QuickCorrect] LM Studio response in ${elapsed}ms`);
    if (changed) {
      console.log('[QuickCorrect] Corrected:', text, '→', corrected);
    }

    return NextResponse.json({ corrected, changed, elapsed });

  } catch (error: any) {
    console.error('[QuickCorrect] Error:', error);
    return NextResponse.json({ corrected: request.body, changed: false, error: error.message });
  }
}
