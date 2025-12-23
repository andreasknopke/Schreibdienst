import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const SYSTEM_PROMPT = `Du bist ein medizinischer Diktat-Assistent. Deine Aufgabe ist es, diktierte medizinische Texte zu korrigieren und Sprachbefehle auszuführen.

REGELN:
1. Korrigiere Grammatik, Rechtschreibung und Zeichensetzung
2. Behalte den medizinischen Fachinhalt exakt bei
3. Führe Diktat-Sprachbefehle aus und entferne sie aus dem Text:
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
4. Entferne Füllwörter wie "ähm", "äh", "also", "sozusagen" wenn sie keinen Sinn ergeben
5. Formatiere Aufzählungen sauber
6. Gib NUR den korrigierten Text zurück, keine Erklärungen

BEISPIEL:
Input: "Der Patient äh klagt über Kopfschmerzen Punkt Er hat auch Fieber Komma etwa 38 Grad Punkt Neuer Absatz Die Diagnose lautet lösche das letzte Wort ergibt"
Output: "Der Patient klagt über Kopfschmerzen. Er hat auch Fieber, etwa 38 Grad.

Die Diagnose ergibt"`;

const BEFUND_SYSTEM_PROMPT = `Du bist ein medizinischer Diktat-Assistent für radiologische/medizinische Befunde. Deine Aufgabe ist es, diktierte Texte in drei Feldern zu korrigieren.

REGELN:
1. Korrigiere Grammatik, Rechtschreibung und Zeichensetzung in allen drei Feldern
2. Behalte den medizinischen Fachinhalt exakt bei
3. Führe Diktat-Sprachbefehle aus (wie "Punkt", "Komma", "neuer Absatz", etc.) und entferne sie
4. Entferne Füllwörter wie "ähm", "äh" wenn sie keinen Sinn ergeben
5. Entferne Feld-Steuerbefehle wie "Methodik:", "Befund:", "Beurteilung:", "Zusammenfassung:" aus dem Text
6. Gib die korrigierten Texte im JSON-Format zurück

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
    const { text, previousCorrectedText, befundFields, suggestBeurteilung, methodik, befund } = body as { 
      text?: string; 
      previousCorrectedText?: string;
      befundFields?: BefundFields;
      suggestBeurteilung?: boolean;
      methodik?: string;
      befund?: string;
    };
    
    // Beurteilung vorschlagen basierend auf Befund
    if (suggestBeurteilung && befund) {
      const userMessage = methodik 
        ? `Erstelle eine Beurteilung basierend auf folgenden Informationen:\n\nMethodik:\n"""${methodik}"""\n\nBefund:\n"""${befund}"""`
        : `Erstelle eine Beurteilung basierend auf folgendem Befund:\n\n"""${befund}"""`;

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

      return NextResponse.json({ suggestedBeurteilung });
    }
    
    // Befund-Modus: Drei Felder korrigieren
    if (befundFields) {
      const hasContent = befundFields.methodik?.trim() || befundFields.befund?.trim() || befundFields.beurteilung?.trim();
      if (!hasContent) {
        return NextResponse.json({ befundFields: { methodik: '', befund: '', beurteilung: '' } });
      }

      const userMessage = `Korrigiere die folgenden drei Felder eines medizinischen Befunds:

Methodik:
"""${befundFields.methodik || ''}"""

Befund:
"""${befundFields.befund || ''}"""

Beurteilung:
"""${befundFields.beurteilung || ''}"""

Antworte NUR mit dem JSON-Objekt.`;

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: BEFUND_SYSTEM_PROMPT },
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
        return NextResponse.json({ 
          befundFields: {
            methodik: correctedFields.methodik || befundFields.methodik || '',
            befund: correctedFields.befund || befundFields.befund || '',
            beurteilung: correctedFields.beurteilung || befundFields.beurteilung || ''
          }
        });
      } catch (parseError) {
        console.error('JSON parse error:', parseError);
        return NextResponse.json({ befundFields });
      }
    }
    
    // Standard-Modus: Einzelner Text
    if (!text || text.trim().length === 0) {
      return NextResponse.json({ correctedText: '' });
    }

    // Kontext für inkrementelle Korrektur
    const userMessage = previousCorrectedText 
      ? `Bisheriger korrigierter Text:\n"""${previousCorrectedText}"""\n\nNeuer diktierter Text zum Korrigieren und Anfügen:\n"""${text}"""\n\nGib den vollständigen korrigierten Text zurück (bisheriger + neuer Text).`
      : `Korrigiere den folgenden diktierten Text:\n"""${text}"""`;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
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

    return NextResponse.json({ correctedText });
  } catch (e: any) {
    console.error('Correction error:', e);
    return NextResponse.json({ error: 'Correction error', message: e?.message }, { status: 500 });
  }
}
