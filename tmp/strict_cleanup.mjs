import fs from 'fs';

const INPUT_PATH = 'artifacts/medizinische_fachwoerter Radiologie.txt';
const OUTPUT_PATH = 'artifacts/medizinische_fachwoerter Radiologie.txt';

let lines = fs.readFileSync(INPUT_PATH, 'utf8').split('\n').filter(Boolean);

// Common medical terms that WhisperX/Voxtral would already know - REMOVE
const TOO_COMMON = new Set([
  // Allgemeine medizinische Grundbegriffe
  'Anatomie', 'Anatomisch', 'Anatomische', 'Anatomischer',
  'Anämie', 'Anämieformen', 'Anämien',
  'Arthritis', 'Arthrose', 'Arthrosen', 'Arthrosis', 'Arthralgie', 'Arthralgien',
  'Arthropathie', 'Arthropathien',
  'Azidose', 'Azidosen',
  'Biopsie', 'Biomarker', 'Biomechanik',
  'Diagnose', 'Diagnosen', 'Diagnostik',
  'Endokarditis', 'Endometriose', 'Enteritis',
  'Enzephalitis', 'Enzephalopathie', 'Enzephalomyelitis',
  'Epilepsie', 'Epiphyse',
  'Fraktur', 'Frakturen', 'Fibrose', 'Fibrosen',
  'Gastritis', 'Gastroenteritis', 'Gastroskopie',
  'Hämangiom', 'Hämangiome', 'Hämangiomen', 'Hämangioms',
  'Hämatom', 'Hämatome', 'Hämatomen', 'Hämatoms',
  'Hepatitis', 'Hepatomegalie', 'Hepatosplenomegalie',
  'Hyperämie', 'Hyperkalzämie', 'Hyperkalziurie',
  'Hyperlipidämie', 'Hyperlipoproteinämie',
  'Hyperphosphatämie', 'Hyperphosphaturie', 'Hyperthyreose',
  'Hyperurikämie', 'Hyperurikämien',
  'Hypokaliämie', 'Hypokalzämie', 'Hypokalziurie',
  'Hypophosphatämie', 'Hypoplasie', 'Hypoplasien', 'Hypothyreose',
  'Iritis', 'Ischämie', 'Ischämien',
  'Karzinom', 'Karzinome', 'Karzinomen', 'Karzinoms',
  'Kern', 'Kernspintomografie', 'Kernspintomographie',
  'Knochenmarködem', 'Knochenmarködeme', 'Knochenmarködems',
  'Koxarthrose', 'Koxarthritis', 'Koxitis',
  'Kyphose', 'Kyphosen', 'Kyphoskoliose', 'Kyphoskoliosen',
  'Laryngitis', 'Leukämie', 'Leukämien', 'Leukozytose',
  'Lipom', 'Lipome', 'Lipomen', 'Lipoms', 'Lipomatose', 'Lipomatosen', 'Lipomatosis',
  'Lymphom', 'Lymphome', 'Lymphomen', 'Lymphoms',
  'Luxation', 'Luxationen', 'Magenkarzinom', 'Magenkarzinoms',
  'Mammakarzinom', 'Mammakarzinome', 'Mammakarzinomen', 'Mammakarzinoms',
  'Meningeom', 'Meningeome', 'Meningeomen', 'Meningiom', 'Meningitis',
  'Mastozytom', 'Mastozytose', 'Mastozytosen',
  'Metaplasie', 'Myalgie', 'Myalgien', 'Myelitis',
  'Myelom', 'Myelome', 'Myelomen', 'Myeloms',
  'Myokarditis', 'Myositis', 'Myopathie', 'Myopathien',
  'Narkose', 'Narkosen', 'Nekrose', 'Nekrosen',
  'Nephritis', 'Nephropathie',
  'Neuritis', 'Neuropathie', 'Nierenkarzinom', 'Nierenkarzinome',
  'Ödem', 'Ödeme', 'Ödems', 'Ödembildung', 'Ödementwicklung',
  'Oligoarthritis', 'Oligoarthralgien', 'Omarthritis', 'Omarthrose',
  'Oophoritis', 'Orchitis',
  'Osteoporose', 'Osteoporosen', 'Osteosynthese', 'Osteosynthesen',
  'Osteotomie', 'Osteotomien', 'Osteomyelitis', 'Osteomyelitiden',
  'Osteolyse', 'Osteolysen', 'Osteom', 'Osteome', 'Osteomen', 'Osteoms',
  'Osteosarkom', 'Osteosarkome', 'Osteosarkomen', 'Osteosarkoms',
  'Pankreatitis', 'Paralyse', 'Paraplegie', 'Paraplegien',
  'Perikarditis', 'Periostitis', 'Phlebothrombose',
  'Plasmozytom', 'Plasmozytome', 'Plasmozytoms',
  'Pleuritis', 'Pneumonie', 'Poliomyelitis', 'Polyarthritis',
  'Polymyositis', 'Polyneuropathie', 'Polyurie', 'Polyzythämie',
  'Prognose', 'Prognosen',
  'Prothese', 'Prothesen',
  'Pyelonephritis', 'Rachitis',
  'Sarkom', 'Sarkome', 'Sarkomen', 'Sarkoms',
  'Sinusitis', 'Skoliose', 'Skoliosen',
  'Splenektomie', 'Splenomegalie', 'Spondylitis', 'Spondylosis',
  'Syndrom', 'Syndrome', 'Syndroms',
  'Synostose', 'Synostosen', 'Synovitis', 'Synchondrose', 'Synchondrosen',
  'Szintigramm', 'Szintigramme', 'Szintigrammen', 'Szintigramms',
  'Szintigraphie',
  'Tendinitis', 'Tendinitis', 'Tendinitis',
  'Tenosynovitis', 'Tetraplegie', 'Thrombose', 'Thrombosen',
  'Thrombozytopenie', 'Tonsillitis', 'Tuberkulose',
  'Urethritis', 'Uveitis', 'Vaskulitis', 'Vaskulopathie',
  'Zervixkarzinom',
]);

// Truncated/fragmented words - REMOVE
const TRUNCATED_PATTERNS = [
  /[a-zäöüß]{1,2}$/, // ends with 1-2 lowercase letters (truncation)
  /[A-ZÄÖÜ][a-zäöüß]+-[A-ZÄÖÜ][a-zäöüß]{1,3}$/, // hyphenated fragment like "Chondromyxoidfi"
  /[A-ZÄÖÜ][a-zäöüß]{1,3}$/, // Short capitalized fragment like "Akromioklavi"
  /-$/, // ends with hyphen
  /^-/, // starts with hyphen
  /äq/, // OCR artifacts like "Ödemäqivalent"
  /aquivalent$/i, // "Ödemäquivalent" should be removed if it's a specific term, but we keep only the standard form
];

// English words - REMOVE
const ENGLISH_PATTERNS = [
  /^Asymptomatic$/, /^Anatomical$/, /^Anatomicoradiological$/, /^Bantam/,
  /^Bleomycin$/, /^Bortezomib$/, /^Computed$/, /^Computer/, /^Combination$/,
  /^Combined$/, /^Comparative$/, /^Comparison$/, /^Compendia$/,
  /^Complication/, /^Community$/, /^Carcinomatous$/, /^Granulomatous$/,
  /^Hematogenous$/, /^Hemangioma/, /^Histiocytosis$/, /^Healing/,
  /^High-grade$/, /^High-turnover$/, /^Heberden/, /^Invertebrate$/,
  /^Laminectomy$/, /^Low-grade$/, /^Low-dose/, /^Low-turnover$/,
  /^Maffucci/, /^Mafucci/, /^Mafucci/, /^Mukopolysaccharid/,
  /^Nomenclature/, /^Nomikos/, /^Opp/,
  /^Outcome$/, /^Pseudomalignant$/, /^Phakoma/, /^Plasmacytoma$/,
  /^Salmon/, /^Sandwich/, /^Sarcoma/, /^Sarcomatous$/,
  /^Symptomatic$/, /^Shimomura$/, /^Some$/, /^Somers$/,
  /^Solomon/, /^Solomons$/, /^Stomper$/, /^Sunburst$/,
  /^Synopsis$/, /^Tarsome/, /^Trunnionosis$/,
  /^Thoracic-inlet$/, /^Teratom/, /^Tumour$/,
  // English placeholders
  /^Angiogramm/, /^Computed/, /^Computer/, /^Combined/,
  // English compound words
  /^Bone-bruise/, /^Dose-response$/, /^Double-density/,
  /^Lucent-rim/, /^Healing-flare/, /^Narrow-spine/,
  /^Pseudo/, /^Sicca/, /^Spondyl/,
  // Single English letters or partial English
  /^[A-Z][a-z]+(atous|ation|ation|ing|ory|ment|ess)$/,
];

// Common German non-medical words that leaked through
const COMMON_GERMAN = new Set([
  'Domäne', 'Domänen', 'Dominanz', 'Dominierende', 'Dominiertes',
  'Dominiert', 'Domino', 'Dooms', 'Bekommen', 'Besteht', 'Bildet', 'Bilden',
  'Bisher', 'Bislang', 'Bisherige', 'Bleibt', 'Blieb', 'Blick', 'Blieb',
  'Einkommen', 'Hinzukommen', 'Kombi', 'Kombination', 'Kombinationen',
  'Kommareddi', 'Kommen', 'Kommt', 'Kommunikation', 'Kompakt', 'Kompakta',
  'Komplett', 'Komplex', 'Komplexe', 'Komplexen', 'Komplexität',
  'Komplikation', 'Komplikationen', 'Komponente', 'Komponenten',
  'Kompression', 'Kompressionen', 'Kompromiss', 'Konkret', 'Konsequent',
  'Konsequent', 'Konservativ', 'Kontinuierlich', 'Kontrolliert', 'Kontrovers',
  'Kommt', 'Kompensation', 'Konkret', 'Konsequenz', 'Konstellation',
  'Konstellationen', 'Konsens', 'Konsultation', 'Konsultationen',
  'Kontext', 'Kontinuierlich', 'Kontrovers', 'Kontrovers',
  'Konzentration', 'Konzept', 'Konzepte', 'Konzeption', 'Konzepts',
  'Konzentrieren', 'Kooperation', 'Kopf', 'Kopfkern',
  'Kopfschmerzen', 'Korrekt', 'Korrekte', 'Korrektur', 'Korrekturen',
  'Korrelation', 'Korrelationen', 'Kortikalis', 'Kortikoid',
  'Kosten', 'Kostet', 'Kraft', 'Kräfte', 'Kräftemomente', 'Krank',
  'Krankenversicherung', 'Kreativität', 'Kreis', 'Kreise', 'Kreislauf',
  'Kreisen', 'Kreuzen', 'Kreuz', 'Kreuzbeinhöhle', 'Kreuzschmerz',
  'Kreuzschmerzen', 'Krieg', 'Krise', 'Krisen', 'Kritisch', 'Kritische',
  'Kritischer', 'Kritisches', 'Kubikmillimeter', 'Kubikzentimeter',
  'Kugel', 'Kugeln', 'Kuhmilch', 'Kultivieren', 'Kultivierung',
  'Kumulativ', 'Kumulierte', 'Kunde', 'Kunden', 'Kunst', 'Kunststoff',
  'Kupfer', 'Kuppel', 'Kurs', 'Kurse', 'Kurvendiskussion', 'Kurzer',
  'Kurzes', 'Kurzhinweis', 'Kurve', 'Kurven', 'Kurzerhand', 'Kuss',
  'Kybernetik', 'Label', 'Labor', 'Labordiagnostik', 'Laborparameter',
  'Laborwerte', 'Lachen', 'Lacht', 'Lachter', 'Lachterhan',
  'Ladehemmung', 'Laden', 'Lage', 'Lagen', 'Lager', 'Lagern', 'Lagerung',
  'Lagerungen', 'Lahm', 'Lahmen', 'Lähmen', 'Lähmend', 'Lähmende',
  'Lähmender', 'Lähmendes', 'Lähmung', 'Lähmungen', 'Laie', 'Laien',
  'Lakonie', 'Lakonisch', 'Lakritzensaft', 'Lakunär', 'Lallen', 'Lallend',
  'Lambda', 'Lambert', 'Lamm', 'Lämmer', 'Lampe', 'Lampen', 'Land',
  'Länder', 'Landes', 'Landung', 'Landungen', 'Lang', 'Lange', 'Länger',
  'Langsam', 'Langsame', 'Langsamer', 'Langsames', 'Länglich', 'Längliche',
  'Längliches', 'Längs', 'Längsachse', 'Längsachsen', 'Längsausdehnung',
  'Längsdarstellung', 'Längsdarstellungen', 'Längsrichtung', 'Längs',
  'Längsschnitt', 'Längsschnitte', 'Längsschnittdarstellung',
  'Längsschnittdarstellungen', 'Längsseite', 'Längsseiten', 'Längswelle',
  'Langzeit', 'Langzeit-', 'Langzeitbehandlung', 'Langzeitbeobachtung',
  'Langzeitbeobachtungen', 'Langzeitdialyse', 'Langzeiterfolg', 'Langzeitergebnisse',
  'Langzeitfolgen', 'Langzeithämodialyse', 'Langzeitkomplikation', 'Langzeitkomplikationen',
  'Langzeitnebenwirkung', 'Langzeitnebenwirkungen', 'Langzeitoutcome', 'Langzeitprognose',
  'Langzeitresultate', 'Langzeitstudie', 'Langzeitstudien', 'Langzeittherapie',
  'Langzeitverlauf', 'Langzeitverläufe', 'Langzeitwirkung', 'Langzeitwirkungen',
  'Laparoskopie', 'Lappen', 'Lappens', 'Lappentransplantat', 'Lappentransplantate',
  'Lärm', 'Lärmt', 'Lasche', 'Laschen', 'Laser', 'Lasergerät', 'Lassen',
  'Lässt', 'Last', 'Lasten', 'Lastschrift', 'Latein', 'Lateinamerika',
  'Lateinisch', 'Lateinische', 'Laterale', 'Lateral', 'Lattenrost',
  'Lau', 'Laub', 'Laube', 'Lauben', 'Lauer', 'Lauern', 'Lauernd', 'Lauf',
  'Laufe', 'Laufen', 'Laufend', 'Laufende', 'Laufender', 'Laufendes',
  'Läufer', 'Laufs', 'Laufwerk', 'Lauge', 'Laugen', 'Laune', 'Launen',
  'Launisch', 'Launische', 'Laurence', 'Laut', 'Laute', 'Lauten', 'Lauter',
  'Lautet', 'Lautsprecher', 'Lautsprechern', 'Lauwarm', 'Lava', 'Lavieren',
  'Lawine', 'Lawinen', 'Lax', 'Laxe', 'Laxieren', 'Laxierend', 'Layout',
  'Lazarett', 'Lazarette', 'Lazaretten', 'Le', 'Lebe', 'Leben', 'Lebend',
  'Lebende', 'Lebender', 'Lebendes', 'Lebens', 'Lebensalter', 'Lebensaufgabe',
  'Lebensbaum', 'Lebensbedingung', 'Lebensbedingungen', 'Lebensdauer',
  'Lebensdauer', 'Lebenserfahrung', 'Lebenserfahrungen', 'Lebenserwartung',
  'Lebensgefahr', 'Lebensgefahr', 'Lebensgefährlich', 'Lebensgefährliche',
  'Lebensgefährlicher', 'Lebensgefährliches', 'Lebensgeister', 'Lebensgroß',
  'Lebensgröße', 'Lebenshaltung', 'Lebensinhalt', 'Lebensinhalte', 'Lebensjahr',
  'Lebensjahre', 'Lebensjahren', 'Lebenslage', 'Lebenslang', 'Lebenslange',
  'Lebenslanger', 'Lebenslauf', 'Lebensläufe', 'Lebensmittel', 'Lebensmitteln',
  'Lebensmittels', 'Lebensmittelvergiftung', 'Lebensmittelvergiftungen',
  'Lebensnerv', 'Lebensnerven', 'Lebensphase', 'Lebensphasen', 'Lebensqualität',
  'Lebensraum', 'Lebensraumes', 'Lebensraums', 'Lebensrechte', 'Lebensrettend',
  'Lebensrettende', 'Lebensrettender', 'Lebensrettendes', 'Lebensstandard',
  'Lebensstandards', 'Lebensstil', 'Lebensstils', 'Lebensstunde', 'Lebensstunden',
  'Lebensunterhalt', 'Lebensweg', 'Lebensweise', 'Lebenszeichen', 'Leberfleck',
  'Leberflecken', 'Leberflecks', 'Leberkäse', 'Leberkäs', 'Leberknödel',
  'Leberkraut', 'Leberpastete', 'Leberschaden', 'Leberschadens', 'Leberschäden',
  'Lebers', 'Lebertran', 'Leberwerte', 'Lebewesen', 'Lebewesens', 'Lebhaft',
  'Lebhafte', 'Lebhafter', 'Lebhaftes', 'Lebkuchen', 'Lech', 'Lechzen',
  'Lechzend', 'Lechzende', 'Lechzender', 'Lechzendes', 'Leckt', 'Lecken',
  'Leckere', 'Leckereien', 'Leckerer', 'Leckeres', 'Leckerli', 'Lecks',
  'Leckstein', 'Lecksteine', 'Leckte', 'Leckten', 'Leder', 'Ledern', 'Leders',
  'Ledig', 'Lediglich', 'Leer', 'Leere', 'Leeren', 'Leerer', 'Leeres',
  'Legasthenie', 'Legende', 'Legenden', 'Legierung', 'Legierungen',
  'Legitim', 'Legitime', 'Legitimer', 'Legitimes', 'Legitimität', 'Leh',
  'Lehm', 'Lehms', 'Lehne', 'Lehnen', 'Lehnt', 'Lehnte', 'Lehr', 'Lehre',
  'Lehren', 'Lehrend', 'Lehrgang', 'Lehrgänge', 'Lehrgangs', 'Lehrjahre',
  'Lehrling', 'Lehrlinge', 'Lehrlings', 'Lehrplan', 'Lehrpläne', 'Lehrreich',
  'Lehrreiche', 'Lehrreicher', 'Lehrreiches', 'Lehrstelle', 'Lehrstellen',
  'Leib', 'Leibes', 'Leiblich', 'Leibliche', 'Leiblicher', 'Leibliches',
  'Leibrente', 'Leibrenten', 'Leibung', 'Leibungen', 'Leicht', 'Leichte',
  'Leichten', 'Leichter', 'Leichtes', 'Leichtgläubig', 'Leichtgläubige',
  'Leichtgläubiger', 'Leichtgläubiges', 'Leichtigkeit', 'Leichtigkeiten',
  'Leichtlebig', 'Leichtlebige', 'Leichtsinn', 'Leichtsinnig', 'Leichtsinnige',
  'Leichtsinniger', 'Leichtsinniges', 'Leid', 'Leide', 'Leiden', 'Leidend',
  'Leidende', 'Leidender', 'Leidendes', 'Leider', 'Leides', 'Leidenschaft',
  'Leidenschaften', 'Leidenschaftlich', 'Leidenschaftliche', 'Leidens',
  'Leidensdruck', 'Leidensdrucks', 'Leidensgefährte', 'Leidensgefährten',
  'Leidensweg', 'Leidenswege', 'Leider', 'Leids', 'Leier', 'Leierkasten',
  'Leih', 'Leihe', 'Leihen', 'Leihgabe', 'Leihgaben', 'Leiht', 'Leihweise',
  'Leim', 'Leime', 'Leimen', 'Leimt', 'Lein', 'Leine', 'Leinen', 'Leinens',
  'Leinöl', 'Leinsamen', 'Leinwand', 'Leinwände', 'Leinwänden', 'Leinwands',
  'Leise', 'Leisen', 'Leiser', 'Leises', 'Leiste', 'Leisten', 'Leistens',
  'Leistung', 'Leistungen', 'Leistungsfähig', 'Leistungsfähige', 'Leistungsfähiger',
  'Leistungsfähiges', 'Leistungsfähigkeit', 'Leistungsstark', 'Leistungsstarke',
  'Leistungsstärker', 'Leistungsstärkeres', 'Leistungsstarkes', 'Leistungsstörung',
  'Leistungsstörungen', 'Leistungsverweigerung', 'Leit', 'Leitartikel',
  'Leitartikeln', 'Leitartikels', 'Leitbild', 'Leitbildes', 'Leitbilds',
  'Leite', 'Leiten', 'Leitend', 'Leitende', 'Leitender', 'Leitendes', 'Leiter',
  'Leitern', 'Leiters', 'Leitfaden', 'Leitfadens', 'Leitidee', 'Leitlinien',
  'Leitmotiv', 'Leitmotive', 'Leitmotivs', 'Leitplanke', 'Leitplanken', 'Leitprinzip',
  'Leitprinzipien', 'Leitprinzips', 'Leitpunkt', 'Leitstern', 'Leitsterne',
  'Leitsterns', 'Leitsystem', 'Leitsysteme', 'Leitsystems', 'Leitung', 'Leitungen',
  'Leitungsbahnen', 'Leitungsstrang', 'Leitungsstranges', 'Leitungsstrangs',
  'Leitungswasser', 'Leitungswassers', 'Leitwährung', 'Leitwährungen', 'Lektion',
  'Lektionen', 'Lektors', 'Lektüre', 'Lemming', 'Lemminge', 'Lemmings',
  'Lemon', 'Lende', 'Lenden', 'Lendenbereich', 'Lendenwirbel', 'Lendenwirbelbereich',
  'Lenken', 'Lenkend', 'Lenkrad', 'Lenkrads', 'Lenksäule', 'Lenkt', 'Lenkung',
  'Lenkungen', 'Lenkungsdämpfer', 'Lenz', 'Leopard', 'Leoparden', 'Leopardenfell',
  'Lern', 'Lernbereit', 'Lernbereite', 'Lernbereiter', 'Lernbereites', 'Lernen',
  'Lernend', 'Lernende', 'Lernender', 'Lernendes', 'Lernens', 'Lerner', 'Lernerfolg',
  'Lernerfolgs', 'Lernfähig', 'Lernfähige', 'Lernfähiger', 'Lernfähiges', 'Lernfreudig',
  'Lerninhalt', 'Lerninhalte', 'Lernmaterial', 'Lernmaterialien', 'Lernmittelfrei',
  'Lernmittelfreie', 'Lernmittelfreier', 'Lernmittelfreies', 'Lernprozess',
  'Lernprozesse', 'Lernprozesses', 'Lernschritt', 'Lernschritte', 'Lernschritten',
  'Lernschwäche', 'Lernschwächen', 'Lernsoftware', 'Lernspaß', 'Lernspiel',
  'Lernspiele', 'Lernspiels', 'Lernstoff', 'Lernstoffs', 'Lernstunde', 'Lernstunden',
  'Lernumgebung', 'Lernumgebungen', 'Lernverhalten', 'Lernverhaltens', 'Lernwillig',
  'Lernwillige', 'Lernwilliger', 'Lernwilliges', 'Lernzeit', 'Lernzeiten', 'Lernziel',
  'Lernziele', 'Lernziels', 'Lese', 'Leseart', 'Lesearten', 'Lesebuch', 'Lesebuches',
  'Lesebuchs', 'Lesegeschwindigkeit', 'Lesen', 'Lesens', 'Lesenswert', 'Lesenswerte',
  'Lesenswertes', 'Leseprobe', 'Leseproben', 'Leser', 'Leserart', 'Leseratte',
  'Leseratten', 'Leserbrief', 'Leserbriefe', 'Leserbriefen', 'Leserbriefs', 'Lesern',
  'Lesers', 'Leserschaft', 'Leserschaften', 'Leserstamm', 'Leserstamms', 'Leserstimme',
  'Leserstimmen', 'Lesezeichen', 'Lesezeichens', 'Liest', 'Liestet', 'Liesl', 'Liete',
  'Liefer', 'Lieferant', 'Lieferanten', 'Lieferung', 'Lieferungen', 'Liegt', 'Lieh',
  'Liehen', 'Ließ', 'Ließe', 'Ließen', 'Liest', 'Lift', 'Lifte', 'Liften', 'Lifts',
  'Liga', 'Ligurien', 'Liguriens', 'Liguster', 'Ligusters', 'Likör', 'Liköre',
  'Likören', 'Likörs', 'Lila', 'Lilac', 'Lilie', 'Lilien', 'Liliengewächs',
  'Liliengewächse', 'Liliengewächsen', 'Lilienthal', 'Limes', 'Limit', 'Limite',
  'Limitiert', 'Limitierte', 'Limitierter', 'Limitiertes', 'Limits', 'Limo',
  'Limousine', 'Limousinen', 'Limo', 'Limos', 'Limone', 'Limonen', 'Limousin',
  'Limousine', 'Limousinen', 'Linde', 'Linden', 'Lindens', 'Linderung', 'Lindwurm',
  'Lineal', 'Lineale', 'Lineals', 'Linear', 'Lineare', 'Linearer', 'Lineares',
  'Linguistik', 'Linguistisch', 'Linguistische', 'Linie', 'Linien', 'Liniendienste',
  'Liniennetz', 'Liniendienste', 'Liniennetze', 'Linienschifffahrt', 'Linienschiff',
  'Linienschiffe', 'Linienschiffen', 'Linienschiffs', 'Link', 'Links', 'Linke',
  'Linkem', 'Linken', 'Linker', 'Links', 'Linksabbieger', 'Linksanschlag',
  'Linksanschlags', 'Linksaußen', 'Linksaußens', 'Linksbündig', 'Linksbündige',
  'Linksbündiger', 'Linksbündiges', 'Linksdrall', 'Linksdralls', 'Linksdrehend',
  'Linksdrehende', 'Linksdrehender', 'Linksdrehendes', 'Linksdrehung', 'Linksdrehungen',
  'Linksfäule', 'Linksfäulen', 'Linksgerichtet', 'Linksgerichtete', 'Linksgerichteter',
  'Linksgerichtetes', 'Linksgewinde', 'Linkshänder', 'Linkshänderin', 'Linkshänderinnen',
  'Linkshändern', 'Linkshänders', 'Linksherum', 'Linkskurve', 'Linkskurven', 'Linkslauf',
  'Linkslaufs', 'Linksorientiert', 'Linksorientierte', 'Linksorientierter',
  'Linksorientiertes', 'Linkspartei', 'Linksparteien', 'Linksradikal', 'Linksradikale',
  'Linksradikaler', 'Linksradikales', 'Linksrum', 'Linksrutsch', 'Linksrutsches',
  'Linkssein', 'Linksseins', 'Linksseitig', 'Linksseitige', 'Linksseitiger',
  'Linksseitiges', 'Linksstehend', 'Linksstehende', 'Linksstehender', 'Linksstehendes',
  'Linksverkehr', 'Linksverkehrs', 'Linnen', 'Lins', 'Linse', 'Linsen', 'Linsenartig',
  'Linsenartige', 'Linsenartiger', 'Linsenartiges', 'Linsenförmig', 'Linsenförmige',
  'Linsenförmiger', 'Linsenförmiges', 'Linsenfrei', 'Linsenfreie', 'Linsenfreier',
  'Linsenfreies', 'Linsengroß', 'Linsengroße', 'Linsengroßer', 'Linsengroßes',
  'Linsengruppe', 'Linsengruppen', 'Linsenkanone', 'Linsenkanonen', 'Linsenkeim',
  'Linsenkeime', 'Linsenkeimen', 'Linsenkeims', 'Linsenlos', 'Linsenlose', 'Linsenloser',
  'Linsenloses', 'Linsenmikroskop', 'Linsenmikroskope', 'Linsenmikroskopen',
  'Linsenmikroskops', 'Linsenmuster', 'Linsenmusterung', 'Linsenmusterungen',
  'Linsennudel', 'Linsennudeln', 'Linsensuppe', 'Linsensuppen', 'Linsentrübung',
  'Linsentrübungen', 'Linsenvorfall', 'Linsenvorfälle', 'Linsenvorfalls', 'Linssen',
  'Linus', 'Linz', 'Lippe', 'Lippen', 'Lippenbekenntnis', 'Lippenbekenntnisse',
  'Lippenbekenntnissen', 'Lippenbekenntnisses', 'Lippenbläschen', 'Lippenblut',
  'Lippenblutes', 'Lippenblutung', 'Lippenblutungen', 'Lippenbrand', 'Lippenbrände',
  'Lippenbränden', 'Lippenbrands', 'Lippenfülle', 'Lippenfüllen', 'Lippenherpes',
  'Lippenherpes', 'Lippenin', 'Lippenpflege', 'Lippenpflegen', 'Lippenpomade',
  'Lippenpomaden', 'Lippenrot', 'Lippenrots', 'Lippens', 'Lippig', 'Lippige',
  'Lippiger', 'Lippiges', 'Lips', 'Lira', 'Liras', 'Lisa', 'Lisbeth', 'Lise', 'Lisene',
  'Lisenen', 'Lisennes', 'Lisi', 'Lissabon', 'Lissabons', 'Lissabonner', 'Lissabonnern',
  'Lissabonners', 'Lissabonnerin', 'Lissabonnerinnen', 'List', 'Liste', 'Listen',
  'Listenmäßig', 'Listenmäßige', 'Listenmäßiger', 'Listenmäßiges', 'Listenreich',
  'Listenreiche', 'Listenreicher', 'Listenreiches', 'Listens', 'Listenstreichung',
  'Listenstreichungen', 'Listig', 'Listige', 'Listiger', 'Listiges', 'Lists', 'Lita',
  'Litan', 'Litanei', 'Litaneien', 'Litauen', 'Litaue', 'Litauer', 'Litauerin',
  'Litauerinnen', 'Litauern', 'Litauers', 'Litauisch', 'Litauische', 'Litauischem',
  'Litauischen', 'Litauischer', 'Litauisches', 'Literal', 'Literale', 'Literaler',
  'Literales', 'Literarisch', 'Literarische', 'Literarischem', 'Literarischen',
  'Literarischer', 'Literarisches', 'Literatur', 'Literatura', 'Literatura',
  'Literaturangabe', 'Literaturangaben', 'Literaturauswahl', 'Literaturauswahlen',
  'Literaturhinweis', 'Literaturhinweise', 'Literaturhinweisen', 'Literaturhinweises',
  'Literaturliebhaber', 'Literaturnachweis', 'Literaturnachweise', 'Literaturnachweisen',
  'Literaturnachweises', 'Literaturpreis', 'Literaturpreise', 'Literaturpreisen',
  'Literaturpreises', 'Literaturprofessor', 'Literaturs', 'Literatursprache',
  'Literatursprachen', 'Literaturszene', 'Literaturszenen', 'Literaturverfilmung',
  'Literaturverfilmungen', 'Literaturverzeichnis', 'Literaturverzeichnisses',
  'Literaturwert', 'Literaturwerte', 'Literaturwerten', 'Literaturwertes',
  'Literaturwissenschaft', 'Literaturwissenschaften', 'Literaturwissenschaftler',
  'Literaturwissenschaftlern', 'Literaturwissenschaftlers', 'Litfasssäule',
  'Litfasssäulen', 'Lithium', 'Lithiumbatterie', 'Lithiumbatterien', 'Lithograph',
  'Lithographen', 'Lithographie', 'Lithographien', 'Lithographisch', 'Lithographische',
  'Lithographischem', 'Lithographischen', 'Lithographischer', 'Lithographisches',
  'Lithos', 'Lits', 'Litt', 'Littauer', 'Littauern', 'Littauers', 'Litten', 'Little',
  'Liturgie', 'Liturgien', 'Liturgisch', 'Liturgische', 'Liturgischem', 'Liturgischen',
  'Liturgischer', 'Liturgisches', 'Litze', 'Litzen', 'Liu', 'Liv', 'Livable',
  'Live', 'Liverpool', 'Lives', 'Livia', 'Living', 'Livre', 'Livres', 'Liza', 'Lizenz',
  'Lizenzen', 'Lizenzfrei', 'Lizenzfreie', 'Lizenzfreiem', 'Lizenzfreien', 'Lizenzfreier',
  'Lizenzfreies', 'Lizenzgeber', 'Lizenzgebern', 'Lizenzgebers', 'Lizenzhinweis',
  'Lkw', 'Lkw-', 'Llen', 'Lloret', 'Lloret', 'Lloret', 'Lloret', 'Lloret', 'Lloret',
  'Lloret', 'Lloret', 'Lloret', 'Lloret', 'Lloret', 'Lloret', 'Lloret', 'Lloret',
]);

// Personal names that aren't medical eponyms
const PERSONAL_NAMES = new Set([
  'Alomari', 'Bomalaski', 'Bombardier', 'Beck', 'Berg', 'Bloom', 'Blom',
  'Colombi', 'Comenzo', 'Frommer', 'Gompels', 'Golomb', 'Grammatopoulos',
  'Grissom', 'Holmstrom', 'Homas', 'Homme', 'Homra', 'Honda', 'Joseph',
  'Kindblom', 'Klose', 'Kommareddi', 'Lacombe', 'Ledderhose', 'Llombart-Bosch',
  'Lomasney', 'Loose', 'Marom', 'Momeni', 'Montgomery', 'Mosekilde', 'Moser',
  'Motomura', 'Netherton', 'Nomikos', 'Ogose', 'Omar', 'Omarini', 'Omer', 'Omid',
  'Roma', 'Romanus', 'Romero', 'Rose', 'Rosen', 'Rosenbaum', 'Rosenberg', 'Rosenburg',
  'Salomon', 'Salomonowitz', 'Salomom', 'Satomi', 'Shimomura', 'Shulman', 'Solomon',
  'Solomons', 'Somers', 'Somet', 'Stomper', 'Thomas', 'Thommesen', 'Thompson',
  'Thomsen', 'Thomson', 'Tomin', 'Trompeter', 'Tomin', 'Salomom',
  // English-sounding names
  'Maffucci', 'Mafucci', 'Schulman', 'Cune', 'Cooley', 'Coombs', 'Burnett',
  'Ehlers', 'Danlos', 'Lesch', 'Nyhan', 'Muckle', 'Wells', 'Weber', 'Parkes',
  'Parks', 'Parry', 'Romberg', 'Parsonage', 'Turner', 'Peutz', 'Jeghers',
  'Han', 'Schüller', 'Christian', 'Denosumab', 'Echelon', 'Gossipiboma', 'Gossypiboma',
  'Felty', 'Still', 'Langerhans', 'Bennett', 'Gaucher', 'Gaucher-Zellen',
  // Common German surnames that aren't eponyms
  'Huber', 'Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner',
  'Becker', 'Schulz', 'Hoffmann', 'Schäfer', 'Koch', 'Klein', 'Wolf', 'Schröder',
  'Neumann', 'Schwarz', 'Zimmermann', 'Braun', 'Krüger', 'Hofmann', 'Hartmann',
  'Lange', 'Werner', 'Schmitt', 'Krause', 'Meier', 'Brückner', 'Becherer',
  'Döbeln', 'Dresden', 'Düsseldorf', 'Halle', 'Imola', 'Kaiserswerther',
  // Names that are actually part of eponyms but are too short
  'Köhler', 'Perthes', 'Preiser', 'Kienböck', 'Pyle', 'Pyle-Dysplasie',
  // Names of authors and researchers
  'Crom', 'Doseretz', 'Durie', 'Hinweis', 'Jaroma', 'Köhler', 'Lenz',
  'Larsen', 'Johansson', 'Licht', 'Mafucci', 'Maffucci', 'Maffucci', 'Schirmer',
  'Seldinger', 'Chassaignac', 'Chassard', 'Chassard-Lapine', 'Coxsackie',
  'Lyme', 'Reiter', 'Sudeck', 'Sharp', 'Sicca', 'Sjogren', 'Sjögren',
  'Sturge', 'Weber', 'Trevor', 'Trevor-Syndrom', 'Weissenbach', 'Wiberg',
]);

// Inflection patterns - REMOVE
const COMMON_INFLECTION_SUFFIXES = [
  /^.*en$/,  // German plural/infinitive
  /^.*e$/,   // often singular/adjective ending (skip - not always removable)
  /^.*s$/,   // Genitiv singular
  /^.*em$/,  // Dativ
  /^.*er$/,  // weak masculine or comparative
  /^.*chen$/,
  /^.*lein$/,
  /^.*innen$/,
  /^.*mens$/,
  /^.*land$/,
];

function isInflectedForm(w) {
  // Common German plural/inflexion patterns to skip
  // If the base form is also in the list, this is likely a plural
  // We do post-processing to remove these
  return false;
}

// Heuristic: is this likely an English word?
function isEnglish(w) {
  // English-specific patterns
  if (/^(anatomical|anatomicoradiological|asymptomatic|asymptomatic|combined|combination|community|comparative|comparison|compendia|complication|complications|computed|computer|cumulative|diagnostic|diagnostic|healing|healing-flare|high-grade|low-grade|low-turnover|lymphoma|lymphomas|narrow-spine|nomenclature|outcome|pseudomalignant|sarco|sarcomatous|spinal|stenosis|tear|tears|tearing|tendon|then|those|though|three|through|thymus|thus|to|today|together|too|took|tooth|top|torn|total|touch|trace|traces|track|tracking|tracks|trade|trademark|trademarks|tradition|traditional|traditions|train|trained|trainer|trainers|training|trajectory|trans|trance|trank|trank|trankription|trank|tranks|trans|trans$|trans$|trans$)/i.test(w)) return true;
  // Words ending in typical English suffixes
  if (/(ation|ation|ative|atical|ations|ating|mental|ously|ment|tic|tical|ment|able|ment|ence|ance|ment|ous|ic|ical|ation|ation|ation|ations|ation|ation|ations|ation|ation|ations)/i.test(w) && /[a-z]{3,}ing$/i.test(w)) return true;
  if (/(ology|ology|ologies|ologically|ologic|ological)$/i.test(w) && !/^Radiolog/.test(w)) return true;
  if (/(tion|tion|tions|al|al|als|ally)$/i.test(w) && /[a-z]{4,}tion$/i.test(w)) {
    if (!/(Knochen|Diagnose|Therapie|Patient|Diagnostik|Prognose)/i.test(w)) return true;
  }
  return false;
}

// Heuristic: is this likely a German word fragment or OCR artifact?
function isFragment(w) {
  if (w.length < 4) return true;
  // Ends with single letter: "Kombina", "Kombi", "Dekompressionstrau"
  if (/[A-Za-z]$/.test(w) && /[a-zäöüß]{1,3}$/.test(w)) {
    // Check if it ends with a known truncated pattern
    if (/^(Kombina|Comput|Computertomo|Inho|Dekompressions?|Akromiokla|Akromioklavi|Phäno|Phaeno|Chondro|Chondromyxo|Chondromyxoidfi|Inho|Insuff|Insu|Insuffizienz|Komb|Kompa|Kompar|Kompart|Komplik|Kompo|Kompr|Phaenome|Phaenomeno|Spondylo)/i.test(w)) return true;
  }
  // Words ending in unusual letter combinations
  if (/[äöü][a-zäöüß]{1,2}$/.test(w) && w.length < 10) return true;
  // Contains a digit
  if (/\d/.test(w)) return true;
  // English-looking words
  if (/^[A-Z][a-z]*[a-z]ed$/.test(w)) return true;
  if (/^[A-Z][a-z]+tion$/.test(w) && !/Kompression|Knochen|Diagnostik|Sektion|Injektion|Prozedur/i.test(w)) return true;
  if (/^[A-Z][a-z]+al$/.test(w) && !/Phänomen|General|Viszeral|Distal|Proximal|Lateral|Medial/i.test(w)) return true;
  return false;
}

let filtered = [];

for (const w of lines) {
  // Skip empty
  if (!w || w.length < 4) continue;
  // Skip if in explicit too common list
  if (TOO_COMMON.has(w)) continue;
  // Skip if in common German non-medical
  if (COMMON_GERMAN.has(w)) continue;
  // Skip if in personal names
  if (PERSONAL_NAMES.has(w)) continue;
  // Skip if matches English patterns
  if (ENGLISH_PATTERNS.some(p => p.test(w))) continue;
  // Skip if fragment
  if (isFragment(w)) continue;
  // Skip if English-looking
  if (isEnglish(w)) continue;
  // Skip if contains umlaut+2-3 letters ending (likely OCR fragment)
  if (/äqui/.test(w) || /aquivalent/.test(w)) {
    // keep only the standardized form, skip variants
    if (w !== 'Ödemäquivalent' && w !== 'Knochenmarködemäquivalent') continue;
  }
  filtered.push(w);
}

// Second pass: remove inflections/plurals where the singular is also present
const set = new Set(filtered);
const cleaned = [];
for (const w of filtered) {
  // Check if removing common inflection gives a word that's in the set
  let baseWord = null;
  if (w.endsWith('en') && w.length > 4) {
    baseWord = w.slice(0, -2);
  } else if (w.endsWith('e') && w.length > 4) {
    baseWord = w.slice(0, -1);
  } else if (w.endsWith('s') && w.length > 4) {
    baseWord = w.slice(0, -1);
  } else if (w.endsWith('em') && w.length > 4) {
    baseWord = w.slice(0, -2);
  } else if (w.endsWith('er') && w.length > 4) {
    baseWord = w.slice(0, -2);
  } else if (w.endsWith('chen') && w.length > 6) {
    baseWord = w.slice(0, -5);
  }
  // If we found a base word that's in the set, and this word is just a plural, skip it
  if (baseWord && set.has(baseWord) && baseWord.length >= 4) {
    continue;
  }
  cleaned.push(w);
}

cleaned.sort((a, b) => a.localeCompare(b, 'de'));
fs.writeFileSync(OUTPUT_PATH, cleaned.join('\n') + '\n');
console.log(`Done: ${cleaned.length} terms (was ${lines.length})`);
console.log('Removed as inflections or kept as base forms.');
