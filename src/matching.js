/* ==================================================================== *
 *  THE MATCHING ENGINE
 *
 *  Shared by the browser and the server. Designed to stand entirely on its
 *  own with no API key: everything below runs offline, in the browser, in
 *  about a millisecond. If a judge is wired up it is used as a tie-breaker
 *  for genuinely ambiguous pairs, but nothing depends on it.
 *
 *  Whatever it gets wrong, the reveal screen has a button to flip.
 * ==================================================================== */

export const JUDGE_MODEL = "claude-sonnet-4-6";

/* ---------- normalisation ---------- */

const CONTRACTIONS = [
  [/\bcan't\b/g, "can not"],
  [/\bwon't\b/g, "will not"],
  [/\bshan't\b/g, "shall not"],
  [/\bain't\b/g, "is not"],
  [/\bi'm\b/g, "i am"],
  [/\blet's\b/g, "let us"],
  [/\bit's\b/g, "it is"],
  [/\bthat's\b/g, "that is"],
  [/\bhe's\b/g, "he is"],
  [/\bshe's\b/g, "she is"],
  [/\bwhat's\b/g, "what is"],
  [/\bthere's\b/g, "there is"],
  [/\bwho's\b/g, "who is"],
  [/n't\b/g, " not"],
  [/\b(\w+)'re\b/g, "$1 are"],
  [/\b(\w+)'ve\b/g, "$1 have"],
  [/\b(\w+)'ll\b/g, "$1 will"],
  [/\b(\w+)'d\b/g, "$1 would"],
  [/\bgonna\b/g, "going to"],
  [/\bwanna\b/g, "want to"],
  [/\bkinda\b/g, "kind of"],
  [/\bcuz\b/g, "because"],
  [/\bprob\b/g, "probably"],
];

const FILLER_RE =
  /^(i think |i would say |i would guess |i bet |probably |definitely |it would be |it is |that would be |maybe |honestly |obviously |well |just |i guess |guessing |something like |like )+/;

const STOPWORDS = new Set([
  "the", "a", "an", "my", "your", "our", "is", "are", "was", "were", "be",
  "been", "am", "up", "out", "on", "in", "at", "to", "of", "and", "or",
  "that", "this", "it", "when", "always", "never", "would", "will", "do",
  "does", "did", "has", "have", "had", "for", "with", "about", "as", "so",
  "very", "really", "too", "one", "he", "him", "his", "she", "her", "hers",
  "they", "them", "their", "we", "us", "ours", "who", "what", "how", "why",
  "but", "if", "then", "than", "from", "by", "into", "over", "under",
  "after", "before", "still", "also", "even", "only", "most", "both",
  "each", "any", "all", "there", "here", "usually", "probably", "like",
  // Negation words are deliberately NOT dropped here — "not" survives as a
  // token, and "never" is dropped but still trips the negation flag.
]);

/* Common ways of saying the same thing. Applied before stemming. */
const SYNONYMS = {
  film: "movie", flick: "movie", horror: "scary", scared: "scary",
  frightening: "scary", terrifying: "scary",
  child: "kid", daughter: "kid", son: "kid", baby: "kid", toddler: "kid",
  angry: "mad", annoyed: "mad", irritated: "mad", upset: "mad",
  frustrated: "mad", pissed: "mad", grumpy: "mad", cranky: "mad",
  apologize: "sorry", apologise: "sorry", apology: "sorry",
  apologiz: "sorry", apologis: "sorry", sorri: "sorry",
  purchase: "buy", bought: "buy", buying: "buy",
  auto: "car", vehicle: "car", truck: "car",
  couch: "sofa", television: "tv", telly: "tv",
  residence: "house", home: "house", apartment: "house", place: "house",
  spouse: "husband", hubby: "husband", wife: "wife",
  labor: "work", job: "work", working: "work",
  vacation: "trip", travel: "trip", traveling: "trip", travelling: "trip",
  cash: "money", funds: "money", dollars: "money",
  exercise: "gym", workout: "gym", lifting: "gym",
  cooking: "cook", cooked: "cook",
  gaming: "game", games: "game", videogame: "game",
  dnd: "dnd", "d&d": "dnd", dungeons: "dnd",
  phone: "phone", cell: "phone", mobile: "phone",
  tidy: "clean", tidying: "clean", cleaning: "clean",
  quiet: "silent", silence: "silent",
  bedtime: "bed", sleeping: "bed", sleep: "bed",
};

const NEGATION_RE =
  /(\bnot\b|\bnever\b|\bno\b|\bnone\b|\bnothing\b|\bwithout\b|\brarely\b|\bhardly\b|\b(fail|fails|failing|forget|forgets|forgetting|refuse|refuses|neglect|neglects|avoid|avoids)\s+to\b)/;

/* "doesn't hang the towel up" and "leaves the towel out" describe the same
   act from opposite sides. When one side negates a tidying verb and the
   other affirms an abandoning verb, the disagreement is only grammatical. */
const TIDY_VERBS = /\b(hang|hangs|hanging|hung|put|puts|putting|pick|picks|picking|clean|cleans|cleaning|close|closes|closing|shut|shuts|fold|folds|folding|wash|washes|washing|replace|replaces|refill|refills|turn|turns|flush|flushes|tidy|tidies)\b/;
const ABANDON_VERBS = /\b(leave|leaves|leaving|left|drop|drops|dropping|dropped|toss|tosses|throw|throws|dump|dumps|abandon|abandons)\b/;

function expandContractions(s) {
  let out = s.replace(/[‘’ʼ`]/g, "'");
  for (let i = 0; i < CONTRACTIONS.length; i += 1) {
    out = out.replace(CONTRACTIONS[i][0], CONTRACTIONS[i][1]);
  }
  return out;
}

function stemWord(w) {
  if (w.length <= 3) return w;
  if (/(ss|us|is|ous)$/.test(w)) return w;
  if (/ies$/.test(w) && w.length > 4) return w.slice(0, -3) + "i";
  if (/ing$/.test(w) && w.length > 5) return w.slice(0, -3);
  if (/ed$/.test(w) && w.length > 4) return w.slice(0, -2);
  if (/es$/.test(w) && w.length > 4) return w.slice(0, -2);
  if (/s$/.test(w) && w.length > 3) return w.slice(0, -1);
  return w;
}

/**
 * "me" means whoever wrote it, "you" means the other one. Both sides get
 * rewritten to actual names so that Michael writing "me" and Hannah guessing
 * "you" land on the same string.
 */
export function resolvePeople(text, author, other) {
  const a = String(author || "").toLowerCase().trim() || "author";
  const o = String(other || "").toLowerCase().trim() || "other";
  return String(text == null ? "" : text)
    .replace(/\b(i|me|my|mine|myself)\b/gi, a)
    .replace(/\b(you|your|yours|yourself|u)\b/gi, o);
}

/** Lowercase, de-contract, de-filler, de-punctuate, de-stopword, synonym, stem. */
export function normalize(text) {
  let s = String(text == null ? "" : text).toLowerCase().trim();
  s = expandContractions(s);
  s = s.replace(FILLER_RE, "");
  s = s.replace(/&/g, " and ");
  s = s.replace(/[^a-z0-9\s]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(FILLER_RE, "");
  const words = s.split(" ").filter(Boolean);
  const kept = [];
  for (let i = 0; i < words.length; i += 1) {
    let w = words[i];
    if (STOPWORDS.has(w)) continue;
    // Check the synonym table before stemming and again after, so an
    // inflected form ("apologizes" -> "apologiz") still finds its canonical.
    if (Object.prototype.hasOwnProperty.call(SYNONYMS, w)) w = SYNONYMS[w];
    else {
      const stem = stemWord(w);
      w = Object.prototype.hasOwnProperty.call(SYNONYMS, stem) ? SYNONYMS[stem] : w;
    }
    kept.push(stemWord(w));
  }
  return kept.join(" ");
}

export function tokenSet(text) {
  const n = normalize(text);
  return new Set(n ? n.split(" ") : []);
}

export function hasNegation(text) {
  const s = expandContractions(String(text == null ? "" : text).toLowerCase())
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ");
  return NEGATION_RE.test(s);
}

/* Words too common to be evidence on their own. "our wedding day" and "the
   day Kiya was born" share only "day" and are not the same answer. */
const WEAK_TOKENS = new Set([
  "day", "time", "thing", "stuff", "way", "lot", "bit", "kind", "sort",
  "someth", "anyth", "everyth", "noth", "some", "more", "much", "good",
  "bad", "nice", "real", "get", "got", "go", "make", "made", "take",
  "peopl", "peopl", "peo",
]);

/* ---------- similarity ---------- */

/** 2 * |A n B| / (|A| + |B|) */
export function diceCoefficient(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  a.forEach((t) => {
    if (b.has(t)) shared += 1;
  });
  return (2 * shared) / (a.size + b.size);
}

function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[n];
}

/** Typos and morphology the stemmer missed: "apologise"/"apologize". */
function tokensSimilar(x, y) {
  if (x === y) return true;
  const long = Math.max(x.length, y.length);
  if (long < 4) return false;
  if (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x))) return true;
  return editDistance(x, y) <= (long >= 7 ? 2 : 1);
}

/** Dice, but tokens may match approximately. Each token pairs at most once. */
function fuzzyDice(a, b) {
  if (!a.size || !b.size) return 0;
  const left = [...a];
  const right = [...b];
  const taken = new Array(right.length).fill(false);
  let shared = 0;
  for (const x of left) {
    for (let j = 0; j < right.length; j += 1) {
      if (taken[j]) continue;
      if (tokensSimilar(x, right[j])) {
        taken[j] = true;
        shared += 1;
        break;
      }
    }
  }
  return (2 * shared) / (a.size + b.size);
}

/**
 * How much of the SHORTER answer is contained in the longer one — counting
 * only tokens that actually identify something. Sharing "day" is not
 * evidence; sharing "Colorado" is.
 */
function containment(a, b) {
  if (!a.size || !b.size) return 0;
  const small = (a.size <= b.size ? [...a] : [...b]).filter((t) => !WEAK_TOKENS.has(t));
  const big = a.size <= b.size ? b : a;
  if (!small.length) return 0;
  let shared = 0;
  for (const x of small) {
    for (const y of big) {
      if (tokensSimilar(x, y)) {
        shared += 1;
        break;
      }
    }
  }
  return shared / small.length;
}

function bigramSet(s) {
  const out = new Set();
  const t = String(s).replace(/\s+/g, "");
  for (let i = 0; i < t.length - 1; i += 1) out.add(t.slice(i, i + 2));
  return out;
}

/** Robust to word order and to spelling. */
function charDice(a, b) {
  return diceCoefficient(bigramSet(a), bigramSet(b));
}

/**
 * One number for how alike two answers are, 0..1.
 * Takes the strongest signal rather than averaging, because each of these
 * catches a different way of writing the same thing.
 */
/** Which of the two players each side names, if exactly one. */
function namedPerson(text, names) {
  const padded = " " + normalize(text) + " ";
  const hits = [];
  for (const raw of names) {
    const key = normalize(raw);
    if (key && padded.indexOf(" " + key + " ") !== -1) hits.push(key);
  }
  return hits.length === 1 ? hits[0] : null;
}

/** Token set with the uninformative words dropped, unless that empties it. */
function strongTokens(text) {
  const all = tokenSet(text);
  const strong = new Set([...all].filter((t) => !WEAK_TOKENS.has(t)));
  return strong.size ? strong : all;
}

export function similarity(aText, bText) {
  const ta = strongTokens(aText);
  const tb = strongTokens(bText);
  if (!ta.size || !tb.size) return 0;
  const token = diceCoefficient(ta, tb);
  const fuzzy = fuzzyDice(ta, tb);
  const contain = containment(ta, tb);
  // Containment is discounted: "movie" inside "scary movie about a clown"
  // is real evidence, but weaker than the whole answer agreeing.
  return Math.max(token, fuzzy, contain * 0.86);
}

/**
 * Do the two sides agree about negation? Grammatically opposite framings of
 * the same act ("doesn't hang it up" / "leaves it out") count as agreeing.
 */
function negationMode(aText, bText) {
  const na = hasNegation(aText);
  const nb = hasNegation(bText);
  if (na === nb) return "same";
  const a = String(aText).toLowerCase();
  const b = String(bText).toLowerCase();
  const negSide = na ? a : b;
  const posSide = na ? b : a;
  if (TIDY_VERBS.test(negSide) && ABANDON_VERBS.test(posSide)) return "reconciled";
  return "conflict";
}

/** Do the two sides name the same distinctive thing? */
function sharesSubject(aText, bText) {
  const ta = strongTokens(aText);
  const tb = strongTokens(bText);
  for (const x of ta) for (const y of tb) if (tokensSimilar(x, y)) return true;
  return false;
}

/* ---------- numbers ---------- */

const WORD_NUMBERS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100,
  half: 0.5, couple: 2, few: 3, several: 4, dozen: 12,
};

export function parseNumber(text) {
  const t = String(text == null ? "" : text).toLowerCase().replace(/,/g, "");
  const found = t.match(/\d+(?:\.\d+)?/g);
  if (found && found.length) {
    const vals = found.map(Number).filter((n) => isFinite(n));
    if (!vals.length) return null;
    const isRange = /\d+(?:\.\d+)?\s*(?:-|–|—|to|or)\s*\d+(?:\.\d+)?/.test(t);
    if (isRange && vals.length >= 2) return (vals[0] + vals[1]) / 2;
    return vals[0];
  }
  const keys = Object.keys(WORD_NUMBERS);
  for (let i = 0; i < keys.length; i += 1) {
    if (new RegExp("\\b" + keys[i] + "\\b").test(t)) return WORD_NUMBERS[keys[i]];
  }
  return null;
}

function tidyNumber(n) {
  return n === Math.round(n) ? String(n) : String(Math.round(n * 10) / 10);
}

/* ---------- the optional judge ---------- */

export function buildJudgePrompt(questionText, answerName, answerText, guessName, guessText) {
  return [
    "You are the judge in a two-player guessing game. One player wrote a real answer;",
    "the other tried to predict it. Decide whether the two express substantially the same idea.",
    "",
    "Question: " + questionText,
    "",
    answerName + " actually answered: " + answerText,
    guessName + " guessed " + answerName + " would say: " + guessText,
    "",
    "How to judge:",
    "- Be generous about phrasing, wording, tense, length and spelling.",
    "- Be strict about actual meaning.",
    "- Opposite framings of the SAME behaviour are a MATCH.",
    "  Example: \"doesn't hang the towel up\" and \"leaves the towel out\" are a match.",
    "- Different subjects are NOT a match.",
    "  Example: \"the towel\" and \"the dishes\" are not a match.",
    "- A vaguer guess that clearly points at the same thing is a match.",
    "- A guess naming a different person, object, place, event or number is not a match.",
    "",
    "Reply with JSON only. No preamble, no markdown fences, no text outside the JSON.",
    "{ \"match\": true, \"reason\": \"one short sentence, 15 words or fewer\" }",
  ].join("\n");
}

export function parseJudgeReply(data) {
  let raw = "";
  if (data && Object.prototype.toString.call(data.content) === "[object Array]") {
    raw = data.content.map((b) => (b && b.text ? b.text : "")).join("");
  }
  const cleaned = String(raw).replace(/```json/gi, "").replace(/`/g, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first === -1 || last === -1) throw new Error("No JSON in judge reply");
  const parsed = JSON.parse(cleaned.slice(first, last + 1));
  if (typeof parsed.match !== "boolean") throw new Error("Judge gave no verdict");
  const reason =
    typeof parsed.reason === "string" && parsed.reason.trim()
      ? parsed.reason.trim()
      : "The judge did not explain.";
  return { match: parsed.match, reason: reason };
}

/* ---------- the verdict ---------- */

// Above this, call it a match on our own. Below LOW, call it a miss.
// Between the two it is a genuine coin-toss: the judge decides if one is
// available, otherwise we lean generous, because a wrong "no match" is the
// one that starts an argument — and either way there is a button to flip it.
const HIGH = 0.62;
const LOW = 0.24;
const LEAN = 0.56;

function phrase(score) {
  if (score >= 0.85) return "Same answer.";
  if (score >= HIGH) return "Same thing, said differently.";
  if (score >= LEAN) return "Close enough to count.";
  if (score > LOW) return "Not quite the same answer.";
  return "Two different answers.";
}

/**
 * Score one pair. `answerText` is the truth, `guessText` is the prediction.
 * `sendToJudge` is optional; without it everything still resolves offline.
 *
 * Returns { match, reason, tier, score }.
 */
export async function evaluatePair(question, answerName, answerText, guessName, guessText, sendToJudge) {
  const rawA = String(answerText || "").trim();
  const rawG = String(guessText || "").trim();

  if (!rawA || !rawG) {
    return { match: false, reason: "Nothing written down.", tier: "empty", score: 0 };
  }

  // Numeric questions are scored by closeness, not by meaning.
  if (question && question.mode === "numeric") {
    const truth = parseNumber(rawA);
    const guess = parseNumber(rawG);
    if (truth !== null && guess !== null) {
      const match = Math.abs(guess - truth) <= Math.abs(truth) * 0.25 + 1e-9;
      return {
        match: match,
        reason:
          "Guessed " + tidyNumber(guess) + ", actual " + tidyNumber(truth) +
          " — " + (match ? "inside" : "outside") + " the 25% window.",
        tier: "numeric",
        score: match ? 1 : 0,
      };
    }
    // No number on one side: fall through to the language tiers.
  }

  // "me" and "you" become names, so the two sides can agree about who.
  const a = resolvePeople(rawA, answerName, guessName);
  const g = resolvePeople(rawG, guessName, answerName);

  const na = normalize(a);
  const ng = normalize(g);
  const negation = negationMode(a, g);
  const agrees = negation !== "conflict";

  if (na && ng && na === ng && agrees) {
    return { match: true, reason: "Same answer.", tier: "exact", score: 1 };
  }

  let score = similarity(a, g);

  // "never puts his laundry away" vs "leaves laundry on the floor": the
  // grammar is opposite, the act is one act. Reconciling the negation is
  // itself evidence, so long as they are talking about the same thing.
  if (negation === "reconciled" && sharesSubject(a, g)) {
    score = Math.max(score, 0.7);
  }

  // For "who does X" questions the person IS the answer. Agreeing on who is
  // strong evidence even when the rest is worded completely differently;
  // naming different people settles it the other way.
  const whoA = namedPerson(a, [answerName, guessName]);
  const whoG = namedPerson(g, [answerName, guessName]);
  if (whoA && whoG) {
    score = whoA === whoG ? Math.max(score, 0.58) : Math.min(score, 0.12);
  }

  // A flat contradiction about negation that we could not reconcile.
  if (!agrees) {
    if (sendToJudge) {
      try {
        const data = await sendToJudge({
          model: JUDGE_MODEL,
          max_tokens: 1000,
          messages: [{ role: "user", content: buildJudgePrompt(question.text, answerName, rawA, guessName, rawG) }],
        });
        const verdict = parseJudgeReply(data);
        return { match: verdict.match, reason: verdict.reason, tier: "judge", score: score };
      } catch (err) {
        // fall through to the offline call
      }
    }
    return {
      match: false,
      reason: "One says it happens, the other says it does not.",
      tier: "negation",
      score: score,
    };
  }

  if (score >= HIGH) {
    return { match: true, reason: phrase(score), tier: "auto", score: score };
  }
  if (score <= LOW) {
    return { match: false, reason: phrase(score), tier: "auto", score: score };
  }

  // Genuinely ambiguous. Use the judge if there is one.
  if (sendToJudge) {
    try {
      const data = await sendToJudge({
        model: JUDGE_MODEL,
        max_tokens: 1000,
        messages: [{ role: "user", content: buildJudgePrompt(question.text, answerName, rawA, guessName, rawG) }],
      });
      const verdict = parseJudgeReply(data);
      return { match: verdict.match, reason: verdict.reason, tier: "judge", score: score };
    } catch (err) {
      // fall through
    }
  }
  const match = score >= LEAN;
  return { match: match, reason: phrase(score), tier: "auto", score: score };
}

/** Score both directions of one question at once. */
export async function evaluateBoth(question, names, entries, sendToJudge) {
  const [vA, vB] = await Promise.all([
    evaluatePair(question, names[0], entries[0].answer, names[1], entries[1].guess, sendToJudge),
    evaluatePair(question, names[1], entries[1].answer, names[0], entries[0].guess, sendToJudge),
  ]);
  return { vA: { ...vA, flipped: false }, vB: { ...vB, flipped: false } };
}
