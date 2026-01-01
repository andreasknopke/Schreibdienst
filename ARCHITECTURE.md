# Schreibdienst - Architektur & Funktionalitäten

## Übersicht

**Schreibdienst** ist eine Web-Applikation zur automatisierten Transkription und Korrektur medizinischer Diktate. Ärzte können per Spracheingabe Befundberichte und Arztbriefe erstellen, die automatisch transkribiert, korrigiert und formatiert werden.

---

## 1. Systemarchitektur (High-Level)

```mermaid
flowchart TB
    subgraph Client["🖥️ Browser / PWA"]
        UI["React Frontend<br/>Next.js App"]
        AudioRec["🎤 Audio-Aufnahme<br/>MediaRecorder API"]
        PWA["📱 Offline-Modus<br/>Service Worker"]
    end

    subgraph NextJS["⚙️ Next.js Backend (Port 3000)"]
        API["API Routes"]
        Auth["Authentifizierung"]
        Config["Konfiguration"]
    end

    subgraph WhisperSvc["🔊 WhisperX Service (Port 5000)"]
        Whisper["WhisperX / Faster-Whisper<br/>Speech-to-Text"]
        GPU["CUDA GPU<br/>(optional)"]
    end

    subgraph LLM["🤖 LLM Korrektur"]
        OpenAI["OpenAI API<br/>GPT-4o-mini"]
        LMStudio["LM Studio<br/>(lokales LLM)"]
    end

    subgraph Storage["💾 Datenspeicherung"]
        MySQL["MySQL Datenbank<br/>(Mandantenfähig)"]
        DBToken["DB-Token System<br/>(Multi-Tenant)"]
    end

    UI --> AudioRec
    AudioRec --> API
    API --> Whisper
    Whisper --> GPU
    API --> OpenAI
    API --> LMStudio
    API --> Auth
    Auth --> DBToken
    DBToken --> MySQL
    Config --> MySQL
    PWA --> API

    classDef client fill:#e1f5fe,stroke:#0288d1
    classDef backend fill:#fff3e0,stroke:#f57c00
    classDef ai fill:#f3e5f5,stroke:#7b1fa2
    classDef storage fill:#e8f5e9,stroke:#388e3c

    class UI,AudioRec,PWA client
    class API,Auth,Config backend
    class Whisper,GPU,OpenAI,LMStudio ai
    class MySQL,DBToken storage
```

---

## 2. Haupt-Workflow: Diktat-Verarbeitung

```mermaid
sequenceDiagram
    autonumber
    actor Arzt as 👨‍⚕️ Arzt
    participant UI as 🖥️ Frontend
    participant API as ⚙️ Next.js API
    participant Whisper as 🔊 WhisperX
    participant LLM as 🤖 LLM (GPT/LMStudio)
    participant Dict as 📖 Wörterbuch
    
    Arzt->>UI: Aufnahme starten 🎤
    
    loop Alle 2 Sekunden (Live-Transkription)
        UI->>API: Audio-Chunk senden
        API->>Dict: Benutzer-Wörterbuch laden
        API->>Whisper: Transkription anfordern
        Whisper-->>API: Rohtext zurück
        API->>API: Wörterbuch-Ersetzungen anwenden
        API-->>UI: Live-Text anzeigen
    end
    
    Arzt->>UI: Aufnahme stoppen ⏹️
    UI->>API: Finale Audio-Datei
    API->>Whisper: Vollständige Transkription
    Whisper-->>API: Finaler Rohtext
    
    alt Auto-Korrektur aktiviert
        UI->>API: Korrektur anfordern
        API->>LLM: Text + Systemanweisung
        LLM-->>API: Korrigierter Text
        API->>API: Change-Score berechnen
        API-->>UI: Korrigierter Text + Score
    end
    
    UI->>UI: Diff-Highlighting anzeigen
    UI-->>Arzt: Fertiger Befund ✅
```

---

## 3. Komponenten-Übersicht

```mermaid
flowchart LR
    subgraph Frontend["Frontend Komponenten"]
        direction TB
        Page["page.tsx<br/>Hauptseite"]
        AuthProv["AuthProvider<br/>Login/Session"]
        DictMgr["DictionaryManager<br/>Wörterbuch"]
        TmplMgr["TemplatesManager<br/>Textbausteine"]
        CustomAct["CustomActions<br/>Eigene Aktionen"]
        DiffHL["DiffHighlight<br/>Änderungsanzeige"]
        OffRec["OfflineRecorder<br/>Offline-Diktate"]
        DictQueue["DictationQueue<br/>Diktat-Warteschlange"]
    end

    subgraph APIs["API Endpoints"]
        direction TB
        Transcribe["/api/transcribe<br/>Speech-to-Text"]
        Correct["/api/correct<br/>LLM-Korrektur"]
        Format["/api/format<br/>Text-Formatierung"]
        Dictionary["/api/dictionary<br/>Wörterbuch-CRUD"]
        Templates["/api/templates<br/>Textbausteine"]
        Users["/api/users<br/>Benutzerverwaltung"]
        OfflineAPI["/api/offline-dictations<br/>Offline-Queue"]
        Warmup["/api/warmup<br/>Modell-Vorladung"]
    end

    subgraph Services["Backend Services"]
        direction TB
        WhisperX["WhisperX<br/>Python Flask"]
        TextFmt["textFormatting.ts<br/>Steuerbefehle"]
        ChangeScore["changeScore.ts<br/>Ampelsystem"]
    end

    Page --> AuthProv
    Page --> DictMgr
    Page --> TmplMgr
    Page --> CustomAct
    Page --> DiffHL
    Page --> OffRec

    Page --> Transcribe
    Page --> Correct
    Transcribe --> WhisperX
    Correct --> TextFmt
    Correct --> ChangeScore
    
    DictMgr --> Dictionary
    TmplMgr --> Templates
    OffRec --> OfflineAPI
```

---

## 4. Benutzer-Rollen & Berechtigungen

```mermaid
flowchart TB
    subgraph Rollen["👥 Benutzerrollen"]
        Admin["🔑 Administrator"]
        Arzt["👨‍⚕️ Arzt"]
        Sek["📋 Sekretariat"]
    end

    subgraph Rechte["Berechtigungen"]
        UserMgmt["Benutzerverwaltung"]
        Config["Systemkonfiguration"]
        OwnDict["Eigenes Diktat erstellen"]
        OwnWB["Eigenes Wörterbuch"]
        OwnTpl["Eigene Textbausteine"]
        ViewAll["Alle Diktate einsehen"]
        EditAll["Alle Diktate bearbeiten"]
    end

    Admin --> UserMgmt
    Admin --> Config
    Admin --> OwnDict
    Admin --> OwnWB
    Admin --> OwnTpl
    Admin --> ViewAll
    Admin --> EditAll

    Arzt --> OwnDict
    Arzt --> OwnWB
    Arzt --> OwnTpl

    Sek --> ViewAll
    Sek --> EditAll
    Sek --> OwnTpl

    classDef admin fill:#ffcdd2,stroke:#c62828
    classDef arzt fill:#c8e6c9,stroke:#2e7d32
    classDef sek fill:#bbdefb,stroke:#1565c0

    class Admin admin
    class Arzt arzt
    class Sek sek
```

---

## 5. Mandantenfähigkeit: DB-Token System

```mermaid
flowchart TB
    subgraph Client["🖥️ Client (Browser/PWA)"]
        URL["URL mit DB-Token<br/>?db=BASE64_TOKEN"]
        Storage["Token-Speicherung<br/>localStorage + IndexedDB"]
        Header["X-DB-Token Header<br/>bei API-Requests"]
    end

    subgraph Token["🔑 DB-Token (Base64-kodiert)"]
        Credentials["JSON Credentials:<br/>host, user, password,<br/>database, port, ssl"]
    end

    subgraph Backend["⚙️ Next.js API"]
        Decode["Token dekodieren"]
        PoolMgr["Connection Pool Manager"]
        DynPool["Dynamischer Pool<br/>(pro Mandant gecacht)"]
        DefPool["Default Pool<br/>(Fallback)"]
    end

    subgraph Databases["🗄️ MySQL Datenbanken"]
        DB1["Mandant A<br/>Krankenhaus 1"]
        DB2["Mandant B<br/>Krankenhaus 2"]
        DB3["Mandant C<br/>Praxis"]
    end

    URL --> Storage
    Storage --> Header
    Header --> Decode
    Decode --> Token
    Token --> PoolMgr
    PoolMgr --> DynPool
    PoolMgr --> DefPool
    DynPool --> DB1
    DynPool --> DB2
    DynPool --> DB3
    DefPool --> DB1

    classDef client fill:#e1f5fe,stroke:#0288d1
    classDef token fill:#fff3e0,stroke:#f57c00
    classDef backend fill:#f3e5f5,stroke:#7b1fa2
    classDef db fill:#e8f5e9,stroke:#388e3c

    class URL,Storage,Header client
    class Credentials token
    class Decode,PoolMgr,DynPool,DefPool backend
    class DB1,DB2,DB3 db
```

### Token-Format (Base64-kodiert):
```json
{
  "host": "mysql.example.com",
  "user": "schreibdienst_user",
  "password": "secret",
  "database": "mandant_a",
  "port": 3306,
  "ssl": true
}
```

### Vorteile des Token-Systems:
- **Keine Konfiguration am Server** - Mandant wird durch Token bestimmt
- **PWA-kompatibel** - Token in IndexedDB für Offline-Nutzung gespeichert
- **Flexible Deployment** - Eine App-Instanz, viele Mandanten
- **URL-basiert** - Token kann per Link weitergegeben werden

---

## 6. Datenfluss: Wörterbuch & Korrektur

```mermaid
flowchart LR
    subgraph Input["Eingabe"]
        Audio["🎤 Audio"]
        Raw["Rohtext:<br/>'Cholezystytis akut'"]
    end

    subgraph Whisper["WhisperX Transkription"]
        InitPrompt["initial_prompt<br/>(Fachbegriffe)"]
        STT["Speech-to-Text"]
    end

    subgraph Dictionary["📖 Wörterbuch-Anwendung"]
        WBEntry["Eintrag:<br/>Cholezystytis → Cholecystitis"]
        Replace["Ersetzung"]
    end

    subgraph LLMCorrect["🤖 LLM Korrektur"]
        Grammar["Grammatik-Korrektur"]
        Numbers["Zahlen → Ziffern"]
        Commands["Steuerbefehle<br/>umsetzen"]
    end

    subgraph Output["Ausgabe"]
        Final["Finaler Text:<br/>'Akute Cholecystitis'"]
        Score["Änderungs-Score<br/>🟢 🟡 🔴"]
    end

    Audio --> STT
    InitPrompt --> STT
    STT --> Raw
    Raw --> WBEntry
    WBEntry --> Replace
    Replace --> Grammar
    Grammar --> Numbers
    Numbers --> Commands
    Commands --> Final
    Final --> Score
```

---

## 7. Modi: Befundbericht vs. Arztbrief

```mermaid
flowchart TB
    subgraph Mode["📝 Dokumenttyp"]
        Befund["Befundbericht<br/>(Radiologie)"]
        Brief["Arztbrief<br/>(Klinik)"]
    end

    subgraph BefundFields["Befund-Felder"]
        M["Methodik"]
        B["Befund"]
        U["Beurteilung"]
    end

    subgraph BriefFields["Arztbrief-Felder"]
        A["Anamnese"]
        D["Diagnose"]
        T["Therapie"]
        E["Empfehlung"]
    end

    subgraph Commands["🎤 Sprachsteuerung"]
        Cmd1["'Methodik Doppelpunkt'<br/>→ Wechsel zu Methodik"]
        Cmd2["'Neuer Absatz'<br/>→ Leerzeile einfügen"]
        Cmd3["'Punkt' / 'Komma'<br/>→ Satzzeichen"]
    end

    Befund --> M
    Befund --> B
    Befund --> U
    
    Brief --> A
    Brief --> D
    Brief --> T
    Brief --> E

    Commands --> M
    Commands --> B
    Commands --> U
```

---

## 8. Online vs. Offline Diktat: Feature-Vergleich

### Übersicht der Unterschiede

```mermaid
flowchart TB
    subgraph Online["🌐 ONLINE-DIKTAT<br/>(Echtzeit-Verarbeitung)"]
        direction TB
        O1["🎤 Live-Aufnahme"]
        O2["👁️ Mitlesen in Echtzeit"]
        O3["📖 Wörterbuch-Korrektur"]
        O4["🤖 KI-Autokorrektur"]
        O5["🟢🟡🔴 Ampelsystem"]
        O6["📊 Diff-Highlighting"]
        O7["📋 Textbausteine"]
        O8["⚡ KI-Action-Module"]
        O9["✅ Sofort einsatzbereit"]
    end

    subgraph Offline["📴 OFFLINE-DIKTAT<br/>(Warteschlangen-Verarbeitung)"]
        direction TB
        F1["🎤 Aufnahme speichern"]
        F2["📁 Datei-Upload möglich"]
        F3["📋 Metadaten erfassen"]
        F4["⏳ Warteschlange"]
        F5["⚙️ Worker-Verarbeitung"]
        F6["👩‍💼 Sekretariat-Review"]
        F7["✅ Qualitätskontrolle"]
    end

    subgraph UseCase["Anwendungsfall"]
        UC1["Radiologe am Arbeitsplatz<br/>→ Online"]
        UC2["Arzt auf Visite<br/>→ Offline"]
        UC3["Externe Audiodatei<br/>→ Offline"]
    end

    Online --> UC1
    Offline --> UC2
    Offline --> UC3

    classDef online fill:#e8f5e9,stroke:#2e7d32
    classDef offline fill:#fff3e0,stroke:#f57c00
    classDef usecase fill:#e3f2fd,stroke:#1565c0

    class O1,O2,O3,O4,O5,O6,O7,O8,O9 online
    class F1,F2,F3,F4,F5,F6,F7 offline
    class UC1,UC2,UC3 usecase
```

### Online-Diktat: Echtzeit-Features

```mermaid
flowchart LR
    subgraph Recording["🎤 Aufnahme"]
        Mic["Mikrofon"]
        Chunk["Audio-Chunks<br/>(alle 2 Sek.)"]
    end

    subgraph LiveProcess["⚡ Live-Verarbeitung"]
        Whisper["WhisperX<br/>Transkription"]
        Dict["📖 Wörterbuch<br/>Ersetzungen"]
        Display["👁️ Mitlesen<br/>Live-Anzeige"]
    end

    subgraph PostProcess["🔧 Nach Aufnahme"]
        LLM["🤖 KI-Korrektur<br/>(GPT/LMStudio)"]
        Score["🟢🟡🔴 Ampel<br/>Change-Score"]
        Diff["📊 Diff-View<br/>Änderungen markiert"]
    end

    subgraph Enhance["✨ Erweiterungen"]
        Templates["📋 Textbausteine<br/>Vorlagen einfügen"]
        Actions["⚡ KI-Actions<br/>Custom Prompts"]
    end

    Mic --> Chunk
    Chunk --> Whisper
    Whisper --> Dict
    Dict --> Display
    Display --> LLM
    LLM --> Score
    Score --> Diff
    Diff --> Templates
    Templates --> Actions
```

### Feature-Details: Online-Modus

| Feature | Beschreibung | Nutzen |
|---------|-------------|--------|
| **👁️ Mitlesen** | Text erscheint während des Sprechens | Sofortige Kontrolle, Fehler erkennen |
| **📖 Wörterbuch** | Benutzer-spezifische Ersetzungen | Fachbegriffe korrekt schreiben |
| **🤖 KI-Korrektur** | Automatische Grammatik/Zahlen-Korrektur | Weniger manuelle Nacharbeit |
| **🟢🟡🔴 Ampel** | Visualisiert Umfang der KI-Änderungen | Vertrauen in Korrektur-Qualität |
| **📊 Diff-Highlighting** | Zeigt was die KI geändert hat | Transparenz, schnelle Prüfung |
| **📋 Textbausteine** | Vordefinierte Textblöcke pro Feld | Wiederkehrende Formulierungen |
| **⚡ KI-Actions** | Eigene KI-Prompts als Buttons | Erweiterbare Funktionalität |

### KI-Action-Module (Custom Actions)

```mermaid
flowchart TB
    subgraph Actions["⚡ KI-Action-Module"]
        direction LR
        A1["📝 Zusammenfassen"]
        A2["🔍 Befund prüfen"]
        A3["✨ Formulierung verbessern"]
        A4["🎯 Rechtschreibprüfung"]
        A5["+ Eigene erstellen..."]
    end

    subgraph Config["⚙️ Konfiguration pro Action"]
        Name["Name & Icon"]
        Prompt["KI-Prompt<br/>(frei definierbar)"]
        Target["Zielfeld<br/>(Methodik/Befund/Beurteilung/Alle)"]
    end

    subgraph Execute["▶️ Ausführung"]
        Select["Text auswählen"]
        Click["Action-Button klicken"]
        LLM["LLM verarbeitet"]
        Result["Ergebnis einfügen"]
    end

    Actions --> Config
    Config --> Execute
    Select --> Click --> LLM --> Result

    classDef action fill:#e1f5fe,stroke:#0288d1
    classDef config fill:#fff3e0,stroke:#f57c00
    classDef exec fill:#e8f5e9,stroke:#388e3c

    class A1,A2,A3,A4,A5 action
    class Name,Prompt,Target config
    class Select,Click,LLM,Result exec
```

### Offline-Diktat: Warteschlangen-Workflow

```mermaid
stateDiagram-v2
    [*] --> Aufnahme: Arzt startet Diktat
    
    Aufnahme --> Metadaten: Audio fertig
    Metadaten --> Pending: Absenden
    
    state Pending {
        [*] --> Warteschlange
        Warteschlange --> Worker: Netzwerk verfügbar
    }
    
    Pending --> Transcribing: Worker startet
    Transcribing --> Transcribed: WhisperX fertig
    
    Transcribed --> InReview: Sekretariat öffnet
    InReview --> Completed: Freigabe ✅
    InReview --> Transcribed: Zurück zur Queue
    
    Completed --> [*]: Archiviert
    
    note right of Metadaten
        • Auftragsnummer
        • Patient (optional)
        • Priorität
        • Modus
    end note
    
    note right of InReview
        • Text bearbeiten
        • Korrekturlesen
        • Export
    end note
```

### Feature-Vergleich: Online vs. Offline

| Feature | 🌐 Online | 📴 Offline |
|---------|:---------:|:----------:|
| **Live-Transkription** | ✅ Alle 2 Sek. | ❌ Später |
| **Mitlesen** | ✅ Echtzeit | ❌ Nein |
| **Wörterbuch** | ✅ Sofort | ✅ Bei Verarbeitung |
| **KI-Korrektur** | ✅ Auto/Manuell | ❌ Nein |
| **Ampelsystem** | ✅ Ja | ❌ Nein |
| **Diff-Highlighting** | ✅ Ja | ❌ Nein |
| **Textbausteine** | ✅ Ja | ❌ Nein |
| **KI-Actions** | ✅ Ja | ❌ Nein |
| **Datei-Upload** | ❌ Nein | ✅ MP3/WAV/etc. |
| **Prioritäten** | ❌ Nein | ✅ Normal/Dringend/Sofort |
| **Sekretariat-Review** | ❌ Nein | ✅ Ja |
| **Offline-fähig** | ❌ Nein | ✅ PWA-Support |
| **Metadaten** | ❌ Nein | ✅ Patient, Auftrag |

---

## 10. Offline-Warteschlange: Detaillierter Ablauf

```mermaid
sequenceDiagram
    autonumber
    actor Arzt as 👨‍⚕️ Arzt
    participant PWA as 📱 PWA (Offline)
    participant Queue as 📋 Warteschlange
    participant Worker as ⚙️ Worker
    participant Whisper as 🔊 WhisperX
    participant Sek as 📋 Sekretariat

    Note over Arzt,PWA: Arzt diktiert offline
    Arzt->>PWA: Diktat aufnehmen
    PWA->>PWA: Audio lokal speichern
    PWA->>Queue: In Warteschlange einreihen
    
    Note over Queue,Worker: Bei Netzwerkverbindung
    Worker->>Queue: Pending Diktate abrufen
    Worker->>Whisper: Transkription starten
    Whisper-->>Worker: Text zurück
    Worker->>Queue: Status: "transcribed"
    
    Note over Queue,Sek: Sekretariat-Workflow
    Sek->>Queue: Diktate einsehen
    Sek->>Sek: Korrekturlesen
    Sek->>Queue: Status: "completed" ✅
```

---

## 11. Technologie-Stack

```mermaid
mindmap
  root((Schreibdienst))
    Frontend
      Next.js 14
      React 18
      TypeScript
      Tailwind CSS
      PWA/Service Worker
    Backend
      Next.js API Routes
      Node.js
    AI/ML
      WhisperX
      Faster-Whisper
      OpenAI GPT-4o
      LM Studio
    Datenbank
      MySQL
      DB-Token Multi-Tenant
      IndexedDB Browser
    Infrastructure
      Docker
      Docker Compose
      NVIDIA CUDA
      Railway Deploy
```

---

## 12. Deployment-Architektur

```mermaid
flowchart TB
    subgraph Cloud["☁️ Railway / Cloud"]
        NextApp["Next.js App<br/>Port 3000"]
        WhisperCloud["WhisperX Service<br/>Port 5000"]
        MySQLCloud["MySQL Datenbank"]
    end

    subgraph Local["🏠 Lokale Entwicklung"]
        DevNext["Next.js Dev<br/>npm run dev"]
        DevWhisper["WhisperX<br/>python app.py"]
        LocalGPU["🎮 NVIDIA GPU"]
        LocalMySQL["MySQL (lokal/remote)"]
    end

    subgraph Docker["🐳 Docker Compose"]
        ContainerNext["next-app"]
        ContainerWhisper["whisper-service"]
        Volume["Shared Volume"]
    end

    Cloud --> |Production| MySQLCloud
    Local --> |Development| LocalMySQL
    Docker --> Volume

    DevWhisper --> LocalGPU
    ContainerWhisper --> LocalGPU

    classDef cloud fill:#e3f2fd,stroke:#1976d2
    classDef local fill:#fff8e1,stroke:#fbc02d
    classDef docker fill:#e8f5e9,stroke:#43a047

    class NextApp,WhisperCloud,MySQLCloud cloud
    class DevNext,DevWhisper,LocalGPU,LocalMySQL local
    class ContainerNext,ContainerWhisper,Volume docker
```

---

## 13. Feature-Übersicht für Entscheidungsträger

```mermaid
mindmap
  root((Schreibdienst<br/>Features))
    Kernfunktionen
      🎤 Spracheingabe
      ✍️ Auto-Transkription
      🔧 KI-Korrektur
      📄 DOCX-Export
    Qualitätssicherung
      📖 Medizin-Wörterbuch
      🟢🟡🔴 Änderungs-Ampel
      ↩️ Rückgängig-Funktion
      📊 Diff-Ansicht
    Produktivität
      📋 Textbausteine
      ⚡ Sprachsteuerung
      🔄 Live-Transkription
      📱 Offline-Modus
    Anpassbarkeit
      👥 Mehrbenutzerfähig
      🔐 Rollensystem
      ⚙️ LLM-Provider-Wahl
      🏥 Befund/Arztbrief
    Integration
      📎 Clipboard-Export
      🏥 RadCentre-kompatibel
      🌐 Web-basiert
      🐳 Docker-ready
```

---

## Zusammenfassung

| Aspekt | Technologie/Lösung |
|--------|-------------------|
| **Frontend** | Next.js + React + TypeScript |
| **Speech-to-Text** | WhisperX (GPU-beschleunigt) |
| **KI-Korrektur** | OpenAI GPT-4o-mini / LM Studio |
| **Datenbank** | MySQL (mandantenfähig via DB-Token) |
| **Mandantenfähigkeit** | Token-basiert (Multi-Tenant) |
| **Deployment** | Docker Compose / Railway |
| **Offline-Fähigkeit** | PWA mit Service Worker |

