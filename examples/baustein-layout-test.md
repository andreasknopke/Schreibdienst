# Testfälle: Layout beibehalten in Bausteinen

Diese Tests prüfen, ob das Layout (Labels, Doppelpunkte, Absätze) korrekt erhalten bleibt.

---

## Test L1: Strukturierte Befundvorlage

**Baustein-Inhalt:**
```
MRT LWS:
Wirbelkörper: Regelrechte Höhe und Signalgebung. Keine Fraktur.
Bandscheiben: Keine Vorwölbung. Keine Sequester.
Spinalkanal: Normalweit.
Neuroforamen: Beidseits frei.
```

**Diktierte Änderung:**
> BWK3 Höhenminderung

**Wichtig:** Die Labels (`Wirbelkörper:`, `Bandscheiben:`, usw.) müssen exakt erhalten bleiben!

---

## Test L2: Beschriftete Abschnitte

**Baustein-Inhalt:**
```
Untersuchung: CT-Abdomen nativ.
Indikation: V.a. Nierenkolik.
Technik: Native CT-Untersuchung.
Beurteilung: Kein Stein, keine Harnstauung.
```

**Diktierte Änderung:**
> Harnstau rechts

**Wichtig:** `Untersuchung:`, `Indikation:`, `Technik:`, `Beurteilung:` müssen unverändert bleiben.

---

## Test L3: Mehrere Doppelpunkte pro Zeile

**Baustein-Inhalt:**
```
Gefäße: Aorta: 2,5 cm. Keine Wandverdickung.
Leber: Pfortader: 1,0 cm. Fluss orthograd.
Milz: Vene: 0,8 cm.
```

**Diktierte Änderung:**
> Aortenaneurysma 3,2 cm

**Wichtig:** Die Mehrfach-Doppelpunkte (`Gefäße: Aorta:`) dürfen nicht zu `Gefäße: **Aorta**:` oder ähnlich werden.

---

## So testen

| Layout-Modus | Erwartung |
|--------------|-----------|
| **Genau** | Layout bleibt zeichengenau erhalten |
| **Einfach** | Layout bleibt erhalten (verkürzte Regeln) |
| **Aus** | LLM bekommt keine Layout-Vorgaben → Struktur wird oft verändert |

Empfehlung für den Alltag: **Layout: Genau** beibehalten, da das Format medizinisch oft standardisiert ist.
