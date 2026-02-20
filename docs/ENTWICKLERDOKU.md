# Schreibdienst – Entwicklerdokumentation

Diese Dokumentation richtet sich an externe Entwickler, die das Projekt schnell verstehen und gezielt erweitern wollen.

Ergänzend zur Feature-Dokumentation: **API-Details mit Request/Response-Beispielen** findest du in `docs/API_REFERENZ.md`.

---

## 1) Zielbild der Anwendung

**Schreibdienst** ist eine medizinische Diktier- und Korrekturplattform mit zwei Hauptmodi:

- **Live-Diktat (online)**: Aufnahme im Browser, Live-Transkription, KI-Korrektur, Diff/Ampel, Export.
- **Offline-Diktat (Queue-basiert)**: Aufnahme oder Import, asynchrone Worker-Verarbeitung, Review/Archiv.

Systemkomponenten:

1. **Next.js App (Frontend + API-Routen)**
2. **WhisperX-Service (Python, extern erreichbar)**
3. **MySQL (mandantenfähig via DB-Token)**

---

## 2) Schneller Einstieg für Entwickler

### 2.1 Voraussetzungen

- Node.js 18+
- Python 3.10+ (für `whisper-service/`)
- FFmpeg (Audioverarbeitung)
- MySQL

### 2.2 Lokaler Start

1. Next.js starten:
	- `npm install`
	- `cp .env.example .env.local`
	- `npm run dev`
2. Whisper-Service starten (alternativ Docker):
	- `cd whisper-service`
	- `python3 -m venv venv && source venv/bin/activate`
	- `pip install -r requirements.txt`
	- `python app.py`

### 2.2.1 Externe Repositories (empfohlener lokaler Betrieb)

Für Teams, die die STT-Services getrennt vom Hauptprojekt betreiben möchten:

- WhisperX (HTTP/HTML API): https://github.com/andreasknopke/WhisperX
- Fast-Whisper / Whisper-Live (WebSocket API): https://github.com/andreasknopke/Whisper-Live

Empfohlene Reihenfolge:

1. **WhisperX** installieren und stabil testen (`WHISPER_SERVICE_URL`).
2. Danach **Whisper-Live** für Realtime ergänzen (`FAST_WHISPER_WS_URL`).

Minimal-Konfiguration in `.env.local`:

- Für WhisperX:
  - `TRANSCRIPTION_PROVIDER=whisperx`
  - `WHISPER_SERVICE_URL=http://localhost:5000`
- Für Fast-Whisper:
  - `TRANSCRIPTION_PROVIDER=fast_whisper`
  - `FAST_WHISPER_WS_URL=ws://localhost:5001`

### 2.3 Relevante Startpunkte im Code

- UI Live-Modus: `app/page.tsx`
- UI Offline-Modus: `app/offline/page.tsx`
- Layout/Auth-Rahmen: `components/ClientLayout.tsx`, `components/AuthProvider.tsx`
- API-Einstieg: `app/api/**/route.ts`
- Datenzugriff/Business-Logik: `lib/*.ts`

---

## 3) Verzeichnis-Orientierung (für Erweiterungen)

### Frontend

- `app/page.tsx`: Hauptseite (Live-Diktat, Korrektur, Diff, Templates, Actions)
- `app/offline/page.tsx`: Offline-Workflow und Queue-Ansicht
- `components/`: modulare UI-Funktionen (Queue, Wörterbuch, Benutzerverwaltung, Recovery-Logs, etc.)

### API / Backend in Next.js

- `app/api/transcribe/route.ts`: Speech-to-Text Routing + Providerlogik
- `app/api/correct/route.ts`: große KI-Korrekturpipeline
- `app/api/offline-dictations/**`: Queue, Worker, Re-Correct, Status
- `app/api/*`: weitere Feature-Endpoints (Templates, Custom Actions, Archive, Config, etc.)

### Shared Libraries

- `lib/configDb.ts`: runtime Konfigurationswerte
- `lib/offlineDictationDb.ts`: Offline-Diktate/Status/Audio
- `lib/dictionaryDb.ts`, `lib/templatesDb.ts`, `lib/customActionsDb.ts`
- `lib/textFormatting.ts`, `lib/changeScore.ts`, `lib/doublePrecision.ts`
- `lib/audioCompression.ts`, `lib/audio.ts`
- `lib/db.ts`, `lib/dbToken.ts`, `lib/usersDb.ts`

### Externer STT-Service

- `whisper-service/app.py`

---

## 4) Feature-Katalog (Implementierung + Dateien + Test-Szenarien)

## 4.1 Live-Diktat (Realtime)

**Zweck**
- Echtzeitnahe Transkription während der Aufnahme mit anschließender Korrektur.

**Wie umgesetzt**
- Browser nimmt Audio-Chunks auf (Intervall 2s in `app/page.tsx`).
- Chunks/Finalaudio gehen an `POST /api/transcribe`.
- Transkriptionsprovider wird dynamisch über Runtime-Config gewählt (`whisperx`, `elevenlabs`, `mistral`, `fast_whisper`).
- Wörterbuch kann bereits vor LLM-Korrektur einfließen.

**Relevante Dateien**
- UI: `app/page.tsx`, `components/EditableTextWithMitlesen.tsx`
- API: `app/api/transcribe/route.ts`
- Lib: `lib/audioCompression.ts`, `lib/dictionaryDb.ts`, `lib/configDb.ts`, `lib/useFastWhisper.ts`

**Test-Szenarien**
1. **Happy Path WhisperX**
	- Provider auf `whisperx` setzen, Aufnahme starten/stoppen, Text erscheint.
2. **Provider-Fallback**
	- WhisperX temporär unerreichbar machen, Fallbackpfad prüfen.
3. **Große Audiodatei**
	- Lange Aufnahme laden, prüfen dass Normalisierung/Kompression greift.
4. **Halluzinationsbereinigung**
	- Audio mit Wiederholungen testen, prüfen ob Repetition-Filter reduziert.

---

## 4.2 KI-Korrektur (LLM)

**Zweck**
- Korrektur von Whisper-Fehlern, Grammatik, Zahlenformaten und Steuerbefehlen.

**Wie umgesetzt**
- `POST /api/correct` verarbeitet Text in Chunks (satzbasiert oder zeichenbasiert).
- Provider: OpenAI / LM Studio / Mistral via Runtime-Config.
- Vorverarbeitung über `preprocessTranscription`.
- Ergebnisbereinigung (`removeMarkdownFormatting`, Prompt-Artefakt-Filter).
- Change-Score als Qualitätsindikator.

**Relevante Dateien**
- UI: `app/page.tsx`, `components/ChangeIndicator.tsx`, `components/DiffHighlight.tsx`
- API: `app/api/correct/route.ts`, `app/api/quick-correct/route.ts`
- Lib: `lib/textFormatting.ts`, `lib/changeScore.ts`, `lib/runtimeConfig.ts`

**Test-Szenarien**
1. **LLM-Provider-Switch**
	- OpenAI, LM Studio, Mistral jeweils einmal durchtesten.
2. **Datums-/Zahlenfälle**
	- Diktat mit Datum, Dezimalwerten, Maßeinheiten prüfen.
3. **Prompt-Artefakte**
	- Erwartung: Keine „Korrekturhinweise“ oder Meta-Texte in Antwort.
4. **Quick-Correct**
	- Nur Fachbegriffskorrektur ohne Satzumbau validieren.

---

## 4.3 Befund/Arztbrief-Modus + Feldlogik

**Zweck**
- Unterschiedliche Dokumentstrukturen (z. B. Befund-Felder vs. Fließtext).

**Wie umgesetzt**
- Modus wird in UI-State und User-Default geführt.
- Befund-Modus mit Feldern wie `methodik`, `befund`, `beurteilung`.
- Formatierungswörter („Neuer Absatz“, „Doppelpunkt“ etc.) in Vorverarbeitung.

**Relevante Dateien**
- UI: `app/page.tsx`
- API: `app/api/format/route.ts`, `app/api/users/settings/route.ts`
- Lib: `lib/formatMedical.ts`, `lib/textFormatting.ts`, `lib/usersDb.ts`

**Test-Szenarien**
1. Zwischen Modi wechseln und prüfen, dass Datenstruktur korrekt bleibt.
2. Sprachsteuerwörter diktieren und Formatumsetzung verifizieren.
3. Default-Modus im Benutzerprofil setzen und neu einloggen.

---

## 4.4 Wörterbuch (pro Benutzer)

**Zweck**
- Benutzerdefinierte medizinische Begriffe und Ersetzungen.

**Wie umgesetzt**
- CRUD über `/api/dictionary`.
- `useInPrompt` und `matchStem` beeinflussen Korrekturverhalten.
- Sekretariatsrolle kann optional andere Benutzerwörterbücher verwalten.

**Relevante Dateien**
- UI: `components/DictionaryManager.tsx`, `app/page.tsx`
- API: `app/api/dictionary/route.ts`
- Lib: `lib/dictionaryDb.ts`, `lib/dictionary.ts`

**Test-Szenarien**
1. Eintrag hinzufügen/ändern/löschen.
2. Prüfen, ob Eintrag in Live-Transkript und Korrektur auftaucht.
3. `useInPrompt=true` aktivieren und Effekt vergleichen.

---

## 4.5 Templates (Textbausteine)

**Zweck**
- Wiederverwendbare Vorlagen pro Benutzer/Feld.

**Wie umgesetzt**
- CRUD über `/api/templates`.
- Intelligente Anpassung per LLM über `/api/templates/adapt` (OpenAI erzwungen für Qualität).
- Optionale Wörterbuchanreicherung im Prompt.

**Relevante Dateien**
- UI: `components/TemplatesManager.tsx`, `app/page.tsx`
- API: `app/api/templates/route.ts`, `app/api/templates/adapt/route.ts`
- Lib: `lib/templatesDb.ts`, `lib/dictionaryDb.ts`

**Test-Szenarien**
1. Template anlegen und in Feld einfügen.
2. Adapt-Flow mit widersprüchlicher Änderung (z. B. „unauffällig“ vs pathologisch).
3. Validieren, dass Ausgabe ohne LLM-Metatext zurückkommt.

---

## 4.6 Custom Actions (eigene KI-Aktionen)

**Zweck**
- Benutzerdefinierte Prompt-Buttons auf selektierten Texten/Feldern.

**Wie umgesetzt**
- Aktionen verwalten via `/api/custom-actions`.
- Ausführen via `/api/custom-actions/execute`.
- Ziel-Feldlogik (`current`, `methodik`, `befund`, `beurteilung`, `all`).

**Relevante Dateien**
- UI: `components/CustomActionsManager.tsx`, `components/CustomActionButtons.tsx`
- API: `app/api/custom-actions/route.ts`, `app/api/custom-actions/execute/route.ts`
- Lib: `lib/customActionsDb.ts`

**Test-Szenarien**
1. Action erstellen und ausführen.
2. Fehlerfall ohne Text (sollte validiert abgelehnt werden).
3. Providerwechsel testen (OpenAI/LM Studio/Mistral).

---

## 4.7 Offline-Diktat + Queue

**Zweck**
- Aufnahme/Import ohne unmittelbare Live-Verarbeitung, späteres Abarbeiten durch Worker.

**Wie umgesetzt**
- Erfassung über `app/offline/page.tsx`.
- Speicherung per `/api/offline-dictations` (inkl. Audio-Kompression, Dauerermittlung).
- Verarbeitung über `/api/offline-dictations/worker`.
- Nachkorrektur über `/api/offline-dictations/recorrect`.

**Relevante Dateien**
- UI: `app/offline/page.tsx`, `components/OfflineRecorder.tsx`, `components/DictationQueue.tsx`
- API: `app/api/offline-dictations/route.ts`, `app/api/offline-dictations/worker/route.ts`, `app/api/offline-dictations/recorrect/route.ts`
- Lib: `lib/offlineDictationDb.ts`, `lib/audioCompression.ts`, `lib/correctionLogDb.ts`, `lib/doublePrecision.ts`

**Test-Szenarien**
1. Offline-Diktat aufnehmen, Queue-Eintrag prüfen.
2. Worker-Lauf antriggern und Statuswechsel `pending -> processing -> completed` beobachten.
3. Fehlerfall (Provider down) erzeugen, Retry auslösen.
4. Manuelle Korrektur speichern und Logeintrag prüfen.

---

## 4.8 SpeaKING-Import (.dictation XML + Audio)

**Zweck**
- Fremdimport bestehender Diktate inkl. Metadaten.

**Wie umgesetzt**
- Upload via `/api/import-dictation`.
- XML Parsing mit `fast-xml-parser`.
- Mapping auf interne Offline-Diktat-Struktur.
- Direkter Start von `processDictation` nach Import.

**Relevante Dateien**
- UI: `app/offline/page.tsx`
- API: `app/api/import-dictation/route.ts`
- Lib: `lib/audio.ts`, `lib/offlineDictationDb.ts`, `lib/audioCompression.ts`

**Test-Szenarien**
1. Gültige `.dictation` + passende Audio-Datei importieren.
2. Fehlerhafte XML testen (erwarteter 400-Fehler).
3. Abweichender Audio-Dateiname: UI-Hinweise und Importverhalten prüfen.

---

## 4.9 Archiv + Korrekturprotokolle

**Zweck**
- Nachvollziehbarkeit und historischer Zugriff auf bearbeitete Diktate.

**Wie umgesetzt**
- Archivieren/Entarchivieren über `/api/archive`.
- Korrekturlogs über `/api/correction-log` (Einträge + Statistik).
- Logs werden in verschiedenen Verarbeitungsstufen geschrieben (Formatierung, LLM, manuell, Double Precision).

**Relevante Dateien**
- UI: `components/ArchiveView.tsx`, `components/CorrectionLogViewer.tsx`
- API: `app/api/archive/route.ts`, `app/api/correction-log/route.ts`
- Lib: `lib/offlineDictationDb.ts`, `lib/correctionLogDb.ts`

**Test-Szenarien**
1. Diktat archivieren und in Archivliste mit Filtern suchen.
2. Entarchivieren und Rückkehr in aktive Queue prüfen.
3. Korrekturlog für Diktat abrufen (inkl. Stats-Endpoint).

---

## 4.10 Benutzer, Rollen, Auth

**Zweck**
- Zugriffsschutz, Rollensteuerung (Admin/Sekretariat), Benutzereinstellungen.

**Wie umgesetzt**
- Basic-Auth via `/api/auth`.
- Benutzerverwaltung via `/api/users` (Admin-only).
- Nutzerpräferenzen via `/api/users/settings`.
- Clientseitiges Session-Persisting in `localStorage` über `AuthProvider`.

**Relevante Dateien**
- UI: `components/LoginForm.tsx`, `components/UserManagement.tsx`, `components/UserMenu.tsx`, `components/AuthProvider.tsx`
- API: `app/api/auth/route.ts`, `app/api/users/route.ts`, `app/api/users/settings/route.ts`
- Lib: `lib/usersDb.ts`

**Test-Szenarien**
1. Login mit gültig/ungültig.
2. Admin erstellt/löscht User, setzt Berechtigungen.
3. Sekretariatsnutzer sieht globale Queue, Standardnutzer nur eigene Daten.
4. `autoCorrect` umstellen und Persistenz nach Reload prüfen.

---

## 4.11 DB-Token / Mandantenfähigkeit

**Zweck**
- Dynamische DB-Verbindung pro Tenant ohne feste Serverkonfiguration.

**Wie umgesetzt**
- Tokenerzeugung via `/api/db-token` (nur root).
- Token im Client gespeichert und als `X-DB-Token` Header mitgesendet.
- DB-Pool-Auswahl requestbasiert.

**Relevante Dateien**
- UI: `components/DbTokenManager.tsx`, `components/AuthProvider.tsx`
- API: `app/api/db-token/route.ts`
- Lib: `lib/dbToken.ts`, `lib/crypto.ts`, `lib/db.ts`, `lib/fetchWithDbToken.ts`

**Test-Szenarien**
1. Token generieren und aktivieren.
2. API-Request mit/ohne Token vergleichen.
3. Ungültigen Token senden (erwartete Fehlerbehandlung).

---

## 4.12 Konfiguration, Warmup, Monitoring, Recovery

**Zweck**
- Betriebssicherheit für STT/LLM-Provider und Diagnose im Fehlerfall.

**Wie umgesetzt**
- Runtime-Config via `/api/config` (Änderung nur root).
- DB-Migrationen via `/api/config/migrate`.
- Whisper-Warmup via `/api/warmup`.
- Recovery-Operationen via `/api/whisperx-system` und Logs via `/api/whisperx-recovery-logs`.
- Laufzeitstatistik via `/api/stats` und Health-Infos via `/api/health`.

**Relevante Dateien**
- UI: `components/ConfigPanel.tsx`, `components/WhisperXRecoveryLogs.tsx`, `components/HelpPanel.tsx`
- API: `app/api/config/route.ts`, `app/api/config/migrate/route.ts`, `app/api/warmup/route.ts`, `app/api/whisperx-system/route.ts`, `app/api/whisperx-recovery-logs/route.ts`, `app/api/stats/route.ts`, `app/api/health/route.ts`
- Lib: `lib/configDb.ts`, `lib/whisperRecoveryLogDb.ts`

**Test-Szenarien**
1. Provider im Config-Panel umstellen und End-to-End testen.
2. Warmup auslösen und Ersttranskriptionslatenz vergleichen.
3. Recovery-Actions manuell ausführen, Logs und Statistik validieren.
4. Stats/Health bei Last und bei absichtlich gestörtem Backend aufrufen.

---

## 5) Datenmodell (praktische Sicht)

Wichtige Tabellen (vereinfacht):

- `users`
- `dictionary_entries`
- `templates`
- `custom_actions`
- `runtime_config`
- `offline_dictations` (+ Audio-Daten, Segmente, Statusfelder)
- `correction_log`
- `whisper_recovery_logs`

**Hinweis:** Migrations-/Tabellenlogik ist historisch gewachsen. Die reale Referenz ist der Code in `lib/*Db.ts` und `app/api/config/migrate/route.ts`.

---

## 6) End-to-End Test-Matrix (manuell)

Für einen vollständigen Smoke-Test nach Änderungen:

1. **Auth & Session**
	- Login root + normaler User + Sekretariat-User.
2. **Live-Diktat**
	- Aufnahme, Transkription, Korrektur, Diff, Export.
3. **Wörterbuch/Templates/Custom Actions**
	- CRUD + Anwendung im echten Textfluss.
4. **Offline-Diktat**
	- Aufnahme/Import, Workerlauf, ReCorrect, Abschluss.
5. **Archiv & Logs**
	- Archivieren, entarchivieren, Korrekturlogs prüfen.
6. **Betrieb**
	- Config-Switch, Warmup, Health, Stats, Recovery.

---

## 7) Test-Hilfen im Repository

Vorhandene hilfreiche Dateien/Skripte:

- `create-test-audio.sh`
- `generate_test_audio.py`
- `generate-test-audio.js`
- `test-mistral-simple.js`
- `test-mistral-transcribe.js`

Nutze diese für reproduzierbare Audio- und Provider-Checks in der lokalen Entwicklung.

---

## 8) Häufige Erweiterungsaufgaben

### Neue API-Funktion hinzufügen

1. Neue Route in `app/api/<feature>/route.ts` anlegen.
2. Datenzugriff in `lib/*Db.ts` kapseln.
3. UI-Komponente in `components/` ergänzen.
4. Aufruf über `fetchWithDbToken` oder direkte Auth-Header integrieren.
5. Smoke-Tests aus Abschnitt 6 ausführen.

### Neuen LLM- oder STT-Provider integrieren

1. Runtime-Config erweitern (`lib/configDb.ts`, `/api/config`).
2. Provider-Call in `app/api/transcribe/route.ts` oder `app/api/correct/route.ts` ergänzen.
3. UI-Auswahl in Konfigurationspanel erweitern.
4. Timeouts, Fehlermeldungen und Fallbackpfade sauber testen.

---

## 9) Qualitäts- und Entwicklungsrichtlinien (projektbezogen)

- Änderungen möglichst **feature-lokal** halten (UI/API/lib konsistent je Modul).
- Bei Textverarbeitung immer auf **medizinische Terminologie** und **Nicht-Verfälschung** achten.
- Bei LLM-Ausgaben konsequent Meta-Text entfernen/validieren.
- Neue Logik möglichst mit klaren Logs versehen (vor allem im Worker/Recovery-Pfad).
- Bei DB-Änderungen Migrationen und Rückwärtskompatibilität mitdenken.

---

## 10) Offene technische Schulden (für externe Entwickler wichtig)

- Sehr große Route-Dateien (z. B. `transcribe`, `correct`, `worker`) erschweren Wartbarkeit.
- Teilweise doppelte Hilfslogik (Chunking, Prompt-Cleanup) in mehreren Dateien.
- Fokus liegt aktuell auf manuellen End-to-End-Tests, automatisierte Testabdeckung ist ausbaufähig.

Empfohlene erste Refactor-Schritte:

1. Provider-spezifische Calls in dedizierte Service-Module extrahieren.
2. Gemeinsame LLM-Helfer (Chunking, Cleanup, Retry) zentralisieren.
3. API-Vertragstests für Kernrouten (`transcribe`, `correct`, `offline-dictations`) aufbauen.

---

## 11) Kurzcheck vor jedem Merge

- Baut die App lokal (`npm run build`)?
- Funktioniert Live-Diktat und Offline-Queue weiterhin?
- Sind Rollen/Berechtigungen unverändert korrekt?
- Sind Recovery/Health/Stats weiterhin erreichbar?
- Ist diese Doku bei neuen Features aktualisiert?

