/**
 * Standard-Wörterbuch für medizinische Radiologie-Fachbegriffe.
 * Wird automatisch mit dem Benutzer-Wörterbuch gemerged.
 * 
 * Enthält häufig falsch transkribierte Begriffe aus:
 * - Anatomie & Strukturen
 * - Pathologien & Befundbegriffe
 * - Eponyme (Eigennamen)
 * - Untersuchungstechniken & Sequenzen
 * 
 * Format: { wrong: "häufige STT-Fehlschreibung", correct: "korrekte Schreibweise" }
 * 
 * "wrong" = was das STT-Modell typischerweise produziert
 * "correct" = was im Befund stehen soll
 */

export interface StandardDictionaryEntry {
  wrong: string;
  correct: string;
}

export const STANDARD_DICTIONARY: StandardDictionaryEntry[] = [
  // ============================
  // 1. Anatomie & Strukturen
  // ============================
  // Selbst-Einträge für phonetisches Matching (STT-Varianten werden automatisch erkannt)
  { wrong: 'Acetabulum', correct: 'Acetabulum' },
  { wrong: 'Azetabulum', correct: 'Acetabulum' },
  { wrong: 'Articulatio acromioclavicularis', correct: 'Articulatio acromioclavicularis' },
  { wrong: 'Bulla ethmoidalis', correct: 'Bulla ethmoidalis' },
  { wrong: 'Canalis carpi', correct: 'Canalis carpi' },
  { wrong: 'Condylus occipitalis', correct: 'Condylus occipitalis' },
  { wrong: 'Kondylus Okzipitalis', correct: 'Condylus occipitalis' },
  { wrong: 'Corpus geniculatum laterale', correct: 'Corpus geniculatum laterale' },
  { wrong: 'Ductus choledochus', correct: 'Ductus choledochus' },
  { wrong: 'Duktus Choledochus', correct: 'Ductus choledochus' },
  { wrong: 'Foramen intervertebrale', correct: 'Foramen intervertebrale' },
  { wrong: 'Fossa ischioanalis', correct: 'Fossa ischioanalis' },
  { wrong: 'Gyrus postcentralis', correct: 'Gyrus postcentralis' },
  { wrong: 'Gyrus Postzentralis', correct: 'Gyrus postcentralis' },
  { wrong: 'Haustrierung', correct: 'Haustrierung' },
  { wrong: 'Incisura ischiadica', correct: 'Incisura ischiadica' },
  { wrong: 'Inzisura Ischiadika', correct: 'Incisura ischiadica' },
  { wrong: 'Labrum acetabulare', correct: 'Labrum acetabulare' },
  { wrong: 'Labrum Azetabulare', correct: 'Labrum acetabulare' },
  { wrong: 'Ligamentum cruciatum anterius', correct: 'Ligamentum cruciatum anterius' },
  { wrong: 'Ligamentum Kruziatum', correct: 'Ligamentum cruciatum anterius' },
  { wrong: 'Malleolus lateralis', correct: 'Malleolus lateralis' },
  { wrong: 'Mesenterium', correct: 'Mesenterium' },
  { wrong: 'Mesenteriom', correct: 'Mesenterium' },
  { wrong: 'Neuroforamen', correct: 'Neuroforamen' },
  { wrong: 'Neuro Foramen', correct: 'Neuroforamen' },
  { wrong: 'Os scaphoideum', correct: 'Os scaphoideum' },
  { wrong: 'Os Skaphoideum', correct: 'Os scaphoideum' },
  { wrong: 'Patellofemoralgelenk', correct: 'Patellofemoralgelenk' },
  { wrong: 'Processus coracoideus', correct: 'Processus coracoideus' },
  { wrong: 'Prozessus Korakoideus', correct: 'Processus coracoideus' },
  { wrong: 'Promontorium', correct: 'Promontorium' },
  { wrong: 'Promotorium', correct: 'Promontorium' },
  { wrong: 'Recessus hepatorenalis', correct: 'Recessus hepatorenalis' },
  { wrong: 'Sella turcica', correct: 'Sella turcica' },
  { wrong: 'Sella Turzika', correct: 'Sella turcica' },
  { wrong: 'Symphysis pubica', correct: 'Symphysis pubica' },
  { wrong: 'Truncus coeliacus', correct: 'Truncus coeliacus' },
  { wrong: 'Trunkus Zöliakus', correct: 'Truncus coeliacus' },

  // ============================
  // 2. Pathologien & Befundbegriffe
  // ============================
  { wrong: 'Aneurysma spurium', correct: 'Aneurysma spurium' },
  { wrong: 'Aneurysma Sporium', correct: 'Aneurysma spurium' },
  { wrong: 'Ankylosierung', correct: 'Ankylosierung' },
  { wrong: 'Ankilosierung', correct: 'Ankylosierung' },
  { wrong: 'Arteriovenöse Malformation', correct: 'Arteriovenöse Malformation' },
  { wrong: 'Balkenagenesie', correct: 'Balkenagenesie' },
  { wrong: 'Balken Agenesie', correct: 'Balkenagenesie' },
  { wrong: 'Cholesteatom', correct: 'Cholesteatom' },
  { wrong: 'Kolesteatom', correct: 'Cholesteatom' },
  { wrong: 'Darmwandödem', correct: 'Darmwandödem' },
  { wrong: 'Darmwand Ödem', correct: 'Darmwandödem' },
  { wrong: 'Dissektion', correct: 'Dissektion' },
  { wrong: 'Disektion', correct: 'Dissektion' },
  { wrong: 'Diverticulitis', correct: 'Diverticulitis' },
  { wrong: 'Divertikelitis', correct: 'Diverticulitis' },
  { wrong: 'Enchondrom', correct: 'Enchondrom' },
  { wrong: 'Enkondrom', correct: 'Enchondrom' },
  { wrong: 'Exazerbation', correct: 'Exazerbation' },
  { wrong: 'Exacerbation', correct: 'Exazerbation' },
  { wrong: 'Exaserbation', correct: 'Exazerbation' },
  { wrong: 'Fibroadenom', correct: 'Fibroadenom' },
  { wrong: 'Gallenblasensludge', correct: 'Gallenblasensludge' },
  { wrong: 'Gallenblasen Sludge', correct: 'Gallenblasensludge' },
  { wrong: 'Hämangiom', correct: 'Hämangiom' },
  { wrong: 'Hemangiom', correct: 'Hämangiom' },
  { wrong: 'Herniation', correct: 'Herniation' },
  { wrong: 'Hypodensität', correct: 'Hypodensität' },
  { wrong: 'Infiltration', correct: 'Infiltration' },
  { wrong: 'Ischämie', correct: 'Ischämie' },
  { wrong: 'Iskämie', correct: 'Ischämie' },
  { wrong: 'Kavernom', correct: 'Kavernom' },
  { wrong: 'Cavernom', correct: 'Kavernom' },
  { wrong: 'Kontrastmittelanspeicherung', correct: 'Kontrastmittelanspeicherung' },
  { wrong: 'Kontrastmittel Anspeicherung', correct: 'Kontrastmittelanspeicherung' },
  { wrong: 'Lymphadenopathie', correct: 'Lymphadenopathie' },
  { wrong: 'Metastasierung', correct: 'Metastasierung' },
  { wrong: 'Myelopathie', correct: 'Myelopathie' },
  { wrong: 'Mielopathie', correct: 'Myelopathie' },
  { wrong: 'Nekrosezone', correct: 'Nekrosezone' },
  { wrong: 'Nekrose Zone', correct: 'Nekrosezone' },
  { wrong: 'Osteochondrosis dissecans', correct: 'Osteochondrosis dissecans' },
  { wrong: 'Osteochondrosis Disekans', correct: 'Osteochondrosis dissecans' },
  { wrong: 'Pannusbildung', correct: 'Pannusbildung' },
  { wrong: 'Pannus Bildung', correct: 'Pannusbildung' },
  { wrong: 'Perikarderguss', correct: 'Perikarderguss' },
  { wrong: 'Perikard Erguss', correct: 'Perikarderguss' },
  { wrong: 'Pleurazyten', correct: 'Pleurazyten' },
  { wrong: 'Pneumothorax', correct: 'Pneumothorax' },
  { wrong: 'Pseudarthrose', correct: 'Pseudarthrose' },
  { wrong: 'Pseudo Arthrose', correct: 'Pseudarthrose' },
  { wrong: 'Radikulopathie', correct: 'Radikulopathie' },
  { wrong: 'Raumforderung', correct: 'Raumforderung' },
  { wrong: 'Raum Forderung', correct: 'Raumforderung' },
  { wrong: 'Siderose', correct: 'Siderose' },
  { wrong: 'Ziderose', correct: 'Siderose' },
  { wrong: 'Sklerosierungszone', correct: 'Sklerosierungszone' },
  { wrong: 'Spondylolisthesis', correct: 'Spondylolisthesis' },
  { wrong: 'Spondylolistese', correct: 'Spondylolisthesis' },
  { wrong: 'Spondylolithesis', correct: 'Spondylolisthesis' },
  { wrong: 'Spondylolistesis', correct: 'Spondylolisthesis' },
  { wrong: 'Stenose', correct: 'Stenose' },
  { wrong: 'Subarachnoidalblutung', correct: 'Subarachnoidalblutung' },
  { wrong: 'Sub Arachnoidalblutung', correct: 'Subarachnoidalblutung' },
  { wrong: 'Syringomyelie', correct: 'Syringomyelie' },
  { wrong: 'Siringomyelie', correct: 'Syringomyelie' },
  { wrong: 'Syringomielie', correct: 'Syringomyelie' },
  { wrong: 'Thromboembolie', correct: 'Thromboembolie' },
  { wrong: 'Thrombo Embolie', correct: 'Thromboembolie' },
  { wrong: 'Tumorentität', correct: 'Tumorentität' },
  { wrong: 'Tumor Entität', correct: 'Tumorentität' },
  { wrong: 'Unkovertebralarthrose', correct: 'Unkovertebralarthrose' },
  { wrong: 'Vaskularisation', correct: 'Vaskularisation' },
  { wrong: 'Zystenformation', correct: 'Zystenformation' },
  { wrong: 'Zysten Formation', correct: 'Zystenformation' },

  // ============================
  // 3. Eponyme (Eigennamen)
  // ============================
  { wrong: 'Bankart-Läsion', correct: 'Bankart-Läsion' },
  { wrong: 'Bangart Läsion', correct: 'Bankart-Läsion' },
  { wrong: 'Bankart Läsion', correct: 'Bankart-Läsion' },
  { wrong: 'Bennett-Fraktur', correct: 'Bennett-Fraktur' },
  { wrong: 'Benett Fraktur', correct: 'Bennett-Fraktur' },
  { wrong: 'Bennett Fraktur', correct: 'Bennett-Fraktur' },
  { wrong: 'Charcot-Fuß', correct: 'Charcot-Fuß' },
  { wrong: 'Scharko Fuß', correct: 'Charcot-Fuß' },
  { wrong: 'Charcot Fuß', correct: 'Charcot-Fuß' },
  { wrong: 'Chiari-Malformation', correct: 'Chiari-Malformation' },
  { wrong: 'Kiari Malformation', correct: 'Chiari-Malformation' },
  { wrong: 'Chiari Malformation', correct: 'Chiari-Malformation' },
  { wrong: 'Galeazzi-Fraktur', correct: 'Galeazzi-Fraktur' },
  { wrong: 'Galeazi Fraktur', correct: 'Galeazzi-Fraktur' },
  { wrong: 'Galeazzi Fraktur', correct: 'Galeazzi-Fraktur' },
  { wrong: 'Hill-Sachs-Läsion', correct: 'Hill-Sachs-Läsion' },
  { wrong: 'Hill Sachs Läsion', correct: 'Hill-Sachs-Läsion' },
  { wrong: 'Hoffa-Fettkörper', correct: 'Hoffa-Fettkörper' },
  { wrong: 'Hoffa Fettkörper', correct: 'Hoffa-Fettkörper' },
  { wrong: 'Legg-Calvé-Perthes', correct: 'Legg-Calvé-Perthes' },
  { wrong: 'Leg Calve Perthes', correct: 'Legg-Calvé-Perthes' },
  { wrong: 'Legg Calvé Perthes', correct: 'Legg-Calvé-Perthes' },
  { wrong: 'Lisfranc-Gelenkreihe', correct: 'Lisfranc-Gelenkreihe' },
  { wrong: 'Lisfrank Gelenkreihe', correct: 'Lisfranc-Gelenkreihe' },
  { wrong: 'Lisfranc Gelenkreihe', correct: 'Lisfranc-Gelenkreihe' },
  { wrong: 'Maisonneuve-Fraktur', correct: 'Maisonneuve-Fraktur' },
  { wrong: 'Maisonneuve Fraktur', correct: 'Maisonneuve-Fraktur' },
  { wrong: 'Monteggia-Fraktur', correct: 'Monteggia-Fraktur' },
  { wrong: 'Montegia Fraktur', correct: 'Monteggia-Fraktur' },
  { wrong: 'Monteggia Fraktur', correct: 'Monteggia-Fraktur' },
  { wrong: 'Morbus Bechterew', correct: 'Morbus Bechterew' },
  { wrong: 'Morbus Bechterev', correct: 'Morbus Bechterew' },
  { wrong: 'Morbus Bechterow', correct: 'Morbus Bechterew' },
  { wrong: 'Morbus Scheuermann', correct: 'Morbus Scheuermann' },
  { wrong: 'Morbus Scheuerman', correct: 'Morbus Scheuermann' },
  { wrong: 'Paget-Karzinom', correct: 'Paget-Karzinom' },
  { wrong: 'Paget Karzinom', correct: 'Paget-Karzinom' },
  { wrong: 'Pancoast-Tumor', correct: 'Pancoast-Tumor' },
  { wrong: 'Pancoast Tumor', correct: 'Pancoast-Tumor' },
  { wrong: 'Segond-Fraktur', correct: 'Segond-Fraktur' },
  { wrong: 'Segond Fraktur', correct: 'Segond-Fraktur' },
  { wrong: 'Stieda-Fraktur', correct: 'Stieda-Fraktur' },
  { wrong: 'Stida Fraktur', correct: 'Stieda-Fraktur' },
  { wrong: 'Stieda Fraktur', correct: 'Stieda-Fraktur' },
  { wrong: 'Tietze-Syndrom', correct: 'Tietze-Syndrom' },
  { wrong: 'Titze Syndrom', correct: 'Tietze-Syndrom' },
  { wrong: 'Tietze Syndrom', correct: 'Tietze-Syndrom' },

  // ============================
  // 4. Untersuchungstechniken & Sequenzen
  // ============================
  { wrong: 'Diffusionswichtung', correct: 'Diffusionswichtung' },
  { wrong: 'Diffusions Wichtung', correct: 'Diffusionswichtung' },
  { wrong: 'Echo-Planar-Imaging', correct: 'Echo-Planar-Imaging' },
  { wrong: 'Echo Planar Imaging', correct: 'Echo-Planar-Imaging' },
  { wrong: 'Fettsättigung', correct: 'Fettsättigung' },
  { wrong: 'Fett Sättigung', correct: 'Fettsättigung' },
  { wrong: 'FLAIR-Sequenz', correct: 'FLAIR-Sequenz' },
  { wrong: 'FLAIR Sequenz', correct: 'FLAIR-Sequenz' },
  { wrong: 'Flair Sequenz', correct: 'FLAIR-Sequenz' },
  { wrong: 'Gadolinium-DTPA', correct: 'Gadolinium-DTPA' },
  { wrong: 'Gadolinium DTPA', correct: 'Gadolinium-DTPA' },
  { wrong: 'Gradientenecho', correct: 'Gradientenecho' },
  { wrong: 'Gradienten Echo', correct: 'Gradientenecho' },
  { wrong: 'Hounsfield-Einheiten', correct: 'Hounsfield-Einheiten' },
  { wrong: 'Hounsfield Einheiten', correct: 'Hounsfield-Einheiten' },
  { wrong: 'Haunsfield Einheiten', correct: 'Hounsfield-Einheiten' },
  { wrong: 'Isointensität', correct: 'Isointensität' },
  { wrong: 'Isointentsität', correct: 'Isointensität' },
  { wrong: 'Maximumintensitätsprojektion', correct: 'Maximumintensitätsprojektion' },
  { wrong: 'Maximum Intensitäts Projektion', correct: 'Maximumintensitätsprojektion' },
  { wrong: 'Multiplanare Reformatierung', correct: 'Multiplanare Reformatierung' },
  { wrong: 'Multi Planare Reformatierung', correct: 'Multiplanare Reformatierung' },
  { wrong: 'Native Aufnahme', correct: 'Native Aufnahme' },
  { wrong: 'Nativ Aufnahme', correct: 'Native Aufnahme' },
  { wrong: 'Perfusions-MRT', correct: 'Perfusions-MRT' },
  { wrong: 'Perfusions MRT', correct: 'Perfusions-MRT' },
  { wrong: 'Perfusion MRT', correct: 'Perfusions-MRT' },
  { wrong: 'Phasenkontrast-Angiographie', correct: 'Phasenkontrast-Angiographie' },
  { wrong: 'Phasenkontrast Angiographie', correct: 'Phasenkontrast-Angiographie' },
  { wrong: 'Phasenkontrast Angiografie', correct: 'Phasenkontrast-Angiographie' },
  { wrong: 'Short-Tau-Inversion-Recovery', correct: 'Short-Tau-Inversion-Recovery' },
  { wrong: 'Short Tau Inversion Recovery', correct: 'Short-Tau-Inversion-Recovery' },
  { wrong: 'STIR', correct: 'STIR' },
  { wrong: 'T2-Wichtung', correct: 'T2-Wichtung' },
  { wrong: 'T2 Wichtung', correct: 'T2-Wichtung' },
  { wrong: 'T1-Wichtung', correct: 'T1-Wichtung' },
  { wrong: 'T1 Wichtung', correct: 'T1-Wichtung' },
];

/**
 * Merged Standard-Wörterbuch mit Benutzer-Einträgen.
 * Benutzer-Einträge haben Vorrang (überschreiben Standard bei gleichem "wrong").
 */
export function mergeWithStandardDictionary<T extends { wrong: string; correct: string }>(
  userEntries: T[]
): (T | StandardDictionaryEntry)[] {
  // User-"wrong"-Wörter sammeln (case-insensitive)
  const userWrongWords = new Set(
    userEntries.map(e => e.wrong.toLowerCase())
  );

  // Standard-Einträge die nicht vom User überschrieben werden
  const standardOnly = STANDARD_DICTIONARY.filter(
    e => !userWrongWords.has(e.wrong.toLowerCase())
  );

  return [...userEntries, ...standardOnly];
}
