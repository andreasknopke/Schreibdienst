import fs from 'fs';

const TEXT_PATH = 'artifacts/medtext.txt';
const OUT_PATH = 'artifacts/medizinische_fachwoerter Radiologie.txt';

const MEDICAL_SUFFIXES = new RegExp([
  // Allgemein medizinisch
  '(itis|ose|om|opathie|ektomie|otomie|ostomie|ographie|oskopie|ämie|urie|algie|ödem|spasmus|ptose|dynie|plegie|sklerose|stenose|nekrose|fibrose|zirrhose|thrombose|ekstasie|hypertrophie|hypoplasie|dysplasie|aplasie|malazie|pexie|rhaphie|stomose|desis|zentese)',
  // Radiologisch
  '(graphie|gramm|skopie|tomographie|densitometrie|szintigraphie|angiographie|lymphographie|arthrographie|myelographie|pyelographie|cholangiographie|hysterosalpingographie|mammographie|sialographie|dacryocystographie|nephrostomie|nephrektomie|lobektomie|segmentektomie)',
  // Skelett-radiologisch spezifisch
  '(porose|malazie|sklerose|ostrophy|osteolyse|osteolyse|osteopathie|osteotomie|osteoplastik|osteosynthese)',
  // Pathologische Veränderungen im Röntgen/MRT/CT
  '(verdickung|verschmälerung|verplumpung|verformung|erweiterung|einengung|verengung|aufweitung|überbrückung|durchtrennung|absprengung|fraktur|luxation|subluxation|dislokation|kontraktur|ankylose|sinterung|kompression|impression)',
].join('|'), 'i');

const MEDICAL_SUBSTRINGS = /(karzinom|sarkom|blastom|neurinom|meningeom|adenom|fibrom|lipom|myom|osteom|chondrom|angiom|granulom|osteochondrom|osteosarkom|chondrosarkom|hämangiom|lymphangiom|hämangiosarkom|eosinophiles|granulom|syndrom|zeichen|phänomen|kern|wirbel|gelenk|knochen|osteoblast|osteoklast|osteozyt|chondroblast|chondrozyt|kortikalis|spongiosa|periost|endost|epiphyse|metaphyse|diaphyse|apophyse|kondylen|epikondylen|tuberositas|trochanter|foramen|kanal|fissur|fossa|spalt|bandscheibe|wirbelkörper|wirbelbogen|fortsatz|domfortsatz|querfortsatz|gelenkfortsatz|dornfortsatz|querschrieb|spondyl|spondylo|listhese|lyse|sinterung|berstung|trümmer|stauchung|abkippung|verschiebung|verkürzung|verlängerung|skoliosierung|kyphosierung|deformität|arthrose|arthritis|synovitis|osteomyelitis|spondylitis|spondylodiszitis|bandscheibenvorfall|osteoporose|osteomalazie|osteodystrophie|osteonekrose|knocheninfarkt|avitale|sequester|resorptionssaum|periostreaktion|periostabhebung|enthesiopathien|osteophyten|spornbildung|gelenkspaltverschmälerung|subchondrale|sklerosierung|geröllzysten|usuren|kortikalisläsion|aufhellung|tumorosteolyse|mottenfraß|lytisch|sklerotisch|gemischtförmig)$/i;

const RADIOLOGY_TERMS = [
  'Röntgenaufnahme', 'Durchleuchtung', 'Zielaufnahme', 'Übersichtsaufnahme',
  'Thoraxaufnahme', 'Abdomenübersicht', 'Beckenskelett', 'Schädelaufnahme',
  'Wirbelsäulenaufnahme', 'Extremitätenaufnahme', 'Kontrastmittel', 'Kontrastmittelgabe',
  'Kontrastmittelapplikation', 'Kontrastmitteluntersuchung', 'Kontrastmittelextravasat',
  'Kontrastmittelanreicherung', 'Kontrastmittelaussparung',
  'Computertomographie', 'Computertomographieuntersuchung', 'Computertomograph',
  'Spiralcomputertomographie', 'Mehrzeilendetektorspiralcomputertomographie',
  'Magnetresonanztomographie', 'Magnetresonanztomograph',
  'Dünnschichtcomputertomographie', 'Hochfeldmagnetresonanztomographie',
  'Perfusionsbildgebung', 'Diffusionsbildgebung', 'Diffusionswichtung',
  'Kernspintomographie', 'Sonographie', 'Echokardiographie',
  'Duplexsonographie', 'Farbcodierte', 'Dopplersonographie', 'Endosonographie',
  'Intravaskuläre', 'Ultraschallkopf', 'Ultraschallsonde', 'Ultraschalluntersuchung',
  'Transducer', 'Angiographie', 'Subtraktionsangiographie', 'DSA',
  'Phasenkontrastangiographie', 'Magnetresonanzangiographie',
  'Digitale', 'Subtraktionsangiographie', 'Skelettszintigraphie',
  'Knochenszintigraphie', 'Entzündungsszintigraphie', 'Tumorszintigraphie',
  'Szintigraphie', 'Szintigramm', 'PET', 'Positronenemissionstomographie',
  'PET-CT', 'PET-MRT', 'SPECT', 'Hybridbildgebung', 'Bildfusion',
  'Osteodensitometrie', 'Knochendichtemessung', 'DEXA', 'QCT',
  'Lungenfunktionsprüfung', 'Radiologisch', 'Radiologin', 'Radiologe',
  'Aufnahmetechnik', 'Belichtung', 'Dosisflächenprodukt', 'Röhrenspannung',
  'Röhrenstrom', 'Streustrahlung', 'Strahlenhygiene', 'Strahlenexposition',
  'Effektive', 'Dosis', 'Hautdosis', 'Oberflächendosis', 'Tiefendosis',
  'Feldgröße', 'Fokus-Haut-Abstand', 'Fokus-Objekt-Abstand', 'Objekt-Film-Abstand',
  'Raster', 'Streustrahlenraster', 'Belichtungsautomatik',
  'Skelettszintigraphie', 'Drei-Phasen-Skelettszintigraphie',
  'Bloodpool', 'Spätphase', 'Uptake', 'Speicherung', 'Mehrspeicherung',
  'Minderbelegung', 'Nuklearmedizinisch', 'Radiologische', 'Radiolucent',
  'Radiodens', 'Transparenz', 'Transparenzminderung', 'Verschattung',
  'Verdichtung', 'Aufhellung', 'Strukturaufhellung', 'Strukturverdichtung',
  'Homogen', 'Inhomogen', 'Sklerosierung', 'Sklerosezone', 'Sklerosesaum',
  'Lytisch', 'Lytische', 'Sklerotisch', 'Gemischförmig',
  'Destruktion', 'Osteolyse', 'Osteosklerose', 'Periostreaktion',
  'Periostose', 'Periostabhebung', 'Kortikalisunterbrechung',
  'Kortikalisläsion', 'Kortikalisdestruktion', 'Kortikalissklerose',
  'Spongiosasklerose', 'Spongiosaverdichtung', 'Spongiosazeichnung',
  'Knochenbälkchen', 'Trabekel', 'Trabekelstruktur', 'Trabekelzeichnung',
  'Resorptionssaum', 'Resorptionszone', 'Osteoid', 'Osteoblastom',
  'Osteoklastom', 'Osteochondrom', 'Osteom', 'Osteoidosteom',
  'Osteosarkom', 'Chondrom', 'Chondroblastom', 'Chondrosarkom',
  'Ewing-Sarkom', 'Riesenzelltumor', 'Osteofibrom', 'Knochenzyste',
  'Aneurysmatische', 'Einfache', 'Juvenile', 'Osteolysezone',
  'Tumorosteolyse', 'Mottenfraßartig', 'Knocheninfarkt',
  'Knochenmarködem', 'Osteonekrose', 'Hüftkopfnekrose', 'Femurkopfnekrose',
  'Morbus', 'Perthes', 'Köhler', 'Kienböck', 'Preiser', 'Osgood-Schlatter',
  'Osteochondrosis', 'Osteochondronekrose', 'Dissecans',
  'Wirbelkörperkompression', 'Wirbelkörperfraktur', 'Deckplatteneinbruch',
  'Grundplatteneinbruch', 'Sinterungsfraktur', 'Keilwirbel',
  'Fischwirbel', 'Plattwirbel', 'Spongiosaspongiosaplastik',
  'Osteosynthese', 'Osteosynthesematerial', 'Plattenosteosynthese',
  'Schraubenosteosynthese', 'Nagelosteosynthese', 'Marknagelosteosynthese',
  'Fixateur', 'Externe', 'Kirschnerdraht', 'Cerclage', 'Zuggurtung',
  'Arthrodese', 'Arthroplastik', 'Endoprothese', 'Totalendoprothese',
  'Gleitpaarung', 'Polyethylen', 'Metal-on-Metal', 'Zement', 'Knochenzement',
  'Zementiert', 'Zementfreie', 'Hybridprothese', 'Prothesenschaft',
  'Prothesenpfanne', 'Prothesenkopf', 'Prothesenspalt', 'Inlay',
  'Röntgenkriterium', 'Röntgenzeichen', 'Röntgensymptom',
  'Radiologisches', 'Diagnostikpfad', 'Algorithmus',
  'Strahlentherapie', 'Strahlenbehandlung', 'Strahlendosis', 'Herddosis',
  'Stereotaxie', 'Stereotaktisch', 'Linearbeschleuniger',
  'Brachytherapie', 'Afterloading', 'LDR', 'HDR',
  'Kobaltkanone', 'Radioiodtherapie', 'Radiosynoviorthese',
  'Entscheidungsmatrix', 'Befundmatrix',
];

const EXCLUDE_WORDS = new Set([
  'und', 'oder', 'sowie', 'sondern', 'auch', 'aber', 'denn',
  'dieser', 'diese', 'dieses', 'jeder', 'jede', 'jedes',
  'alle', 'manche', 'einige', 'mehrere', 'viele', 'wenige',
  'kein', 'keine', 'keines', 'anderer', 'andere', 'anderes',
  'wichtig', 'wesentlich', 'möglich', 'eventuell', 'gelegentlich',
  'häufig', 'selten', 'manchmal', 'oft', 'immer', 'niemals',
  'deutlich', 'ausgeprägt', 'gering', 'stark', 'schwach',
  'leicht', 'schwer', 'mäßig', 'erheblich',
  'erhöht', 'erniedrigt', 'normal', 'pathologisch',
  'insbesondere', 'beziehungsweise', 'bzw', 'beispielsweise',
  'entsprechend', 'insgesamt', 'zunächst', 'schließlich',
  'gegebenenfalls', 'ggf', 'eventuell', 'evtl',
  'selbiges', 'solches', 'derartige', 'derartiges',
  'Kapitel', 'Seite', 'Abbildung', 'Tabelle', 'Band', 'Auflage',
  'Patient', 'Patientin', 'Patienten', 'Arzt', 'Ärztin', 'Ärzte',
  'Diagnose', 'Diagnostik', 'Therapie', 'Differenzialdiagnose',
  'Untersuchung', 'Behandlung', 'Befund', 'Befunde',
  'Klinik', 'Krankheit', 'Krankheiten', 'Symptom', 'Symptome',
  'Folge', 'Folgen', 'Ursache', 'Ursachen', 'Zustand', 'Zustände',
  'Verlauf', 'Verläufe', 'Möglichkeit', 'Möglichkeiten',
  'Bereich', 'Bereiche', 'Region', 'Regionen', 'Lokalisation',
  'Veränderung', 'Veränderungen', 'Erkrankung',
  'Klassifikation', 'Einteilung', 'Definition', 'Charakteristik',
  'Beschreibung', 'Darstellung', 'Zusammenfassung',
  'Merkmal', 'Merkmale', 'Kriterium', 'Kriterien',
  'Ausrichtung', 'Bezeichnung', 'Beispiel', 'Beispiele',
  'Jahr', 'Monat', 'Tag', 'Stunde', 'Minute', 'Sekunde',
  'Medizin', 'Mediziner', 'Student', 'Arzt', 'Kollege', 'Kollegen',
  'Skelett', 'Knochen', 'Gelenk', 'Gewebe', 'Körper', 'Organ',
  'Wirbelsäule', 'Wirbel', 'Rippe', 'Rippen', 'Brustkorb',
  'Becken', 'Schädel', 'Gesicht', 'Stirn', 'Wange', 'Kiefer',
  'Schulter', 'Oberarm', 'Unterarm', 'Hand', 'Finger',
  'Oberschenkel', 'Unterschenkel', 'Fuß', 'Zehe', 'Zehen',
  'Knie', 'Hüfte', 'Ellbogen', 'Ellenbogen', 'Handgelenk',
  'Sprunggelenk', 'Daumen', 'Kreuzbein', 'Steißbein',
  'Lendenwirbel', 'Brustwirbel', 'Halswirbel', 'Bandscheibe',
  'Bandscheiben', 'Gelenkkapsel', 'Gelenkflüssigkeit',
  'Knochenmark', 'Knochenhaut', 'Gelenkknorpel', 'Muskel',
  'Sehne', 'Band', 'Bänder', 'Faszie', 'Schleimbeutel',
  'Nerv', 'Nerven', 'Gefäß', 'Gefäße', 'Arterie', 'Vene',
  'Blut', 'Lymphe', 'Niere', 'Lunge', 'Leber', 'Herz', 'Magen',
  'Darm', 'Haut', 'Zelle', 'Zellen', 'Zellkern',
  'Tabelle', 'Tabellen', 'Abbildung', 'Abbildungen',
  'Schema', 'Skizze', 'Grafik', 'Diagramm', 'Foto', 'Fotos',
  'Röntgenbild', 'Röntgenaufnahme', 'CT-Bild', 'MRT-Bild',
  'Ultraschallbild', 'Skelettszintigraphie', 'Angiographie',
  'Einführung', 'Einleitung', 'Grundlage', 'Grundlagen',
  'Hinweis', 'Hinweise', 'Anmerkung', 'Anmerkungen',
  'Grund', 'Gründe', 'Angabe', 'Angaben',
  'Anteil', 'Anteile', 'Prozent', 'Zahl', 'Zahlen',
  'Formel', 'Formeln', 'Wert', 'Werte', 'Parameter',
  'Literatur', 'Publikation', 'Publikationen', 'Studie', 'Studien',
]);

function isValidLength(w) {
  return w.length >= 4 && w.length <= 55;
}

function isAbbreviation(w) {
  if (/^[A-ZÄÖÜ]{2,}$/.test(w)) return true;
  if (/^[A-ZÄÖÜ][a-zäöüß]*[\.]/.test(w)) return true;
  if (w.startsWith('A.') || w.startsWith('M.') || w.startsWith('N.') || w.startsWith('V.')) return true;
  return false;
}

function hasMedicalContent(w) {
  if (MEDICAL_SUFFIXES.test(w)) return true;
  if (MEDICAL_SUBSTRINGS.test(w)) return true;
  if (RADIOLOGY_TERMS.includes(w)) return true;
  // Radiologie-spezifische Endungen
  if (/(graphie|gramm|skopie|densitometrie|szintigraphie|osteolyse|osteosklerose|osteopathie|osteonekrose|osteotomie|osteosynthese|arthroplastik|arthrodese|endoprothese)$/i.test(w)) return true;
  // Skelett-spezifisch
  if (/(vertebral|pedikulär|lamellär|kortikal|subchondral|periostal|endostal|epiphysär|metaphysär|diaphysär|apophysär|intraossär|extraossär|paraossär)$/i.test(w)) return true;
  // Medikamente/KM
  if (/(olol|pril|sartan|oxacin|mycin|cillin|azol|navir|mab|stat|dronat|formin|vastatin|prazol|tidin|parin|dipin|curonium|verin|fiban|grel|ximab|zumab|omab|cain|zolam|zepam)$/i.test(w)) return true;
  // Entzündungs- und Tumor-Endungen
  if (/(itis|oma|osis|iasis|pathie|ämie|urie)$/i.test(w)) return true;
  return false;
}

console.error('Reading medtext.txt...');
const text = fs.readFileSync(TEXT_PATH, 'utf8');
console.error(`File size: ${(text.length / 1024 / 1024).toFixed(1)} MB`);

console.error('Extracting candidate words...');
// Extract capitalized German nouns (including hyphenated compounds)
const words = text.match(/[A-ZÄÖÜ][a-zäöüßß]+(?:[-][A-ZÄÖÜa-zäöüß]+)*/g) || [];
console.error(`Found ${words.length} candidate words.`);

console.error('Filtering...');
const seen = new Set();
const result = [];

for (const w of words) {
  const lower = w.toLowerCase();
  if (!isValidLength(w)) continue;
  if (seen.has(lower)) continue;
  seen.add(lower);

  if (EXCLUDE_WORDS.has(w)) continue;
  if (isAbbreviation(w)) continue;
  if (!hasMedicalContent(w)) continue;

  result.push(w);
}

result.sort((a, b) => a.localeCompare(b, 'de'));
fs.writeFileSync(OUT_PATH, result.join('\n') + '\n');
console.error(`Done: ${result.length} terms written to ${OUT_PATH}`);
