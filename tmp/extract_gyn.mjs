import fs from 'fs';

const text = fs.readFileSync('artifacts/medtext.txt', 'utf8');

// Parse index
const lines = text.split('\n')
  .map(l => l.trim())
  .filter(l => l && !l.startsWith('---') && !l.startsWith('Stichwortverzeichnis'));

const terms = new Set();

for (const line of lines) {
  const m = line.match(/^([A-Za-zÄÖÜäöüß0-9\-\/]+?)(?:\s+\d|$)/);
  if (!m) continue;
  
  let term = m[1].replace(/[.,;:!?()]+$/, '').trim();
  
  if (term.includes(' ')) continue;
  if (term.endsWith('-')) continue;
  if (term.length < 5) continue;
  if (!/^[A-ZÄÖÜ]/.test(term)) continue;
  if (/^[A-ZÄÖÜ0-9\/\-]+$/u.test(term) && !/[a-zäöüß]/.test(term)) continue;
  
  terms.add(term);
}

console.log('Candidates:', terms.size);

const DRUG_PATTERN = /^[A-Z][a-z]+(mab|zumab|ximab|umab|ciclib|isib|nib|tinib|platin|rubicin|bicin|trel)$/i;

const DRUG_WHITELIST = new Set([
  'Atosiban', 'Fenoterol', 'Betamethason', 'Dexamethason',
  'Clomifen', 'Letrozol', 'Tamoxifen', 'Raloxifen', 'Fulvestrant',
  'Goserelin', 'Leuprorelin', 'Triptorelin', 'Buserelin', 'Nafarelin',
  'Estradiol', 'Estriol', 'Progesteron', 'Dydrogesteron',
  'Medroxyprogesteron', 'Norethisteron', 'Levonorgestrel',
  'Misoprostol', 'Dinoproston', 'Sulproston', 'Carbetocin',
  'Oxytocin', 'Methylergometrin',
  'Mifepriston', 'Gemeprost',
  'Magnesiumsulfat', 'Nifedipin', 'Indomethacin',
  'Cervicalripening',
  'Prolaktinom',
]);

const TERM_WHITELIST = new Set([
  'Adenomyose', 'Adenosarkom', 'Adnexitis',
  'Amenorrhoe', 'Androgeninsensitivität',
  'Asherman-Syndrom', 'Azoospermie',
  'Blasenmole', 'Blasentumor',
  'Borderline-Tumor',
  'Dysmenorrhoe', 'Dyspareunie',
  'Eklampsie', 'Endometriom', 'Endometriose',
  'Endometriumhyperplasie', 'Endometriumkarzinom',
  'Endomyometritis',
  'Gestationsdiabetes', 'Gestationshypertonie',
  'Gestationsthrombozytopenie',
  'Gonadendysgenesie',
  'Gregg-Syndrom', 'Hymenalatresie',
  'HELLP-Syndrom', 'Hyperandrogenämie',
  'Hyperemesis', 'Hypermenorrhoe',
  'Hypomenorrhoe', 'Hypospadie',
  'Infertilität', 'Kolonkarzinom',
  'Konisation', 'Konnatal',
  'Laparoskopie', 'Laparotomie',
  'Leiomyom', 'Leiomyosarkom',
  'Mammakarzinom', 'Mammasonographie',
  'Mastitis', 'Mastodynie',
  'Menarche', 'Menopause', 'Menorrhagie',
  'Metrorrhagie', 'Myom', 'Myomenukleation',
  'Myomembolisation', 'Myomentfernung',
  'Nabelschnur', 'Nabelschnurvorfall',
  'Oligomenorrhoe', 'Oligohydramnion',
  'Ovarialinsuffizienz', 'Ovarialkarzinom',
  'PCO-Syndrom', 'PCOS', 'Plazenta-praevia',
  'Plazentalösung', 'Polyhydramnion',
  'Polymenorrhoe', 'Postmenopause',
  'Präeklampsie', 'Präimplantation',
  'Pränatal', 'Pränataldiagnostik',
  'Progesteron', 'Proktokolpektomie',
  'Proktokolposkopie',
  'Pubertas-praecox', 'Pubertät',
  'Salpingitis', 'Salpingo-Oophorektomie',
  'Schellong-Test', 'Schwangerschaftsfettleber',
  'Schwangerschaftscholestase',
  'Sectio', 'Septum', 'Sterilität',
  'Streptokokken', 'Struma', 'Strumektomie',
  'Synechie', 'Synektomie',
  'Teratom', 'Thelarche', 'Thrombophilie',
  'Tokolyse', 'Tokolytikum',
  'Toxoplasmose',
  'Trachelorrhaphie',
  'Tubenkarzinom', 'Tubensterilisation',
  'Tubargravidität',
  'Urethrozele', 'Urethroskopie',
  'Urethrotomie',
  'Uterusfehlbildung', 'Uterus myomatosus',
  'Uterusruptur', 'Uterusverletzung',
  'Vaginalaplasie', 'Vaginalstenose',
  'Vaginismus', 'Vulvakarzinom',
  'Vulvitis', 'Vulvodynie', 'Vulvoskopie',
  'Zervixinsuffizienz', 'Zervixkarzinom',
  'Zervixreifung', 'Zervixzytologie',
  'Zytostatikatherapie',
  'Vulvektomie', 'Hysterektomie',
  'Adnexektomie', 'Oophorektomie',
  'Kolpektomie', 'Kolpokleisis',
  'Kolposkopie', 'Kolporrhaphie',
  'Kuldozentese',
  'Mammareduktionsplastik',
  'Geburtsgewichtsperzentile',
  'Geburtsverletzung',
  'Mukoviszidose', 'Zystische-Fibrose',
  'Harninkontinenz', 'Belastungsinkontinenz',
  'Urgeinkontinenz', 'Mischinkontinenz',
  'überaktive Blase',
  'Detrusor-Sphinkter-Dyssynergie',
  'Interstitielle Zystitis',
  'Bestrahlungszystitis',
  'Bakteriurie',
  'Harnverhalt', 'Restharnbestimmung',
  'Urodynamik',
  'Fundusstand',
  'Tokogramm',
  'Kardiotokogramm',
  'Kardiotokographie',
  'Dopplersonographie',
  'Fet',
  'Serologie',
  'Seron', 'Sermorelix',
]);

const COMMON = new Set([
  'Abort', 'Abstillen', 'Abstrichentnahme', 'Abweichung', 'Abtastung',
  'Abtreibung', 'Abdomen', 'Adipositas', 'Akzeptanz', 'Allgemein',
  'Anamnese', 'Anatomie', 'Ätiologie', 'Aufklärung', 'Aufnahme',
  'Ausbildung', 'Ausbreitung', 'Ausfluss', 'Ausgang', 'Auslösung',
  'Ausräumung', 'Austreibung', 'Becken', 'Befund', 'Befunderhebung',
  'Befunddokumentation', 'Behandlung', 'Behandlungsalternative',
  'Behandlungsdokumentation', 'Beinvenenthrombose', 'Beratung',
  'Beschwerden', 'Bestrahlung', 'Beweissicherung', 'Bildung',
  'Biometrie', 'Biopsie', 'Blase', 'Blutung', 'Blutstillung',
  'Bluttransfusion', 'Brust', 'Brustdrüse', 'Diagnostik',
  'Dokumentation', 'Dosis', 'Dosierung', 'Drainage', 'Druck',
  'Durchführung', 'Durchschnitt', 'Dysplasie', 'Einleitung',
  'Einstellung', 'Einteilung', 'Eiweiß', 'Embryo', 'Embryonal',
  'Embryonalentwicklung', 'Embryonalperiode', 'Empfängnis',
  'Empfängnisverhütung', 'Empfindlichkeit', 'Endokrinium',
  'Endometrium', 'Entbindung', 'Entfernung', 'Entscheidung',
  'Entwicklung', 'Entzündung', 'Erbrechen', 'Erfahrung',
  'Erfolg', 'Ergebnis', 'Erhaltung', 'Erhöhung', 'Erkrankung',
  'Ernährung', 'Eröffnung', 'Erwartung', 'Erweiterung',
  'Familie', 'Familienanamnese', 'Fehlbildung', 'Fehler',
  'Fertilität', 'Fet', 'Fetal', 'Fetoplazentare', 'Fetus',
  'Fibrose', 'Flüssigkeit', 'Follikel', 'Follikelsprung',
  'Forschung', 'Fortbildung', 'Fortschritt', 'Frage',
  'Früherkennung', 'Frühgeburt', 'Frühschwangerschaft',
  'Funktion', 'Geburt', 'Geburtsgewicht', 'Geburtshelfer',
  'Geburtshilfe', 'Geburtsverlauf', 'Gefahr', 'Gefäß',
  'Gegenstand', 'Gehirn', 'Gelenk', 'Genetik', 'Genital',
  'Genitalbereich', 'Genitalinfektion', 'Genitalorgan',
  'Genitaltuberkulose', 'Gerinnung', 'Gerinnungsstörung',
  'Geschlecht', 'Geschlechtsentwicklung', 'Geschlechtsorgan',
  'Geschlechtsverkehr', 'Geschwulst', 'Gesicht', 'Gesundheit',
  'Gewebe', 'Gewicht', 'Gewichtszunahme', 'Gewohnheit',
  'Gleichgewicht', 'Glied', 'Gonade', 'Grad', 'Grenze',
  'Größe', 'Grund', 'Gruppe', 'Gynäkologie', 'Gynäkologisch',
  'Harn', 'Harnblase', 'Harninkontinenz', 'Harnleiter',
  'Harnröhre', 'Harnstau', 'Harntrakt', 'Harntrakterweiterung',
  'Harnwegsinfekt', 'Harnwegsinfektion', 'Haut', 'Häufigkeit',
  'Heilung', 'Hilfe', 'Hintergrund', 'Hirn', 'Histologie',
  'Höhe', 'Hormon', 'Hormonersatztherapie', 'Hormonspirale',
  'Hormonstäbchen', 'Hormontherapie', 'Hüfte', 'Hygiene',
  'Hyperplasie', 'Hypophyse', 'Hypothalamus', 'Hypothese',
  'Hysteroskopie', 'Impfung', 'Implantation', 'Indikation',
  'Infektion', 'Infektionsrisiko', 'Infertilität',
  'Infiltration', 'Information', 'Injektion', 'Inkontinenz',
  'Insemination', 'Insuffizienz', 'Insulin', 'Intensität',
  'Intimbereich', 'Intubation', 'Invasion',
  'Inzidenz', 'Jahr', 'Kaiserschnitt', 'Kalender',
  'Kapitel', 'Karzinom', 'Karzinogenese', 'Kastration',
  'Katheterm', 'Keim', 'Keimdrüse', 'Keimzelle', 'Kinder',
  'Kinderwunsch', 'Klinik', 'Knochen', 'Koagulation',
  'Kohorte', 'Kollagen', 'Kolon', 'Kombination',
  'Kommunikation', 'Kompetenz', 'Komplikation', 'Komponente',
  'Kondom', 'Konisation', 'Konsensus', 'Kontraktion',
  'Kontraindikation', 'Kontrolle', 'Konzeption', 'Kooperation',
  'Kopf', 'Körper', 'Korrelation', 'Kortikoid',
  'Kraft', 'Krankheit', 'Krebs', 'Krebserkrankung',
  'Krebsfrüherkennung', 'Krebsvorsorge', 'Kreislauf',
  'Kultur', 'Kunde', 'Kurs', 'Labor', 'Laktation',
  'Laparoskopie', 'Laparotomie', 'Länge', 'Läsion',
  'Leben', 'Lebensstil', 'Lebensqualität',
  'Leber', 'Lebererkrankung', 'Lehre', 'Leiden',
  'Leistung', 'Leitlinie', 'Lernen',
  'Ligatur', 'Lipid', 'Lipom', 'Literatur', 'Lochien',
  'Lokalisation', 'Lösung', 'Lunge', 'Lymphknoten',
  'Lymphom', 'Lymphozele', 'Magen', 'Magersucht',
  'Malignität', 'Mangel', 'Masse', 'Massage', 'Material',
  'Mamma', 'Mammographie', 'Mastitis',
  'Medikament', 'Medikation', 'Medizin', 'Meinung',
  'Membran', 'Menge', 'Mensch', 'Menstruation',
  'Merkmal', 'Messung', 'Metastase', 'Methode',
  'Milch', 'Milieu', 'Minderung', 'Minimum', 'Mitte',
  'Mitteilung', 'Mittel', 'Mittelwert', 'Modell',
  'Modifikation', 'Molekül', 'Monat', 'Morbidität',
  'Morphologie', 'Mortalität', 'Mund', 'Muskel',
  'Mutation', 'Mutter', 'Muttermund', 'Myom',
  'Nabelschnur', 'Nachbesprechung', 'Nachkontrolle',
  'Nachsorge', 'Nachuntersuchung', 'Nachweis',
  'Narbe', 'Narkose', 'Nase', 'Natur', 'Nebenhoden',
  'Nebenwirkung', 'Nekrose', 'Neonatal', 'Neugeborenes',
  'Nerv', 'Netz', 'Netzwerk', 'Neubildung',
  'Niere', 'Nierenfunktion', 'Niveau', 'Norm',
  'Normalbefund', 'Normalisierung', 'Notfall',
  'Nukleus', 'Null', 'Nutzung',
  'Obduktion', 'Objekt', 'Ödem', 'Operation',
  'Ordnung', 'Organ', 'Organisation',
  'Ovar', 'Ovarial', 'Ovarien',
  'Parameter', 'Pathogenese', 'Pathologie',
  'Patient', 'Patientin', 'Periode', 'Person',
  'Perspektive', 'Pflege', 'Pharmakokinetik',
  'Phase', 'Physiologie', 'Plazenta',
  'Polymer', 'Population', 'Position', 'Post',
  'Postmenopause', 'Potenzial', 'Praxis',
  'Präkanzerose', 'Prämedikation', 'Prämenopause',
  'Pränatal', 'Pränataldiagnostik', 'Prävention',
  'Prediktion', 'Prinzip', 'Problem', 'Produktion',
  'Prognose', 'Programm', 'Progression', 'Projekt',
  'Proliferation', 'Prophylaxe', 'Prostata',
  'Protein', 'Prozess', 'Prüfung', 'Psychologie',
  'Publikation', 'Punktion',
  'Qualität', 'Quantität',
  'Radioaktivität', 'Rahmen', 'Randomisierung',
  'Rate', 'Raum', 'Reaktion', 'Recht', 'Rechtfertigung',
  'Reduktion', 'Referenz', 'Regel', 'Region', 'Register',
  'Regulation', 'Rehabilitation', 'Reihe', 'Reifung',
  'Rektum', 'Relation', 'Remission', 'Resektion',
  'Resistenz', 'Resolution', 'Ressource',
  'Rest', 'Resultat', 'Rezeptor', 'Rezidiv',
  'Richtlinie', 'Risiko', 'Rolle', 'Röntgen',
  'Rückbildung', 'Rückfall', 'Ruhe',
  'Scheide', 'Schleimhaut', 'Schmerz', 'Schnitt',
  'Schnittentbindung', 'Schritt', 'Schulter',
  'Schwangerschaft', 'Schwangerschaftsabbruch',
  'Schwangerschaftsdauer', 'Schwangerschaftswoche',
  'Schwelle', 'Schwerpunkt', 'Screening',
  'Sekret', 'Sekretion', 'Sektion', 'Sekunde',
  'Selbst', 'Selbstbestimmung', 'Selektion',
  'Senkung', 'Sensitivität', 'Sepsis', 'Septum',
  'Sequenz', 'Serie', 'Serologie', 'Serum',
  'Sicherheit', 'Sicht', 'Signal', 'Sinn',
  'Situation', 'Skalp', 'Sklerose', 'Sonde',
  'Sozial', 'Spaltung', 'Spektrum', 'Spender',
  'Spezialist', 'Spiegel', 'Spirale', 'Sprache',
  'Stabilisierung', 'Stadium', 'Standard', 'Station',
  'Statistik', 'Stelle', 'Stellung', 'Stillen',
  'Stoff', 'Stoffwechsel', 'Störung', 'Strahlung',
  'Strategie', 'Stress', 'Struktur', 'Student',
  'Studie', 'Stunde', 'Substitution', 'Substrat',
  'Suche', 'Summe', 'Symptom', 'Symptomatik',
  'Syndrom', 'System',
  'Tabelle', 'Tag', 'Tätigkeit', 'Technik',
  'Teil', 'Teilbereich', 'Thema', 'Theorie',
  'Therapie', 'Tiefe', 'Tier', 'Tod', 'Toleranz',
  'Toxizität', 'Träger', 'Training', 'Transfer',
  'Transformation', 'Transplantation', 'Transport',
  'Trend', 'Trennung', 'Tumor', 'Tumorbildung',
  'Tumordiagnostik', 'Tumorentstehung', 'Tumorerkrankung',
  'Tumorlast', 'Tumorleiden', 'Tumorstadium',
  'Tumortherapie', 'Tumorwachstum', 'Tumorzelle',
  'Typ', 'Überempfindlichkeit', 'Überleben',
  'Überlebensrate', 'Übersicht', 'Überwachung',
  'Umfang', 'Umgebung', 'Umstand', 'Umwelt',
  'Unabhängigkeit', 'Unfall', 'Unterbauch',
  'Unterbindung', 'Unterbrechung', 'Unterschied',
  'Untersuchung', 'Ursache', 'Uterus',
  'Vagina', 'Vakuum', 'Vater', 'Vaterschaft',
  'Veränderung', 'Verantwortung', 'Verbindung',
  'Verbrauch', 'Verdacht', 'Verdauung', 'Verein',
  'Vererbung', 'Verfahren', 'Verfügbarkeit',
  'Vergleich', 'Verhalten', 'Verhältnis',
  'Verklebung', 'Verlauf', 'Vermehrung',
  'Verminderung', 'Vernetzung', 'Verschluss',
  'Versuch', 'Verteilung', 'Vertrauen',
  'Verwachsung', 'Verwendung', 'Verzicht',
  'Vielzahl', 'Virus', 'Vulva',
  'Wachstum', 'Wahrscheinlichkeit', 'Wandel',
  'Wasser', 'Wechsel', 'Wechselwirkung',
  'Weg', 'Wert', 'Wiederherstellung',
  'Wirkung', 'Wirkungsweise', 'Wirtschaft',
  'Wissenschaft', 'Woche', 'Wundheilung',
  'Zahl', 'Zeichen', 'Zeit', 'Zeitraum',
  'Zelle', 'Zellkern', 'Zellteilung', 'Zelltod',
  'Zellwachstum', 'Zellzahl', 'Zellzyklus',
  'Zentrum', 'Zertifizierung', 'Ziel',
  'Zirkulation', 'Zufall', 'Zugang', 'Zukunft',
  'Zusammenarbeit', 'Zustand', 'Zuverlässigkeit',
  'Zyste', 'Zystitis', 'Zytologie', 'Zytostatika',
]);

const result = [];

for (const term of terms) {
  if (COMMON.has(term)) continue;
  
  // Drug names (suffix-based)
  if (DRUG_PATTERN.test(term)) {
    if (!COMMON.has(term)) result.push(term);
    continue;
  }
  
  if (DRUG_WHITELIST.has(term)) {
    result.push(term);
    continue;
  }
  
  if (TERM_WHITELIST.has(term)) {
    result.push(term);
    continue;
  }
  
  // Syndrome names
  if (/Syndrom$/.test(term) && term.length > 10) {
    result.push(term);
    continue;
  }
}

result.sort((a, b) => a.localeCompare(b, 'de'));
fs.writeFileSync('artifacts/medizinische_fachwoerter Gyn-Geburtshilfe.txt', result.join('\n') + '\n');
console.log('Kept:', result.length);
result.forEach(w => console.log(w));
