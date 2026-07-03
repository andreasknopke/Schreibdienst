# Testfälle: Widerspruchserkennung in Bausteinen

Jeder Testfall enthält einen Baustein (Template) und einen diktierten Änderungstext. Die zu erwartenden Ergebnisse unterscheiden sich je nach Slider-Stellung (**Aus / Einfach / Genau**).

---

## Test 1: Hydrocephalus ↔ normale Liquorräume

**Feld:** `befund`

**Baustein-Inhalt:**
```
CT-Schädel nativ:
Normalweite innere und äußere Liquorräume. Keine Mittellinienverlagerung.
Keine intrakranielle Raumforderung. Keine Hirndruckzeichen.
Stammganglien und Marklager unauffällig.
```

**Diktierte Änderung:**
> Zeichen eines Hydrocephalus e vacuo

**Erwartung:**
| Modus | Ergebnis |
|-------|----------|
| Widerspruch: **Genau** | "Normalweite innere und äußere Liquorräume" wird entfernt oder ersetzt. Der Hydrocephalus bleibt. |
| Widerspruch: **Einfach** | Ebenfalls korrekte Erkennung (einfach-Regel enthält genau dieses Beispiel) |
| Widerspruch: **Aus** | Beide Aussagen bleiben stehen → Widerspruch im Text ("Hydrocephalus" UND "normalweite Liquorräume") |

---

## Test 2: Hepatomegalie ↔ normale Lebergröße

**Feld:** `befund`

**Baustein-Inhalt:**
```
Sonographie Abdomen:
Leber normal groß, glatt begrenzt, homogenes Parenchym.
Gallenblase unauffällig. Pankreas unauffällig.
Nieren beidseits orthotop und normal groß. Keine Harnstauung.
```

**Diktierte Änderung:**
> Hepatomegalie mit inhomogenem Parenchym

**Erwartung:**
| Modus | Ergebnis |
|-------|----------|
| Widerspruch: **Genau** | "Leber normal groß, glatt begrenzt, homogenes Parenchym" wird ersetzt durch "Hepatomegalie mit inhomogenem Parenchym" |
| Widerspruch: **Einfach** | Korrekte Erkennung |
| Widerspruch: **Aus** | Beide Leber-Aussagen stehen → Widerspruch |

---

## Test 3: Harnstau ↔ normale Nieren

**Feld:** `befund`

**Baustein-Inhalt:**
```
Nieren beidseits orthotop, normal groß, scharfe Kontur.
Keine Harnstauung. Keine Konkremente.
Nebennieren unauffällig.
```

**Diktierte Änderung:**
> Rechts Harnstau Grad II

**Erwartung:**
| Modus | Ergebnis |
|-------|----------|
| Widerspruch: **Genau** | "Keine Harnstauung" wird entfernt oder ersetzt durch "Rechts Harnstau Grad II". Der Rest bleibt. |
| Widerspruch: **Einfach** | Korrekte Erkennung |
| Widerspruch: **Aus** | Widerspruch bleibt ("Keine Harnstauung" + "Harnstau Grad II") |

---

## Test 4: Subtiler Widerspruch – Pankreatitis

**Feld:** `befund`

**Baustein-Inhalt:**
```
MRT Abdomen:
Pankreas unauffällig. Gallenwege nicht erweitert.
Milz normal groß. Leber unauffällig.
```

**Diktierte Änderung:**
> Pankreatitis mit peripankreatischer Flüssigkeit

**Erwartung:**
| Modus | Ergebnis |
|-------|----------|
| Widerspruch: **Genau** | "Pankreas unauffällig" wird erkannt und durch pathologische Angabe ersetzt |
| Widerspruch: **Einfach** | Sollte ebenfalls funktionieren |
| Widerspruch: **Aus** | Beide Pankreas-Aussagen stehen → Widerspruch |

---

## Test 5: Gemischte Änderungen (teilweise mit, teilweise ohne Widerspruch)

**Feld:** `befund`

**Baustein-Inhalt:**
```
CT-Thorax:
Lunge unauffällig entfaltet. Kein Infiltrat, kein Pleuraerguss.
Mediastinum unauffällig. Herzgröße normal.
Keine pathologischen Lymphknoten.
```

**Diktierte Änderung:**
> links basal ein kleiner Pleuraerguss. sonst keine Änderungen

**Erwartung:**
| Modus | Ergebnis |
|-------|----------|
| Widerspruch: **Genau** | "Kein Pleuraerguss" entfernt, "links basal ein kleiner Pleuraerguss" eingefügt. Alle anderen Aussagen bleiben erhalten. |
| Widerspruch: **Einfach** | Korrekte Erkennung |
| Widerspruch: **Aus** | "Kein Pleuraerguss" UND "Pleuraerguss" stehen → Widerspruch |

---

## Test 6 (Optionen-Modus): Handkraft mit [Optionen]

**Feld:** `befund`

**Baustein-Inhalt:**
```
Neurologischer Status:
Kraftgrad der oberen Extremitäten: [rechts/kraftgrad 5/5, links/kraftgrad 5/5].
Patient kann [beide Hände/die linke Hand/die rechte Hand/keine Hand] drücken.
Sensibilität intakt.
```

**Diktierte Änderung:**
> Patient kann die linke Hand drücken

**Erwartung (Optionen-Modus):**
| Einstellung | Ergebnis |
|-------------|----------|
| **Optionen** | "Patient kann [beide Hände/die linke Hand/die rechte Hand/keine Hand] drücken" → "Patient kann die linke Hand drücken". Die zweite [Optionen]-Klammer bleibt erhalten (keine diktierten Änderungen zu Kraftgrad). |
| **Optionen** mit nicht passender Änderung (z. B. "Zehenspitzenstand möglich") | Klammern bleiben unverändert, "Zehenspitzenstand möglich" erscheint im **unusedText**-Fenster. |

---

## Test 7 (Optionen-Modus): Seitenlokalisation

**Feld:** `befund`

**Baustein-Inhalt:**
```
Sonographie Abdomen:
Leber [unauffällig/vergrößert/verkleinert], [homogenes/inhomogenes] Parenchym.
Gallenblase [unauffällig/steintragend/nicht beurteilbar].
Pankreas unauffällig.
```

**Diktierte Änderung:**
> Leber vergrößert, inhomogenes Parenchym, Gallenblase steintragend

**Erwartung (Optionen-Modus):**
| Einstellung | Ergebnis |
|-------------|----------|
| **Optionen** | Alle drei Klammern werden korrekt aufgelöst: "Leber vergrößert, inhomogenes Parenchym. Gallenblase steintragend." |
| **Optionen** (nur "Leber vergrößert" diktiert) | Nur die erste Klammer wird aufgelöst, die anderen bleiben → "Leber vergrößert, [homogenes/inhomogenes] Parenchym. Gallenblase [unauffällig/steintragend/nicht beurteilbar]." |

---

## Test 8 (Optionen-Modus): Teilweise passende Änderung

**Feld:** `befund`

**Baustein-Inhalt:**
```
CT-Thorax:
Lunge [unauffällig/geringgradig/mittelgradig] [emphysematös/fibrotisch verändert].
Mediastinum [unauffällig/verbreitert].
```

**Diktierte Änderung:**
> Lunge mittelgradig fibrotisch, bitte auch auf Lymphknoten achten

**Erwartung (Optionen-Modus):**
| Einstellung | Ergebnis |
|-------------|----------|
| **Optionen** | Die erste Klammer wird auf "mittelgradig" und die zweite auf "fibrotisch verändert" aufgelöst. "Bitte auch auf Lymphknoten achten" passt in keine Option → erscheint im **unusedText**-Fenster. |

---

## So testen

1. Baustein-Admin öffnen und einen neuen Baustein mit dem obigen Inhalt anlegen
2. Baustein in das Befund-Feld laden (aktiver Baustein)
3. **Slider vor dem Diktieren** auf die gewünschte Stellung setzen:
   - `Widersprüche: Aus` — zum Prüfen, ob der Widerspruch **nicht** aufgelöst wird
   - `Widersprüche: Einfach` — verkürzte Erkennung
   - `Widersprüche: Genau` — volle Erkennung (Default)
   - `Widersprüche: Optionen` — wählt aus [Option A/Option B] im Baustein-Text
4. Änderung diktieren (oder via Texteingabe + "Änderungen einfügen")
5. Ergebnis prüfen — bei Optionen-Modus: nicht zuordenbarer Text erscheint im "nicht verwendet"-Fenster
