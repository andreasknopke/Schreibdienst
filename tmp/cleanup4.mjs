import fs from 'fs';

const INPUT_PATH = 'artifacts/medizinische_fachwoerter Radiologie.txt';
let lines = fs.readFileSync(INPUT_PATH, 'utf8').split('\n').filter(Boolean);

// Only OCR truncation fragments and truly generic words (not disease categories)
const removeSet = new Set([
  // OCR truncation artifacts
  'Astrom', 'Gitis', 'Ierosis', 'Ietthyperostose', 'Iiose', 'Iitis', 'Iorheostosis',
  'Karziom', 'Karzimoms', 'Mammkarzinom', 'Mammkarzinoms',
  'Osteomy', 'Osteomyeli', 'Osteomyeliti', 'Osteomyelits', 'Osteomyelo',
  'Osteomyeloskle', 'Osteomyelosklero', 'Osteomyelosklerose-Syn', 'Osteomyelosklerosesyn',
  'Osteomyleo', 'Osteomartige', 'Osteomtyp', 'Osteoidostom', 'Ostearthritis', 'Ostemalazie',
  'Ostesarkome', 'Ostoidosteom', 'Osteo-athropathie', 'Osteosakrom',
  'Osteoporosethera', 'Osteomyelitische', 'Osteomyelitisform', 'Osteomyelitisbild', 'Osteomyelitiden',
  'Pyomy', 'Sakom', 'Thrombo', 'Tomin', 'Tomo', 'Tomogr',
  'Vorkom', 'Vorkommens', 'Unterschenkelvenenthrom', 'Prothesenkom', 'Wirbelkörperkom',
  'Grammm', 'Enchonchromatose', 'Enochondroma', 'Enchondromata', 'Chondro',
  'Osteomalacia', 'Osteomalacie', 'Osteomalzie', 'Osteomala',
  'Osteoskierose', 'Osteoskleose', 'Wdylitis',
  'Disco-vertebral', 'Fluorodeoxyglucose', 'Hemangiopericytoma',
  'Pseudomalignant', 'Pseudoxanthoma', 'Sarcomatous',
  'Osteonecrosis', 'Osteogenesis', 'Osteofibrosis',
  'Hemangioma', 'Hemangiomas', 'Sarcoma', 'Sarcomas',
  'Osteosarcoma', 'Chondrosarcoma', 'Osteoblastoma', 'Chondroblastoma',
  'Chordoma', 'Elastofibroma', 'Hibernoma', 'Leiomyosarcoma', 'Meningioma',
  'Neurofibroma', 'Osteoid-osteoma', 'Osteoidosteoma',
  'Synovioma', 'Hemangiopericytoma',
  'Ecchordosis', 'Echinococcosis', 'Sarcoidosis',
  'Osteoarthrosis', 'Osteochondrosis', 'Spondylosis',
  'Osteopetrosis', 'Osteopoikilosis', 'Osteomesopyknosis', 'Pyknodysostosis',
  'Osteosclerosis', 'Hyperostosis', 'Fibroostosis',
  'Myelomatosis', 'Mastocytosis', 'Lipomatosis', 'Neurofibromatosis',
  'Fibromatosis', 'Osteolysis',
  // English terms (keep German equivalent)
  'Gossipiboma', 'Gossipiboma-Imitation', 'Gossipibomas', 'Gossypiboma', 'Textiloma',
  // truly common: basic German words, basic anatomy
  'Fossa', 'Spalt', 'Raster', 'Usuren',
  'Phantom', 'Zyanose', 'Zoonose', 'Heparin', 'Ptosis', 'Kolitis',
  'Bronchiolitis',
  'Sinterung', 'Sinterungen',
  'Verdichtung', 'Verdickung', 'Verdickungen', 'Verschmälerung', 'Verschmälerungen', 'Verkürzung',
  'Fissur', 'Fissurierungen', 'Bruchspalt',
  'Prominenz', 'Prominenzen', 'Isomorphie', 'Engramme',
  'Warenzeichen', 'Röntgenaufnahme', 'Röntgenbild',
  'Lunatum', 'Scaphoid', 'Scaphoideum', 'Skaphoid',
  'Tarsus', 'Tarsometatarsal',
  'Os', 'Foramen', 'Femur', 'Humerus', 'Talus', 'Radius', 'Trochanter',
  'Tuberositas', 'Processus',
  // truly compound generics with -chen (diminutive)
  'Knöchelchen',
  // "zeichen" type basic radiology descriptors
  'Spiegelphänomen', 'Vakuumphänomen',
  'Penumbra-Zeichen', 'Fettzeichen',
  'Heilungszeichen',
  'Frame-Zeichen', 'Frame-Phänomen', 'Frame-Syndrom', 'Frame-Test', 'Frame-Sign',
]);

const result = [];
let removed = [];

for (const w of lines) {
  if (removeSet.has(w)) {
    removed.push(w);
    continue;
  }
  result.push(w);
}

result.sort((a, b) => a.localeCompare(b, 'de'));
fs.writeFileSync(INPUT_PATH, result.join('\n') + '\n');
console.log('Done: ' + result.length + ' terms kept (was ' + lines.length + ')');
console.log('Removed ' + removed.length + ':');
removed.sort((a, b) => a.localeCompare(b, 'de')).forEach(s => console.log('  -', s));
