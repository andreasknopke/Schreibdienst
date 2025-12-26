import { NextResponse } from 'next/server';
import { formatDictionaryForPrompt, applyDictionary } from '@/lib/dictionary';

export const runtime = 'nodejs';

const SYSTEM_PROMPT = `Du bist ein medizinischer Diktat-Assistent mit Expertise in medizinischer Fachterminologie. Deine Aufgabe ist es, diktierte medizinische Texte zu korrigieren und Sprachbefehle auszuführen.

WICHTIG - MEDIZINISCHE FACHBEGRIFFE:
- Behalte alle medizinischen Fachbegriffe EXAKT bei (z.B. "Plattenosteosynthese", "Cholezystektomie", "Osteochondrose")
- Verändere NIEMALS Fachtermini, auch wenn sie wie Tippfehler aussehen
- Im Zweifelsfall: Originalwort beibehalten statt ändern
- Typische Endungen wie "-ektomie", "-itis", "-ose", "-synthese", "-plastik" etc. müssen erhalten bleiben

REGELN:
1. Korrigiere Grammatik, Rechtschreibung und Zeichensetzung - ABER NICHT medizinische Fachbegriffe
2. Behalte den medizinischen Fachinhalt und alle Fachtermini exakt bei
3. Konvertiere alle Datumsangaben in das Format DD.MM.YYYY (z.B. "23. Dezember 2025" → "23.12.2025")
4. Führe Diktat-Sprachbefehle aus und entferne sie aus dem Text:
   - "Punkt" → Füge einen Punkt ein
   - "Komma" → Füge ein Komma ein
   - "neuer Absatz" / "nächster Absatz" / "Absatz" → Füge einen Absatzumbruch ein
   - "neue Zeile" / "nächste Zeile" → Füge einen Zeilenumbruch ein
   - "lösche den letzten Satz" / "letzten Satz löschen" → Entferne den letzten Satz
   - "lösche den letzten Absatz" / "letzten Absatz löschen" → Entferne den letzten Absatz
   - "lösche das letzte Wort" / "letztes Wort löschen" → Entferne das letzte Wort
   - "Doppelpunkt" → Füge einen Doppelpunkt ein
   - "Semikolon" → Füge ein Semikolon ein
   - "Anführungszeichen auf/zu" → Füge Anführungszeichen ein
   - "in Klammern" → Setze den folgenden Text in Klammern
   - "Klammer auf/zu" → Füge Klammer ein
5. Entferne Füllwörter wie "ähm", "äh", "also", "sozusagen" wenn sie keinen Sinn ergeben
6. Formatiere Aufzählungen sauber
7. Prüfe am Ende: Sind alle medizinischen Fachbegriffe korrekt und sinnvoll? Falls nicht, korrigiere zur korrekten Fachterminologie.
8. Gib NUR den korrigierten Text zurück, keine Erklärungen

BEISPIEL:
Input: "Der Patient äh klagt über Kopfschmerzen Punkt Er hat auch Fieber Komma etwa 38 Grad Punkt Neuer Absatz Die Diagnose lautet lösche das letzte Wort ergibt"
Output: "Der Patient klagt über Kopfschmerzen. Er hat auch Fieber, etwa 38 Grad.

Die Diagnose ergibt"`;

const BEFUND_SYSTEM_PROMPT = `Du bist ein medizinischer Diktat-Assistent für radiologische/medizinische Befunde mit Expertise in medizinischer Fachterminologie. Deine Aufgabe ist es, diktierte Texte in drei Feldern zu korrigieren.

WICHTIG - MEDIZINISCHE FACHBEGRIFFE:
- Behalte alle medizinischen Fachbegriffe EXAKT bei
- Beispiele: "Plattenosteosynthese", "Spondylodese", "Diskektomie", "Laminektomie", "Arthroplastik"
- Verändere NIEMALS Fachtermini - auch wenn sie wie Tippfehler aussehen könnten
- Radiologische Begriffe wie "hyperintens", "hypointens", "KM-Enhancement" etc. beibehalten
- Im Zweifelsfall: Originalwort beibehalten statt ändern

REGELN:
1. Korrigiere Grammatik, Rechtschreibung und Zeichensetzung - ABER NICHT medizinische Fachbegriffe
2. Behalte den medizinischen Fachinhalt und alle Fachtermini exakt bei
3. Konvertiere alle Datumsangaben in das Format DD.MM.YYYY (z.B. "23. Dezember 2025" → "23.12.2025")
4. Führe Diktat-Sprachbefehle aus (wie "Punkt", "Komma", "neuer Absatz", etc.) und entferne sie
5. Entferne Füllwörter wie "ähm", "äh" wenn sie keinen Sinn ergeben
6. Entferne Feld-Steuerbefehle wie "Methodik:", "Befund:", "Beurteilung:", "Zusammenfassung:" aus dem Text
7. Prüfe am Ende jeden Text auf fachsprachliche Korrektheit und Sinnhaftigkeit
8. Gib die korrigierten Texte im JSON-Format zurück

Du erhältst drei Felder:
- methodik: Beschreibung der Untersuchungsmethodik
- befund: Die eigentlichen Befunde/Beobachtungen
- beurteilung: Die Zusammenfassung/Beurteilung

Antworte NUR mit einem JSON-Objekt in diesem Format:
{
  "methodik": "korrigierter Methodik-Text",
  "befund": "korrigierter Befund-Text",
  "beurteilung": "korrigierter Beurteilungs-Text"
}`;

interface BefundFields {
  methodik: string;
  befund: string;
  beurteilung: string;
}

const BEURTEILUNG_SUGGEST_PROMPT = `Du bist ein erfahrener Radiologe/Mediziner. Basierend auf den vorliegenden Befunden sollst du eine knappe, medizinisch korrekte Beurteilung/Zusammenfassung erstellen.

REGELN:
1. Fasse die wesentlichen Befunde prägnant zusammen
2. Gib eine klare diagnostische Einschätzung
3. Verwende medizinische Fachterminologie korrekt
4. Halte die Beurteilung kurz und präzise (2-4 Sätze)
5. Wenn relevant, gib Empfehlungen für weitere Diagnostik oder Verlaufskontrollen
6. Antworte NUR mit der Beurteilung, keine Erklärungen oder Einleitungen

BEISPIEL-FORMAT:
"Kein Nachweis einer akuten intrakraniellen Pathologie. Altersentsprechend unauffälliger Befund. Empfehlung: Bei persistierender Symptomatik klinische Verlaufskontrolle."`;

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Server misconfigured: OPENAI_API_KEY missing' }, { status: 500 });
    }

    const body = await req.json();
    const { text, previousCorrectedText, befundFields, suggestBeurteilung, methodik, befund, username } = body as { 
      text?: string; 
      previousCorrectedText?: string;
      befundFields?: BefundFields;
      suggestBeurteilung?: boolean;
      methodik?: string;
      befund?: string;
      username?: string;
    };
    
    // Get user's dictionary for personalized corrections
    const dictionaryPrompt = username ? formatDictionaryForPrompt(username) : '';
    
    // Combine system prompt with dictionary
    const enhancedSystemPrompt = dictionaryPrompt 
      ? `${SYSTEM_PROMPT}\n${dictionaryPrompt}`
      : SYSTEM_PROMPT;
    
    const enhancedBefundPrompt = dictionaryPrompt 
      ? `${BEFUND_SYSTEM_PROMPT}\n${dictionaryPrompt}`
      : BEFUND_SYSTEM_PROMPT;
    
    // Beurteilung vorschlagen basierend auf Befund
    if (suggestBeurteilung && befund) {
      console.log('\n=== LLM Correction: Suggest Beurteilung ===');
      const startTime = Date.now();
      const inputLength = (methodik?.length || 0) + befund.length;
      console.log(`[Input] Methodik: ${methodik?.length || 0} chars, Befund: ${befund.length} chars, Total: ${inputLength} chars`);
      
      const userMessage = methodik 
        ? `Erstelle eine Beurteilung basierend auf folgenden Informationen:\n\nMethodik:\n"""${methodik}"""\n\nBefund:\n"""${befund}"""`
        : `Erstelle eine Beurteilung basierend auf folgendem Befund:\n\n"""${befund}"""`;

      console.log(`[LLM] Model: gpt-4o-mini, Mode: Suggest Beurteilung, Temperature: 0.3`);
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: BEURTEILUNG_SUGGEST_PROMPT },
            { role: 'user', content: userMessage }
          ],
          temperature: 0.3,
          max_tokens: 500,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error('OpenAI API error:', res.status, errorText);
        return NextResponse.json({ error: 'OpenAI API error', details: errorText }, { status: res.status });
      }

      const data = await res.json();
      const suggestedBeurteilung = data.choices?.[0]?.message?.content?.trim() || '';
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      const tokens = data.usage ? `${data.usage.prompt_tokens}/${data.usage.completion_tokens}` : 'unknown';
      console.log(`[Success] Duration: ${duration}s, Tokens (in/out): ${tokens}, Output: ${suggestedBeurteilung.length} chars`);
      console.log('=== LLM Correction Complete ===\n');

      return NextResponse.json({ suggestedBeurteilung });
    }
    
    // Befund-Modus: Drei Felder korrigieren
    if (befundFields) {
      console.log('\n=== LLM Correction: Befund Fields ===');
      const startTime = Date.now();
      const hasContent = befundFields.methodik?.trim() || befundFields.befund?.trim() || befundFields.beurteilung?.trim();
      if (!hasContent) {
        console.log('[Skip] All fields empty');
        return NextResponse.json({ befundFields: { methodik: '', befund: '', beurteilung: '' } });
      }
      
      const inputLengths = {
        methodik: befundFields.methodik?.length || 0,
        befund: befundFields.befund?.length || 0,
        beurteilung: befundFields.beurteilung?.length || 0
      };
      const totalInput = inputLengths.methodik + inputLengths.befund + inputLengths.beurteilung;
      console.log(`[Input] Methodik: ${inputLengths.methodik} chars, Befund: ${inputLengths.befund} chars, Beurteilung: ${inputLengths.beurteilung} chars, Total: ${totalInput} chars`);
      console.log(`[User] ${username || 'anonymous'}${dictionaryPrompt ? ' (with dictionary)' : ''}`);

      const userMessage = `Korrigiere die folgenden drei Felder eines medizinischen Befunds:

Methodik:
"""${befundFields.methodik || ''}"""

Befund:
"""${befundFields.befund || ''}"""

Beurteilung:
"""${befundFields.beurteilung || ''}"""

Antworte NUR mit dem JSON-Objekt.`;

      console.log(`[LLM] Model: gpt-4o-mini, Mode: Befund fields, Temperature: 0.3, Response format: JSON`);
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: enhancedBefundPrompt },
            { role: 'user', content: userMessage }
          ],
          temperature: 0.3,
          max_tokens: 4000,
          response_format: { type: 'json_object' }
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error('OpenAI API error:', res.status, errorText);
        return NextResponse.json({ error: 'OpenAI API error', details: errorText }, { status: res.status });
      }

      const data = await res.json();
      const responseText = data.choices?.[0]?.message?.content?.trim() || '{}';
      
      try {
        const correctedFields = JSON.parse(responseText) as BefundFields;
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        const tokens = data.usage ? `${data.usage.prompt_tokens}/${data.usage.completion_tokens}` : 'unknown';
        const outputLengths = {
          methodik: correctedFields.methodik?.length || 0,
          befund: correctedFields.befund?.length || 0,
          beurteilung: correctedFields.beurteilung?.length || 0
        };
        const totalOutput = outputLengths.methodik + outputLengths.befund + outputLengths.beurteilung;
        console.log(`[Success] Duration: ${duration}s, Tokens (in/out): ${tokens}`);
        console.log(`[Output] Methodik: ${outputLengths.methodik} chars, Befund: ${outputLengths.befund} chars, Beurteilung: ${outputLengths.beurteilung} chars, Total: ${totalOutput} chars`);
        console.log('=== LLM Correction Complete ===\n');
        return NextResponse.json({ 
          befundFields: {
            methodik: correctedFields.methodik || befundFields.methodik || '',
            befund: correctedFields.befund || befundFields.befund || '',
            beurteilung: correctedFields.beurteilung || befundFields.beurteilung || ''
          }
        });
      } catch (parseError) {
        console.error('[Error] JSON parse error:', parseError);
        console.log('=== LLM Correction Failed ===\n');
        return NextResponse.json({ befundFields });
      }
    }
    
    // Standard-Modus: Einzelner Text
    if (!text || text.trim().length === 0) {
      return NextResponse.json({ correctedText: '' });
    }

    console.log('\n=== LLM Correction: Standard Text ===');
    const startTime = Date.now();
    const mode = previousCorrectedText ? 'incremental' : 'single';
    console.log(`[Input] Mode: ${mode}, Text: ${text.length} chars${previousCorrectedText ? `, Previous: ${previousCorrectedText.length} chars` : ''}`);
    console.log(`[User] ${username || 'anonymous'}${dictionaryPrompt ? ' (with dictionary)' : ''}`);

    // Kontext für inkrementelle Korrektur
    const userMessage = previousCorrectedText 
      ? `Bisheriger korrigierter Text:\n"""${previousCorrectedText}"""\n\nNeuer diktierter Text zum Korrigieren und Anfügen:\n"""${text}"""\n\nGib den vollständigen korrigierten Text zurück (bisheriger + neuer Text).`
      : `Korrigiere den folgenden diktierten Text:\n"""${text}"""`;

    console.log(`[LLM] Model: gpt-4o-mini, Mode: Standard text, Temperature: 0.3`);
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: enhancedSystemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error('OpenAI API error:', res.status, errorText);
      return NextResponse.json({ error: 'OpenAI API error', details: errorText }, { status: res.status });
    }

    const data = await res.json();
    const correctedText = data.choices?.[0]?.message?.content?.trim() || text;
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const tokens = data.usage ? `${data.usage.prompt_tokens}/${data.usage.completion_tokens}` : 'unknown';
    console.log(`[Success] Duration: ${duration}s, Tokens (in/out): ${tokens}, Output: ${correctedText.length} chars`);
    console.log('=== LLM Correction Complete ===\n');

    return NextResponse.json({ correctedText });
  } catch (e: any) {
    console.error('[Error] Correction failed:', e.message);
    console.error('[Error] Stack:', e.stack);
    console.log('=== LLM Correction Failed ===\n');
    return NextResponse.json({ error: 'Correction error', message: e?.message }, { status: 500 });
  }
}
