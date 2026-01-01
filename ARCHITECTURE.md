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
        FileDB["JSON-Dateien<br/>(cache/)"]
        TursoDB["Turso DB<br/>(libSQL, optional)"]
    end

    UI --> AudioRec
    AudioRec --> API
    API --> Whisper
    Whisper --> GPU
    API --> OpenAI
    API --> LMStudio
    API --> Auth
    Auth --> Storage
    Config --> Storage
    PWA --> API

    classDef client fill:#e1f5fe,stroke:#0288d1
    classDef backend fill:#fff3e0,stroke:#f57c00
    classDef ai fill:#f3e5f5,stroke:#7b1fa2
    classDef storage fill:#e8f5e9,stroke:#388e3c

    class UI,AudioRec,PWA client
    class API,Auth,Config backend
    class Whisper,GPU,OpenAI,LMStudio ai
    class FileDB,TursoDB storage
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

## 5. Datenfluss: Wörterbuch & Korrektur

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

## 6. Modi: Befundbericht vs. Arztbrief

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

## 7. Offline-Modus & Diktat-Warteschlange

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

## 8. Technologie-Stack

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
      JSON Files
      Turso/libSQL
      IndexedDB Browser
    Infrastructure
      Docker
      Docker Compose
      NVIDIA CUDA
      Railway Deploy
```

---

## 9. Deployment-Architektur

```mermaid
flowchart TB
    subgraph Cloud["☁️ Railway / Cloud"]
        NextApp["Next.js App<br/>Port 3000"]
        WhisperCloud["WhisperX Service<br/>Port 5000"]
        TursoDB["Turso Database"]
    end

    subgraph Local["🏠 Lokale Entwicklung"]
        DevNext["Next.js Dev<br/>npm run dev"]
        DevWhisper["WhisperX<br/>python app.py"]
        LocalGPU["🎮 NVIDIA GPU"]
        LocalFiles["cache/*.json"]
    end

    subgraph Docker["🐳 Docker Compose"]
        ContainerNext["next-app"]
        ContainerWhisper["whisper-service"]
        Volume["Shared Volume"]
    end

    Cloud --> |Production| TursoDB
    Local --> |Development| LocalFiles
    Docker --> Volume

    DevWhisper --> LocalGPU
    ContainerWhisper --> LocalGPU

    classDef cloud fill:#e3f2fd,stroke:#1976d2
    classDef local fill:#fff8e1,stroke:#fbc02d
    classDef docker fill:#e8f5e9,stroke:#43a047

    class NextApp,WhisperCloud,TursoDB cloud
    class DevNext,DevWhisper,LocalGPU,LocalFiles local
    class ContainerNext,ContainerWhisper,Volume docker
```

---

## 10. Feature-Übersicht für Entscheidungsträger

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
| **Datenbank** | JSON-Files (lokal) / Turso (Cloud) |
| **Deployment** | Docker Compose / Railway |
| **Offline-Fähigkeit** | PWA mit Service Worker |

