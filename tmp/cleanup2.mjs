import fs from 'fs';

const INPUT_PATH = 'artifacts/medizinische_fachwoerter Radiologie.txt';
let lines = fs.readFileSync(INPUT_PATH, 'utf8').split('\n').filter(Boolean);

// Comprehensive blacklist of things STT would already know
const BLACKLIST = new Set([
  // Plain adjectives/adverbs that are common
  'Akut', 'Akute', 'Akutes', 'Akuter', 'Chronisch', 'Chronische', 'Chronisches',
  'Akromega', 'Akute', 'Akutes', 'Akuter',
  // Common medical adjectives
  'Allgemein', 'Allgemeine', 'Allgemeines', 'Akromega', 'Akromegalie', 'Akromegaliepatienten',
  'Alarmzeichen', 'Algorithmus', 'Allgemeinsymptomatik', 'Allgemeinsymptome',
  'Allgemeinsymptomen', 'Alkoholikern', 'Analyse', 'Anastomosen',
  'Angiosarcoma', 'Angiomato', 'Anomalie', 'Anomalien', 'Anzeichen',
  'Aortensklerose', 'Aponeurose', 'Aponeurosen', 'Apoptose',
  'Arthrose', 'Arthrosen', 'Arthrosebilder', 'Arthrosebild', 'Arthrosebildes',
  'Arthrosetyp', 'Arthrosis', 'Arthrosezeichen', 'Arthroskopie',
  'Arthritis', 'Arthritisbildes', 'Arthritische', 'Arthralgie', 'Arthralgien',
  'Anatomie', 'Anatomisch', 'Anatomische', 'Anatomischer',
  'Antibiotikum', 'Antibiotika', 'Antibiotikatherapie',
  // Basic anatomy - any general term
  'Acromion', 'Akromiom', 'Akromions',
  'Adenopathie', 'Adenom', 'Adenombildung',
  'Aortenklappe', 'Aortenaneurysma', 'Aortenbogen',
  'Bandscheibe', 'Bandscheiben', 'Bandscheibenvorfall',
  'Becken', 'Beckenkamm', 'Beckenknochen', 'Beckenskelett',
  'Bindegewebe', 'Bindegewebsknochen',
  'Blut', 'Blutgefäß', 'Blutgefäße', 'Blutergelenk', 'Blutstrom',
  'Diagnose', 'Diagnostik', 'Diagnostikum', 'Diagnosehilfe', 'Diagnosehilfen',
  'Diagnosekriterien', 'Diagnosen', 'Diagnosesicherung', 'Diagnosestellung',
  'Diagnoses', 'Diagnosetyp', 'Diagnosestadium', 'Diagnostisch',
  'Diagnostische', 'Diagnostischen', 'Diagnostisches',
  'Erythrozyt', 'Erythrozyten', 'Leukozyt', 'Leukozyten', 'Lymphozyt', 'Lymphozyten',
  'Gelenk', 'Gelenke', 'Gelenkflüssigkeit', 'Gelenkkapsel', 'Gelenkknorpel',
  'Gewebe', 'Gewebsnekrosen',
  'Haut', 'Hautverdickung', 'Hautverdickungen',
  'Herz', 'Herzinfarkt', 'Herzrhythmusstörung',
  'Knochen', 'Knochenaufweitung', 'Knochenbälkchen', 'Knochendichte',
  'Knochenmark', 'Knochensarkoidose', 'Knochennekrose', 'Knochennekrosen',
  'Knochenzement', 'Knochenzyste', 'Knochentuberkulose', 'Knochenverdickungen',
  'Knochenverformung', 'Knochenmarkfibrose', 'Knochenmarknekrose',
  'Knochenmarknekrosen', 'Knochenmarksdosis', 'Knochenmarksklerose',
  'Knochenmarksnekrosen', 'Knochenmarksstromazellen',
  'Knochenmarksszintigraphie', 'Knochenmarkthrombosen', 'Knocheninfarkt',
  'Knochenischämie', 'Knochenmarksödem', 'Knochenmarksödemäquivalent',
  'Knochenmarkamyloidose', 'Knochenmarkszintigramm', 'Knochenmarksszintigramme',
  'Knochenmarkszintigrammen', 'Knochenmarködemäquivalent', 'Knochenmarködemäquivalente',
  'Knochenmarködemäquivalents', 'Knochenmarködeme', 'Knochenmarködemmuster',
  'Knochenmarködemsyndrom', 'Knochensarkom', 'Knochenszintigramme',
  'Knochenfibrom', 'Knochenfibrome', 'Knochenfibromen', 'Knochenfibroms',
  'Knochengranulom', 'Knochenhämangioma', 'Knochenhypertrophie',
  'Knochenmarkmetastasekommt', 'Knochenphänomen', 'Knochenmarksdosis',
  'Knochenmarksödemäquivalent', 'Knochensequester', 'Knochensynovialom',
  'Knochenszintigramm', 'Knochentrümmer', 'Knochenmarksszintigraphie',
  'Knorpel', 'Knorpelmetaplasie', 'Knorpelnekrose', 'Knorpeltrümmer',
  'Komplikation', 'Komplikationstyp', 'Komplikationsrate', 'Komplikationsraten',
  'Komplikationen', 'Kompressionsfraktur', 'Kompressionsfrakturen', 'Kompressionen',
  'Konglomerat', 'Konglomerate', 'Konglomeraten', 'Konglomerattumor',
  'Kortikalis', 'Kortikalisverdickung', 'Kortikalisverdickungen',
  'Kortikoidosteopathie', 'Kortikoidosteoporose', 'Kortisondosis',
  'Krankheitsbild', 'Krankheitsbilder', 'Krankheitsverlauf', 'Krankheitsverläufe',
  'Krankheitsstadium', 'Krankheitsstadien',
  'Läsion', 'Läsionen', 'Läsionstyp', 'Läsionstypen',
  'Leber', 'Leberfibrose', 'Leberzirrhose', 'Leberkarzinom', 'Leberzelle',
  'Lymphom', 'Lymphome', 'Lymphomen', 'Lymphoms', 'Lymphommanifestation',
  'Magen', 'Magenkarzinom', 'Magenkarzinoms', 'Magensymptome', 'Magensymptomen',
  'Manifestation', 'Manifestationen', 'Marker', 'Markers', 'Markraum',
  'Markraumaufweitung', 'Markraumaufweitungen', 'Markraumeinengung',
  'Markraumödem', 'Markraumosteosklerose', 'Markraumsklerose',
  'Mastozytom', 'Mastozytose', 'Mastozytosen', 'Mastozytosesyndrom',
  'Mastzellenleukämie', 'Mastzellleukämie', 'Mastzellretikulose',
  'Mastzellengranulome', 'Mastzellenleukämie', 'Mastzellengranulom',
  'Mastozytom', 'Mastozytose', 'Mastozytosen', 'Mastozytosesyndrom',
  'Meningitis', 'Meningeom', 'Meningeome', 'Meningeomen', 'Meningiom',
  'Meniskus', 'Meniskusschaden', 'Meniskusriss', 'Meniskus-Symptomatik',
  'Metastase', 'Metastasen', 'Metastasierung', 'Metastasierungen',
  'Morbus', 'Morbus-Paget', 'Morbus-Bechterew', 'Morbus-Scheuermann',
  'Muskel', 'Muskelhämatome', 'Muskelkontrakturen', 'Muskelnekrose',
  'Myelom', 'Myeloma', 'Myelomprotein', 'Myelomproteine', 'Myelomformen',
  'Myelomherde', 'Myelomläsion', 'Myelompatienten', 'Myelomzellen',
  'Myelomzellinfiltration', 'Myelombefall', 'Myelombefalls', 'Myelombild',
  'Myelome', 'Myelomen', 'Myeloms', 'Myelommanifestation', 'Myelomansammlung',
  'Myelomatose', 'Myelomatosis', 'Myelomschädel',
  'Neoplasie', 'Neoplasien', 'Nephrokalzinose', 'Nephrolithiasis',
  'Nephropathie', 'Nephrosklerose', 'Nervenkompression',
  'Nieren', 'Nierenkarzinom', 'Nierenkarzinome', 'Nierenzellkarzinom',
  'Nierenzellkarzinome', 'Nierenzellkarzinoms', 'Nierentuberkulose',
  'Nierenamyloidose', 'Nierenvenenthrombose',
  'Ödem', 'Ödeme', 'Ödems', 'Ödementwicklung', 'Ödemnachweis',
  'Ödembild', 'Ödembildung', 'Ödemäquivalent', 'Ödemäquivalente',
  'Ödemäquivalenten', 'Ödemäquivalents', 'Ödematisierung', 'Ödemzeichen',
  'Pankreatitis', 'Pankreas', 'Pankreaskopf', 'Pankreaskarzinom', 'Pankreasfibrose',
  'Patient', 'Patienten', 'Patientengut', 'Patientenkollektiv', 'Patientenfall',
  'Periost', 'Periostabhebung', 'Periostitis', 'Periostitische',
  'Periostödem', 'Periostosen', 'Periostreaktion', 'Periostverdickung',
  'Plasmozytom', 'Plasmozytome', 'Plasmozytoms', 'Plasmozytomnieren',
  'Plasmozytomnire', 'Plasmozytomgewebe', 'Plasmozytomherde', 'Plasmozytommanifestationen',
  'Plasmozytomosteoporose', 'Plasmozytomzellen', 'Plasmazellen', 'Plasmazellmyelom',
  'Plasmazellleukämie', 'Plasmozytomnire',
  'Pleura', 'Pleuraerguss', 'Pleurakarzinose', 'Pleuramesotheliom', 'Pleuritis',
  'Polyneuropathie', 'Polyp', 'Polypen', 'Polypose', 'Polyposis',
  'Prädilektionsstellen', 'Prognose', 'Prognosefaktor', 'Prognosefaktoren',
  'Prognoseparameter', 'Prognoseverbesserung',
  'Radiographie', 'Radiogramm', 'Radiogramme', 'Radiogrammen', 'Radiogramms',
  'Radiokarpalgelenk', 'Röntgenkriterium', 'Röntgenkriterien',
  'Röntgenphänomene', 'Röntgenphänomenen', 'Röntgenphänomenologisch',
  'Röntgensymptom', 'Röntgensymptoma', 'Röntgensymptomatik',
  'Röntgensymptomatolo', 'Röntgensymptomatologie', 'Röntgenzeichen',
  'Röntgenfrühzeichen', 'Röntgenmorphologie', 'Röntgenkriterium',
  'Schädel', 'Schädelknochen', 'Schädelbasissklerose', 'Schädeldeformität',
  'Schädelkalottensklerose', 'Schädelhämangiomen',
  'Schmerz', 'Schmerzen', 'Schmerzsyndrom', 'Schmerzsyndrome', 'Schmerzsyndroms',
  'Schmerzsymptom', 'Schmerzsymptome', 'Schmerzsymptomen', 'Schmerzsymptomatik',
  'Schnittbild', 'Schnittbilder', 'Schnittbilddiagnostik',
  'Septum', 'Sehne', 'Sehnen', 'Sehnenriss', 'Sehnenscheidenentzündung',
  'Sklerose', 'Sklerosen', 'Skleroseareal', 'Sklerosearealen', 'Skleroseherde',
  'Skleroserand', 'Skleroseränder', 'Skleroserändern', 'Skleroserandes',
  'Sklerosesaum', 'Sklerosesäume', 'Sklerosesäumen', 'Sklerosesaums',
  'Sklerosezeichen', 'Sklerosezone', 'Sklerosezonen', 'Sklerosierung',
  'Sklerosteose', 'Sklerostosis', 'Sklerodermie',
  'Spongiosa', 'Spongiosasklerose', 'Spongiosasklerosen', 'Spongiosaumstrukturierung',
  'Spongiosaverdichtung', 'Spongiosazeichnung', 'Spongiosklerose', 'Spongiosklerosen',
  'Stadium', 'Stadien', 'Stadieneinteilung', 'Stadiengruppierung', 'Stadieneinteilung',
  'Strahlentherapie', 'Strahlendosis', 'Strahlenbehandlung', 'Strahlenbelastung',
  'Strahlenexposition', 'Strahlenempfindlichkeit', 'Strahlendosis', 'Strahlenhygiene',
  'Strahlenschutz', 'Strahlenwirkung', 'Strahlenwirkungen',
  'Stressfraktur', 'Stressfrakturen', 'Stressfrakturspalt', 'Stressfrakturhöhe',
  'Stressfrakturtheorie', 'Stressfrakturursache', 'Stressfrakturursachen',
  'Stressfrakturanamnese', 'Stressphänomen', 'Stressphänomene', 'Stressphänomenen',
  'Stressphänomens', 'Stress-phänomen', 'Streßphänomen', 'Stroma',
  'Stromazellen', 'Stromas', 'Stromaakti', 'Stromaossifika',
  'Symptom', 'Symptome', 'Symptomatisch', 'Symptomatische', 'Symptomatik',
  'Symptomatologie', 'Symptombeginn', 'Symptombezogene', 'Symptomen',
  'Symptomenbeginn', 'Symptomenbild', 'Symptomenkomplex', 'Symptomentrias',
  'Symptomenvielfalt', 'Symptomfreiheit', 'Symptomlosigkeit', 'Symptoms',
  'Symptomatk', 'Symptomatic',
  'Szintigramm', 'Szintigramme', 'Szintigrammen', 'Szintigramms',
  'Szintigraphie', 'Szintigraphiebefund', 'Szintigraphiebefunde',
  'Therapie', 'Therapien', 'Therapieform', 'Therapieformen', 'Therapiekonzept',
  'Therapiekontrolle', 'Therapieoption', 'Therapieoptionen', 'Therapieplanung',
  'Therapieregime', 'Therapieresistenz', 'Therapieansprechen', 'Therapieerfolg',
  'Therapieansatz', 'Therapieverfahren', 'Therapiemodalitäten',
  'Therapieversuch', 'Therapieversuche',
  'Tumor', 'Tumoren', 'Tumorgewebe', 'Tumormasse', 'Tumormassen',
  'Tumornekrosefaktor', 'Tumornekrosefaktoren', 'Tumornekrosefaktorfamilie',
  'Tumornekrosefaktors', 'Tumornekrosen', 'Tumorstroma', 'Tumorzellkonglomerate',
  'Tumordiagnostik', 'Tumorerkrankung', 'Tumorerkrankungen',
  'Tumorpatient', 'Tumorpatienten', 'Tumorrezidiv', 'Tumorrezidive',
  'Tumorstadium', 'Tumorstadien', 'Tumorwachstum',
  'Verkalkung', 'Verkalkungen', 'Verknöcherung', 'Verknöcherungen',
  'Wasserstoffatomkern',
  'Zelle', 'Zellen', 'Zellverband', 'Zellverbände', 'Zellvermehrung',
  'Zellvermehrungen', 'Zellveränderung', 'Zellveränderungen', 'Zelluntergang',
  'Zytologie', 'Zytomorphologie', 'Zytoplasma', 'Zytostatika',
  'Zytostatikatherapie', 'Zytostatikainfusion', 'Zytostatikum',
]);

// More aggressive: remove any word that is a simple compound of a common word + suffix
// First, identify base forms of common terms to skip
const COMMON_BASE_FORMS = new Set([
  'Aktivierung', 'Anteil', 'Anzahl', 'Befund', 'Befunde', 'Bereich', 'Bild',
  'Dichte', 'Dignität', 'Effekt', 'Effekte', 'Einteilung', 'Entität', 'Entitäten',
  'Ergebnis', 'Ergebnisse', 'Erscheinung', 'Erscheinungen', 'Form', 'Formen',
  'Frequenz', 'Frequenzen', 'Größe', 'Größen', 'Häufigkeit', 'Höhe', 'Inzidenz',
  'Klassifikation', 'Komplikation', 'Komplikationen', 'Konzept', 'Konzepte',
  'Läsion', 'Läsionen', 'Manifestation', 'Manifestationen', 'Marker',
  'Maßnahme', 'Maßnahmen', 'Muster', 'Musterung', 'Nomenklatur', 'Norm',
  'Parameter', 'Phänomen', 'Phänomene', 'Prinzip', 'Prinzipien', 'Problem',
  'Probleme', 'Prognose', 'Prognosen', 'Reaktion', 'Reaktionen', 'Risiko',
  'Risiken', 'Schweregrad', 'Spezifität', 'Stadium', 'Stadien', 'Studie', 'Studien',
  'Symptom', 'Symptome', 'Symptomatik', 'Therapie', 'Therapien', 'Typ', 'Typen',
  'Variante', 'Varianten', 'Veränderung', 'Veränderungen', 'Verlauf', 'Verläufe',
  'Vorkommen', 'Wert', 'Werte', 'Wirkung', 'Wirkungen', 'Zeichen', 'Zeit',
  'Zustand', 'Zustände', 'Ätiologie', 'Dignität', 'Differenzierung',
  'Einteilung', 'Entstehung', 'Erkrankung', 'Erkrankungen', 'Genese',
  'Herkunft', 'Klassifikation', 'Klassifizierung', 'Klinik', 'Konzept',
  'Kriterium', 'Kriterien', 'Lokalisation', 'Lokalisationen', 'Manifestation',
  'Maßnahme', 'Maßnahmen', 'Mechanismus', 'Mechanismen', 'Merkmal', 'Merkmale',
  'Methode', 'Methoden', 'Möglichkeit', 'Möglichkeiten', 'Muster', 'Musterung',
  'Pathogenese', 'Pathomechanismus', 'Phänomen', 'Phänomene', 'Prognose',
  'Risiko', 'Risiken', 'Schweregrad', 'Spezifität', 'Stadium', 'Stadien',
  'Symptom', 'Symptome', 'Symptomatik', 'Therapie', 'Therapien', 'Typ', 'Typen',
  'Verlauf', 'Verläufe', 'Verteilung', 'Verteilungen', 'Vorkommen', 'Wert',
  'Werte', 'Wirkung', 'Wirkungen', 'Zeichen', 'Zustand', 'Zustände',
]);

function isGenericCompound(w) {
  // Find if the word ends with one of the common base forms as a compound suffix
  for (const base of COMMON_BASE_FORMS) {
    if (w.length > base.length + 4 && w.endsWith(base)) {
      return true;
    }
  }
  return false;
}

let filtered = [];
for (const w of lines) {
  if (!w || w.length < 4) continue;
  if (BLACKLIST.has(w)) continue;
  if (isGenericCompound(w)) continue;
  filtered.push(w);
}

// Pass 3: remove duplicates of English/Latin variants of same word
const seen = new Set();
const dedup = [];
for (const w of filtered) {
  // Normalize for dedup
  const norm = w.toLowerCase().replace(/[äöüß]/g, c => ({ 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss' }[c] || c));
  if (seen.has(norm)) continue;
  seen.add(norm);
  dedup.push(w);
}

dedup.sort((a, b) => a.localeCompare(b, 'de'));
fs.writeFileSync(INPUT_PATH, dedup.join('\n') + '\n');
console.log(`Done: ${dedup.length} terms (was ${lines.length})`);
