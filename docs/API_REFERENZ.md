# Schreibdienst – API-Referenz (kompakt)

Diese Referenz beschreibt die wichtigsten Endpoints der Next.js-API (`app/api/**`) inkl. typischer Request-/Response-Beispiele.

Passend dazu gibt es eine direkt importierbare Collection:

- `docs/Schreibdienst.postman_collection.json`
- `docs/Schreibdienst.insomnia.json` (native Insomnia Export)

Import:
- **Postman**: Import → File → Collection auswählen
- **Insomnia**: Import/Export → Import Data → From File (Postman Collection)
- **Insomnia (native)**: Import/Export → Import Data → From File (`Schreibdienst.insomnia.json`)

## Basis

- Base URL lokal: `http://localhost:3000`
- API-Pfade: `/api/...`
- Standardformat: JSON, außer wenn explizit `multipart/form-data` verwendet wird.

## Authentifizierung & Header

### Basic Auth
Viele Endpoints erwarten:

```http
Authorization: Basic <base64(username:password)>
```

### DB-Token (Multi-Tenant)
Optional/tenant-spezifisch:

```http
X-DB-Token: <encrypted-token>
```

---

## 1) Auth & Benutzer

### `POST /api/auth`
Login.

**Body (JSON)**
```json
{
  "username": "root",
  "password": "secret"
}
```

**Response (200)**
```json
{
  "success": true,
  "username": "root",
  "isAdmin": true,
  "canViewAllDictations": true,
  "autoCorrect": true,
  "defaultMode": "befund"
}
```

### `GET /api/users`
Alle Benutzer (Admin-only).

### `POST /api/users`
Benutzer anlegen (Admin-only).

**Body (JSON)**
```json
{
  "username": "arzt1",
  "password": "secret",
  "isAdmin": false,
  "canViewAllDictations": false
}
```

### `PATCH /api/users`
Passwort oder Berechtigungen ändern (Admin-only).

**Body (Passwort)**
```json
{
  "username": "arzt1",
  "newPassword": "new-secret"
}
```

**Body (Berechtigungen)**
```json
{
  "username": "arzt1",
  "permissions": {
    "isAdmin": false,
    "canViewAllDictations": true
  }
}
```

### `DELETE /api/users`
Benutzer löschen (Admin-only).

**Body (JSON)**
```json
{
  "username": "arzt1"
}
```

### `GET /api/users/settings`
Eigene Einstellungen laden.

### `PATCH /api/users/settings`
Eigene Einstellungen speichern.

**Body (JSON)**
```json
{
  "autoCorrect": true
}
```

---

## 2) Transkription & Korrektur

### `POST /api/transcribe`
Audio transkribieren (Provider gemäß Runtime-Config).

**Body (`multipart/form-data`)**
- `file`: Audio-Blob/Datei (**Pflicht**)
- `username`: Benutzername (optional, für Wörterbuch-Prompt)
- `speed_mode`: `turbo | precision | auto` (optional)

**Response (200)**
```json
{
  "text": "...",
  "segments": [],
  "language": "de",
  "provider": "whisperx",
  "duration": 1.23
}
```

### `POST /api/correct`
Große LLM-Korrekturpipeline.

**Body (JSON, häufigster Fall)**
```json
{
  "text": "Diktattext...",
  "username": "arzt1",
  "patientName": "Max Mustermann"
}
```

**Optional zusätzlich**
- `previousCorrectedText`
- `befundFields` (`methodik`, `befund`, `beurteilung`)
- `suggestBeurteilung` (bool)
- `methodik`, `befund`

**Response**
- je nach Modus z. B. korrigierter Text/Felder oder `suggestedBeurteilung`.

### `POST /api/quick-correct`
Schnelle Fachwort-Korrektur über LM Studio.

**Body (JSON)**
```json
{
  "text": "...",
  "referenceTerms": ["Liquorräume", "Mittellinie"],
  "dictionaryCorrections": [
    { "wrong": "Liquoraus", "correct": "Liquorraum" }
  ]
}
```

**Response**
```json
{
  "corrected": "...",
  "changed": true
}
```

### `POST /api/format`
Formatiert Text als `befund` oder `arztbrief`.

**Body (JSON)**
```json
{
  "text": "...",
  "mode": "befund"
}
```

---

## 3) Wörterbuch, Templates, Custom Actions

### Wörterbuch: `/api/dictionary`
- `GET` (optional Query `?user=<name>` für berechtigte Nutzer)
- `POST` Eintrag hinzufügen
- `PATCH` Optionen aktualisieren (`useInPrompt`, `matchStem`)
- `DELETE` Eintrag löschen

**POST Body**
```json
{
  "wrong": "Scholecystitis",
  "correct": "Cholecystitis",
  "useInPrompt": true,
  "matchStem": false
}
```

### Templates: `/api/templates`
- `GET`, `POST`, `PUT`, `DELETE`

**POST/PUT Body**
```json
{
  "name": "CT Schädel Standard",
  "content": "...",
  "field": "befund"
}
```

### `POST /api/templates/adapt`
Template per LLM mit diktierten Änderungen anpassen.

**Body**
```json
{
  "template": "...",
  "changes": "Hydrocephalus e vacuo",
  "field": "befund",
  "username": "arzt1"
}
```

### Custom Actions: `/api/custom-actions`
- `GET`, `POST`, `PUT`, `DELETE?id=<id>`

**POST/PUT Body**
```json
{
  "name": "Zusammenfassen",
  "icon": "📝",
  "prompt": "Fasse den Text knapp zusammen",
  "targetField": "current"
}
```

### `POST /api/custom-actions/execute`
Aktion auf Text ausführen.

**Body**
```json
{
  "prompt": "Verbessere die Formulierung",
  "text": "...",
  "fieldName": "befund"
}
```

---

## 4) Offline-Diktate & Queue

### `/api/offline-dictations`

#### `GET`
Query-Parameter:
- `username`, `id`, `stats`, `all`, `status`, `user`, `listUsers`
- bei `id`: zusätzlich `audio=true`, `extract=true`

#### `POST`
Neues Offline-Diktat speichern.

**Body (`multipart/form-data`)**
- Pflicht: `username`, `audio`, `orderNumber`
- Optional: `duration`, `priority`, `mode`, `patientName`, `patientDob`, `bemerkung`, `termin`, `fachabteilung`, `berechtigte`

#### `PATCH`
Retry oder manuelle Speicherung.

**Body (Retry)**
```json
{ "id": 42, "action": "retry" }
```

**Body (Save)**
```json
{
  "id": 42,
  "action": "save",
  "correctedText": "...",
  "changeScore": 12.3
}
```

#### `DELETE`
- `?id=<dictationId>`: ganzes Diktat löschen
- `?id=<dictationId>&audioOnly=true`: nur Audio löschen

### `POST /api/offline-dictations/worker`
Batch-Verarbeitung starten.

**Response**
```json
{
  "message": "Worker completed",
  "processed": 3,
  "errors": 0,
  "remaining": 0
}
```

### `GET /api/offline-dictations/worker`
Worker-Status.

### `POST /api/offline-dictations/recorrect`
Abgeschlossenes Diktat neu korrigieren.

**Body**
```json
{ "dictationId": 42 }
```

### `POST /api/import-dictation`
SpeaKING-Import.

**Body (`multipart/form-data`)**
- `xml` (`.dictation` / XML)
- `audio` (Audio-Datei)

---

## 5) Archiv, Logs, Monitoring

### `/api/archive`
- `GET` mit Filtern: `username`, `archivedBy`, `patientName`, `fromDate`, `toDate`
- `POST` archivieren
  ```json
  { "id": 42, "archivedBy": "sekretariat1" }
  ```
- `DELETE?id=42` entarchivieren

### `/api/correction-log`
- `GET?dictationId=42`
- `GET?dictationId=42&stats=true`

### `/api/stats`
System-/Job-/DB-Statistiken.

### `/api/health`
Health- und Diagnosedaten (inkl. LM Studio Connectivity).

---

## 6) Konfiguration & Recovery

### `/api/config`
- `GET` aktuelle Runtime-Config + verfügbare Provider
- `POST` Config ändern (**nur root**)

**Wichtige POST-Felder**
- `transcriptionProvider`: `whisperx | elevenlabs | mistral | fast_whisper`
- `llmProvider`: `openai | lmstudio | mistral`
- `whisperModel`, `openaiModel`, `mistralModel`
- `llmPromptAddition`
- Double-Precision-Felder (`doublePrecisionEnabled`, `doublePrecisionSecondProvider`, ...)
- LM-Studio-Overrides (`lmStudioModelOverride`, `lmStudioUseApiMode`)

### `POST /api/config/migrate`
DB-Migrationen ausführen (**nur root**).

### `/api/warmup`
- `POST` WhisperX-Warmup starten
- `GET` Warmup-/Servicezustand

### `/api/whisperx-system`
- `GET` WhisperX-Health
- `POST` Systemaktionen

**POST Body**
```json
{ "action": "system_cleanup" }
```

Mögliche `action`-Werte:
- `system_cleanup`
- `system_kill_zombies`
- `system_reboot`
- `health_check`
- `full_recovery`

### `/api/whisperx-recovery-logs`
- `GET` Logs/Stats (`stats`, `days`, `limit`, `level`, `action`)
- `DELETE?daysToKeep=30`

---

## 7) DB-Token

### `/api/db-token`
- `GET` prüft, ob Verschlüsselung aktiv ist
- `POST` erzeugt DB-Token (**nur root**)

**POST Body**
```json
{
  "host": "mysql.example.com",
  "user": "tenant_user",
  "password": "secret",
  "database": "tenant_db",
  "port": 3306,
  "ssl": true
}
```

---

## 8) cURL-Beispiele

### Login
```bash
curl -X POST http://localhost:3000/api/auth \
  -H 'Content-Type: application/json' \
  -d '{"username":"root","password":"secret"}'
```

### Transkription
```bash
curl -X POST http://localhost:3000/api/transcribe \
  -H 'Authorization: Basic <BASE64>' \
  -F 'file=@test-audio.wav' \
  -F 'username=root' \
  -F 'speed_mode=turbo'
```

### Offline-Worker auslösen
```bash
curl -X POST http://localhost:3000/api/offline-dictations/worker \
  -H 'Authorization: Basic <BASE64>'
```

### Config lesen
```bash
curl http://localhost:3000/api/config \
  -H 'Authorization: Basic <BASE64>'
```

---

## 9) Hinweise für Integrationen

- Bei Integrationen zuerst `GET /api/config` und `GET /api/health` prüfen.
- Für tenant-spezifische Integrationen `X-DB-Token` konsequent mitsenden.
- Endpoints mit großen Audiodaten immer als `multipart/form-data` senden.
- Fehlerausgaben sind überwiegend `{ error: "..." }` mit passenden HTTP-Statuscodes.
