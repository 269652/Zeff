/**
 * Hints that a run of capitalised words is a name: a given name in front (people), an organisation word at the end, a
 * place adjective ("Frankfurter Buchmesse") or a particle ("von", "van"). Used to trust a name that only one headline has —
 * without them a single-story run like "Verkehrte Konsolenwelt" or "Write Vivid Stories" would pass for one.
 */
export const FIRST_NAMES = new Set(
  `adam adrian alexander alexandra alice alina amelie anja anke anna annalena anne annette antje anton april barbara bastian ben benjamin bernd bernhard bettina birgit björn boris carl carla carola caroline cem charlotte chris christian christina christine christoph claudia clemens daniel daniela david denis dennis dieter dirk dominik doris eckhard edgar elena elisabeth ella elon emma emmanuel eric erik erika ernst eva fabian felix florian frank franz franziska frederik friedrich fritz gabriele georg gerd gerhard gisela greta günther gustav hanna hannah hannes hans harald heike heiko heinz helen helena helga helmut henri henry herbert holger horst hubert ina ingo inge irene isabel jakob jan jana jann jannik jens jessica joachim joe johann johanna johannes jonas jörg josef joseph judith julia julian jürgen justus karin karl karsten katharina kathrin katja katrin kevin kim klaus konrad kristina kurt lara lars laura lea lena leon leonie lisa lothar louis lucas ludwig luisa lukas lutz manfred manuel marc muse marco marcus margarete maria marie marion mario mark markus marlene martin martina matthias max melanie michael michaela michelle mike mirko moritz nadine natalie nico nicole niklas nils nina norbert olaf oliver oskar otto pascal patrick paul paula peter petra philipp pia rainer ralf ralph rebecca reinhard renate richard robert robin roland rolf ronald rosa rüdiger rudolf ruth sabine sabrina samuel sandra sarah sascha sebastian selma silke simon simone sofia sonja sophia sophie stefan stefanie steffen stephan stephanie susanne sven svenja sylvia tanja thomas thorsten tim punch tina tobias tom torsten udo ulrich ulla ursula uta uwe vanessa vera verena viktor viktoria vincent volker walter werner wilhelm willi wolfgang xaver yannick yvonne zoe
   aaron abdul ahmed alan albert alex ali amy andrew andy angela ann anthony arnold arthur barack ben benedict bernie bill bob brad brian bruce carlos catherine charles chuck clara colin dan daniel dave dean diana donald douglas ed edward elizabeth emily eric ethan frances francis fred gary george gordon grace greg harry helen henry howard ian jack jacob james jane jason jeff jeffrey jennifer jerome jim joan joe john jon jonathan joshua juan karen kate keith ken kenneth kyle larry laurence lee leo liam linda lisa luke malcolm margaret mark mary matt matthew megan mel michelle mohammed naomi nancy neil nick noah olivia oscar pat patricia paul peter philip rachel ralph ray raymond rebecca richard rishi rob robert rodney ron rosa ross roy russell ryan sam samuel sara scott sean sergey shane sharon simon stephen steve steven susan taylor ted terry theresa tim tom tony tyler victor vladimir wayne william xi yuri
   andrés carlos jorge josé juan luis manuel miguel pedro pablo sergio antonio francisco javier ana carmen isabel lucía marta rosa teresa pierre jean jacques françois michel luc marie sophie giorgio giuseppe marco mario luigi giovanni`
    .split(/\s+/)
    .filter(Boolean),
);

/** Last words that make a run an organisation, place or event. */
export const ORG_SUFFIX = new Set(
  `bank ag gmbh se kg inc corp corporation group holding partei fraktion verband institut universität hochschule university college museum theater theatre festival messe ministerium amt bundesamt gericht kammer stiftung verein club klub fc sv sc city united airlines air motors tech labs lab systems software media news times post zeitung allianz union konzern gruppe werke werk bahn netz kommission rat ausschuss parlament regierung akademie schule klinik klinikum krankenhaus flughafen hafen stadion arena cup liga league open prize preis award gipfel konferenz summit treffen`
    .split(/\s+/)
    .filter(Boolean),
);

/** "Frankfurter", "Pariser", "Bayerische": place adjectives that make "<Adjective> <Noun>" a named thing. */
export const placeAdjective = (w: string) =>
  /^[A-ZÄÖÜ][a-zäöüß]{4,10}er$/.test(w) && !/(ischer|licher|ender|ierter|erter|ater|alter|neuer|großer|kleiner|wichtiger|aktueller|weiterer|anderer|letzter|erster|zweiter|dritter|junger|alter|guter|bester|größter)$/i.test(w);

/** Roles and descriptions that stand in front of a name ("Arbeitsministerin Bas", "Aufsteiger Schalke"): not part of it. */
export const ROLE = /(minister|ministerin|präsident|präsidentin|kanzler|kanzlerin|chef|chefin|trainer|trainerin|sprecher|sprecherin|vorsitzende|vorsitzender|beauftragte|beauftragter|abgeordnete|abgeordneter|koordinatorin|koordinator|direktor|direktorin|ikone|aufsteiger|absteiger|nationalspieler|verteidiger|torwart|stürmer|korrespondentin|korrespondent|professor|professorin|doktor|dr|sänger|sängerin|schauspieler|schauspielerin|moderator|moderatorin|experte|expertin|forscher|forscherin|autor|autorin|star|legende|boss|gründer|gründerin|bürgermeister|bürgermeisterin|kandidat|kandidatin|sieger|siegerin|opfer|täter|verdächtiger|angeklagter|zeuge|zeugin)$/i;

const PARTICLES = new Set(["von", "van", "de", "der", "del", "da", "di", "le", "la", "al", "bin", "ibn", "mc", "mac"]);

/** Does this run of words look like a name (not just two capitalised nouns)? */
export function looksLikeName(words: string[]): boolean {
  if (words.length < 2) return false;
  const first = words[0].toLowerCase().split("-")[0];
  const last = words[words.length - 1].toLowerCase();
  if (FIRST_NAMES.has(first)) return true;
  if (ORG_SUFFIX.has(last)) return true;
  if (placeAdjective(words[0])) return true;
  if (words.slice(1, -1).some((w) => PARTICLES.has(w.toLowerCase()))) return true;
  // Two-letter initials in front ("J. R."), an Mc/Mac name.
  return /^[A-Z]\.$/.test(words[0]) || /^(Mc|Mac|O')[A-Z]/.test(words[words.length - 1]);
}
