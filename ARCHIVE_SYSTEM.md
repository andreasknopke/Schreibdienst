# Archiv-System für Diktate

## Überblick

Das Archiv-System ermöglicht es, fertiggestellte Diktate als "abgeschlossen" zu markieren und aus der aktiven Warteschlange zu entfernen. Archivierte Diktate bleiben vollständig erhalten und können durchsucht, eingesehen und wiederhergestellt werden.

## Features

### 1. Archivierung
- **Manuelles Archivieren**: Über den "📦 Archivieren" Button in der Diktat-Warteschlange
- **Protokollierung**: Wer und wann archiviert hat wird gespeichert
- **Reversibel**: Diktate können jederzeit wiederhergestellt werden

### 2. Vollständige Datenerhaltung

Alle Layer eines Diktats werden archiviert:

#### Rohe Transkription
- `raw_transcript`: Unbearbeitete Whisper-Ausgabe (vor jeder Formatierung)
- Wird mit 🎤 Symbol angezeigt

#### Befund-Modus (3 Felder)
- `methodik`: Methodikteil des Befunds
- `befund`: Hauptbefund
- `beurteilung`: Zusammenfassung/Beurteilung
- Alle mit 📋 📝 💡 Symbolen gekennzeichnet

#### Arztbrief-Modus
- `transcript`: Formatierter Text
- `corrected_text`: KI-korrigierte Version

#### Metadaten
- Change Score (Änderungsgrad)
- Zeitstempel (Erstellung, Fertigstellung, Archivierung)
- Benutzerinformationen (Ersteller, Archivierer)
- Patienteninformationen

### 3. Korrekturprotokoll

Jedes archivierte Diktat behält sein vollständiges Korrekturprotokoll:

- **Text-Formatierung**: Automatische Formatierungskorrekturen
- **LLM-Korrektur**: KI-gestützte Korrekturen mit Modellinfo
- **Double Precision**: Merge-Korrekturen bei Doppeltranskription
- **Manuelle Korrekturen**: Alle Benutzeränderungen

Zugriff über "📋 Protokoll" Button im Archiv.

## Archiv-Ansicht

### Filtermöglichkeiten

Die Archiv-Ansicht bietet umfangreiche Filteroptionen:

1. **Erstellt von**: Username des Erstellers (nur bei "Alle anzeigen")
2. **Archiviert von**: Username des Archivierers
3. **Patient**: Suche nach Patientenname
4. **Von Datum**: Erstellungsdatum von
5. **Bis Datum**: Erstellungsdatum bis

### Tabellenansicht

Kompakte Übersicht mit:
- Auftragsnummer
- Patienteninformationen
- Ersteller (wenn berechtigt)
- Archivierungsdatum und -user
- Dauer der Aufnahme
- Diktat-Typ (Befund/Arztbrief)
- Change Score

### Detail-Ansicht

Bei Auswahl eines Diktats:

#### Informationsbox
- Diktat-Modus
- Verfügbarkeit von Rohdaten
- Change Score mit Ampelsystem

#### Layer-Toggle
- "🔼 Alle Layer anzeigen" zeigt:
  - Rohe Transkription (orange hinterlegt)
  - Befund-Felder (blau hinterlegt)
  - Korrigierte Version (grün hinterlegt)
- "🔽 Alle Layer ausblenden" zeigt nur finale Version

#### Aktionen
- **📋 Kopieren**: Text in Zwischenablage
- **📋 Protokoll**: Korrekturprotokoll anzeigen
- **↩️ Wiederherstellen**: Zurück in Warteschlange

## Datenbank-Schema

### Neue Felder in `offline_dictations`

```sql
-- Archivierungs-Status
archived BOOLEAN DEFAULT FALSE
archived_at TIMESTAMP NULL
archived_by VARCHAR(255) DEFAULT NULL

-- Index für Performance
INDEX idx_archived (archived)
```

### Automatische Migration

Die Felder werden automatisch hinzugefügt bei:
- Erster Verwendung der Archiv-Funktion
- Start des Workers
- Jeder API-Anfrage an `/api/archive`

Migration erfolgt **on-the-fly** ohne manuelle Eingriffe.

## DB-Token-System

### Wichtig: Multi-Datenbank-Support

Das Archiv-System respektiert vollständig das DB-Token-System:

#### Token-Verwendung
Alle API-Calls verwenden `initOfflineDictationTableWithRequest(request)`:
- Extrahiert DB-Credentials aus `x-db-token` Header
- Führt Migrationen für die spezifische Datenbank durch
- Stellt sicher, dass die richtige Datenbank verwendet wird

#### Migration pro Datenbank
- Jede Datenbank wird nur einmal initialisiert (pro Session)
- Tracking via `tableInitializedPerPool` Map
- Pool-Key: `${host}:${port}:${database}:${user}`

#### Fallback
Wenn kein DB-Token vorhanden:
- Verwendet Standard-Datenbank-Konfiguration
- Pool-Key: `'default'`

## API-Endpunkte

### GET `/api/archive`

Abrufen archivierter Diktate mit Filtern.

**Query-Parameter:**
- `username`: Filter nach Ersteller
- `archivedBy`: Filter nach Archivierer
- `patientName`: Suche im Patientennamen (LIKE)
- `fromDate`: Von-Datum (YYYY-MM-DD)
- `toDate`: Bis-Datum (YYYY-MM-DD)

**Response:**
```json
{
  "dictations": [
    {
      "id": 123,
      "username": "dr.mueller",
      "order_number": "RAD-2026-001",
      "patient_name": "Mustermann, Max",
      "mode": "befund",
      "raw_transcript": "...",
      "methodik": "...",
      "befund": "...",
      "beurteilung": "...",
      "corrected_text": "...",
      "change_score": 15,
      "archived_at": "2026-01-02T14:30:00Z",
      "archived_by": "dr.mueller",
      "created_at": "2026-01-02T10:00:00Z"
    }
  ]
}
```

### POST `/api/archive`

Diktat archivieren.

**Body:**
```json
{
  "id": 123,
  "archivedBy": "dr.mueller"
}
```

**Response:**
```json
{
  "success": true
}
```

### DELETE `/api/archive?id=123`

Diktat wiederherstellen (aus Archiv entfernen).

**Response:**
```json
{
  "success": true
}
```

## Verwendung

### 1. Diktat archivieren

1. Öffne die Diktat-Warteschlange
2. Wähle ein fertiggestelltes Diktat aus
3. Klicke auf "📦 Archivieren"
4. Bestätige die Archivierung
5. Diktat verschwindet aus der Warteschlange

### 2. Archivierte Diktate durchsuchen

1. Wechsle zum "📦 Archiv" Tab
2. Nutze die Filter für gezielte Suche:
   - Nach Datum einschränken
   - Nach Patient suchen
   - Nach User filtern
3. Klicke auf ein Diktat für Details

### 3. Alle Layer anzeigen

1. Wähle ein archiviertes Diktat
2. Klicke auf "🔼 Alle Layer anzeigen"
3. Siehst du:
   - Rohe Whisper-Transkription
   - Formatierte Zwischenschritte
   - Finale korrigierte Version
4. Klicke auf "📋 Protokoll" für detaillierte Änderungshistorie

### 4. Diktat wiederherstellen

1. Wähle archiviertes Diktat
2. Klicke auf "↩️ Wiederherstellen"
3. Diktat erscheint wieder in der Warteschlange
4. Status, Text und alle Metadaten bleiben erhalten

## Berechtigungen

- **Normale Benutzer**: Sehen nur eigene archivierte Diktate
- **Sekretariat/Admin**: Sehen alle archivierten Diktate
- **Filter "Erstellt von"**: Nur bei "Alle anzeigen" Berechtigung sichtbar

## Performance

### Indizes
- `idx_archived`: Schnelle Filterung nach Archivstatus
- `idx_created_at`: Schnelle Sortierung nach Datum
- `idx_username`: Schnelle User-Filterung

### Query-Optimierung
- Archived = TRUE filter bereits auf DB-Ebene
- Nur notwendige Felder werden geladen (ohne audio_data)
- Sortierung nach archived_at DESC (neueste zuerst)

## Best Practices

1. **Regelmäßiges Archivieren**: Halte die Warteschlange übersichtlich
2. **Sinnvolle Filter**: Nutze Datum-Filter für große Archive
3. **Layer-Ansicht bei Bedarf**: Aktiviere nur wenn Details benötigt werden
4. **Korrekturprotokoll für Audit**: Nutze das Protokoll für Qualitätskontrolle

## Technische Details

### Warteschlangen-Integration

Die Warteschlange filtert automatisch archivierte Diktate aus:

```typescript
// In getUserDictationsWithRequest
WHERE username = ? AND (archived IS NULL OR archived = FALSE)
```

### Archiv-Abfrage

```typescript
// In getArchivedDictationsWithRequest
WHERE archived = TRUE
  AND username = ?  // optional
  AND archived_by = ?  // optional
  AND patient_name LIKE ?  // optional
  AND created_at >= ?  // optional
  AND created_at <= ?  // optional
ORDER BY archived_at DESC
```

### Migration-Code

```typescript
// Wird für jede neue Datenbank automatisch ausgeführt
await db.execute(`ALTER TABLE offline_dictations ADD COLUMN archived BOOLEAN DEFAULT FALSE`);
await db.execute(`ALTER TABLE offline_dictations ADD COLUMN archived_at TIMESTAMP NULL`);
await db.execute(`ALTER TABLE offline_dictations ADD COLUMN archived_by VARCHAR(255)`);
await db.execute(`CREATE INDEX idx_archived ON offline_dictations(archived)`);
```

## Fehlerbehebung

### Archivierte Diktate nicht sichtbar
- Prüfe Filter-Einstellungen
- Setze Filter zurück mit "✕ Filter zurücksetzen"
- Überprüfe Berechtigungen (eigene vs. alle)

### Migration schlägt fehl
- Datenbank-Berechtigungen prüfen (ALTER TABLE, CREATE INDEX)
- Log-Ausgabe in Console prüfen
- Bei Problemen: Migration ist idempotent (kann mehrfach ausgeführt werden)

### Performance-Probleme
- Indizes prüfen: `SHOW INDEX FROM offline_dictations`
- Bei großen Archiven: Datum-Filter verwenden
- Ältere Diktate ggf. aus DB entfernen (nur wenn wirklich nicht mehr benötigt)
