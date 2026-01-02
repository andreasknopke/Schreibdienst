# Korrekturprotokoll für Offline-Diktate

## Überblick

Das Korrekturprotokoll-System verfolgt alle automatischen und manuellen Korrekturen, die an Offline-Diktaten vorgenommen werden. Dies ermöglicht eine vollständige Nachvollziehbarkeit des Korrekturprozesses.

## Korrekturtypen

Das System unterscheidet vier verschiedene Typen von Korrekturen:

### 1. Text Formatting (`textFormatting`)
- **Beschreibung**: Automatische Formatierungskorrekturen durch `preprocessTranscription()`
- **Umfasst**: 
  - Anwendung von Formatierungskommandos ("neuer Absatz", "neue Zeile", etc.)
  - Wörterbuchkorrekturen (Dictionary-Einträge)
  - Entfernung von Füllwörtern
- **Gespeicherte Daten**: 
  - Text vor der Formatierung
  - Text nach der Formatierung
  - Änderungs-Score (0-100)

### 2. LLM-Korrektur (`llm`)
- **Beschreibung**: KI-gestützte Korrektur durch LLM (GPT, Mistral, LM Studio)
- **Umfasst**:
  - Grammatikkorrektur
  - Rechtschreibkorrektur
  - Medizinische Fachbegriffkorrektur
- **Gespeicherte Daten**:
  - Text vor LLM-Korrektur
  - Text nach LLM-Korrektur
  - Verwendetes Modell (z.B. "gpt-4o-mini")
  - Provider (z.B. "openai", "mistral", "lmstudio")
  - Änderungs-Score (0-100)

### 3. Double Precision (`doublePrecision`)
- **Beschreibung**: Merge-Korrektur bei Double Precision Pipeline
- **Umfasst**:
  - Zusammenführung zweier Transkriptionen
  - LLM-gestützte Auflösung von Unterschieden
- **Gespeicherte Daten**:
  - Text vor dem Merge (primäre Transkription)
  - Text nach dem Merge
  - Verwendetes Modell für den Merge
  - Provider
  - Änderungs-Score (0-100)

### 4. Manuelle Korrektur (`manual`)
- **Beschreibung**: Benutzer-Korrekturen im Editor
- **Umfasst**:
  - Alle manuellen Textänderungen durch den Benutzer
- **Gespeicherte Daten**:
  - Text vor der manuellen Korrektur
  - Text nach der manuellen Korrektur
  - Username des Benutzers
  - Änderungs-Score (0-100)

## Datenbank-Schema

```sql
CREATE TABLE correction_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  dictation_id INT NOT NULL,
  correction_type ENUM('textFormatting', 'llm', 'doublePrecision', 'manual') NOT NULL,
  model_name VARCHAR(255) DEFAULT NULL,
  model_provider VARCHAR(100) DEFAULT NULL,
  username VARCHAR(255) DEFAULT NULL,
  text_before LONGTEXT NOT NULL,
  text_after LONGTEXT NOT NULL,
  change_score INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_dictation_id (dictation_id),
  INDEX idx_correction_type (correction_type),
  INDEX idx_created_at (created_at),
  FOREIGN KEY (dictation_id) REFERENCES offline_dictations(id) ON DELETE CASCADE
)
```

## API-Endpunkte

### Korrekturprotokoll abrufen

```
GET /api/correction-log?dictationId=123
```

**Response**:
```json
[
  {
    "id": 1,
    "dictation_id": 123,
    "correction_type": "textFormatting",
    "text_before": "Patient hat Fieber neuer Absatz Temperatur 38.5",
    "text_after": "Patient hat Fieber\n\nTemperatur 38.5",
    "change_score": 5,
    "created_at": "2026-01-02T10:30:00Z"
  },
  {
    "id": 2,
    "dictation_id": 123,
    "correction_type": "llm",
    "model_name": "gpt-4o-mini",
    "model_provider": "openai",
    "text_before": "Patient hat Fieber\n\nTemperatur 38.5",
    "text_after": "Patient hat Fieber.\n\nTemperatur: 38,5°C",
    "change_score": 8,
    "created_at": "2026-01-02T10:30:05Z"
  },
  {
    "id": 3,
    "dictation_id": 123,
    "correction_type": "manual",
    "username": "dr.mueller",
    "text_before": "Patient hat Fieber.\n\nTemperatur: 38,5°C",
    "text_after": "Patient hat Fieber.\n\nTemperatur: 39,0°C (korrigiert)",
    "change_score": 12,
    "created_at": "2026-01-02T10:35:00Z"
  }
]
```

### Statistik abrufen

```
GET /api/correction-log?dictationId=123&stats=true
```

**Response**:
```json
{
  "totalCorrections": 3,
  "byType": {
    "textFormatting": 1,
    "llm": 1,
    "manual": 1
  }
}
```

## Automatische Migration

Die Tabelle `correction_log` wird automatisch beim ersten Zugriff auf die Datenbank erstellt. Die Migration erfolgt durch:

1. `initOfflineDictationTable()` in [lib/offlineDictationDb.ts](lib/offlineDictationDb.ts)
2. `initOfflineDictationTableWithRequest()` mit Request-Context

Keine manuellen Migrationsschritte erforderlich!

## Code-Integration

### In Worker (lib/offlineDictationDb.ts)

```typescript
// Text Formatting Protokollierung
await logTextFormattingCorrectionWithRequest(
  request,
  dictationId,
  textBefore,
  textAfter,
  changeScore
);

// LLM Korrektur Protokollierung
await logLLMCorrectionWithRequest(
  request,
  dictationId,
  textBefore,
  textAfter,
  modelName,
  modelProvider,
  changeScore
);

// Double Precision Protokollierung
await logDoublePrecisionCorrectionWithRequest(
  request,
  dictationId,
  textBefore,
  textAfter,
  modelName,
  modelProvider,
  changeScore
);
```

### In API Route (app/api/offline-dictations/route.ts)

```typescript
// Manuelle Korrektur Protokollierung
await logManualCorrectionWithRequest(
  req,
  dictationId,
  textBefore,
  textAfter,
  username,
  changeScore
);
```

## Vorteile

1. **Vollständige Transparenz**: Jede Änderung wird dokumentiert
2. **Qualitätskontrolle**: Nachvollziehbarkeit des Korrekturprozesses
3. **Audit-Trail**: Wer hat wann was geändert?
4. **Modell-Vergleich**: Welches Modell macht welche Änderungen?
5. **Lerneffekt**: Analyse typischer Fehler und Korrekturmuster

## Verwendung im Frontend

Das Korrekturprotokoll kann im Frontend verwendet werden, um:

- Einen Änderungsverlauf anzuzeigen
- Unterschiede zwischen verschiedenen Korrekturschritten zu visualisieren
- Statistiken über Korrekturhäufigkeiten zu zeigen
- Eine "Undo"-Funktion zu implementieren (zurück zu früheren Versionen)
