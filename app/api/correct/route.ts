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

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Server misconfigured: OPENAI_API_KEY missing' }, { status: 500 });
    }

    const { text, previousCorrectedText } = (await req.json()) as { 
      text?: string; 
      previousCorrectedText?: string;
    };
    
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
