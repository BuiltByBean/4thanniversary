/* ==================================================================== *
 *  THE MATCHING ENGINE
 *
 *  Shared by the browser (solo mode judges locally) and the server (room
 *  mode judges once, so both phones see the same verdict). The network call
 *  is injected, so this file itself never knows where the judge lives.
 *
 *    Tier 1 — normalize + exact compare
 *    Tier 2 — Dice coefficient on token sets + negation flags
 *    Tier 3 — Claude as judge (falls back to Dice >= 0.4, "Judged offline.")
 * ==================================================================== */

export const JUDGE_MODEL = "claude-sonnet-4-6";

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
];

const FILLER_RE =
  /^(i think |i would say |i would guess |probably |definitely |it would be |it is |that would be |maybe |honestly |obviously |well |just |i guess |guessing )+/;

const STOPWORDS = new Set([
  "the", "a", "an", "my", "your", "our", "is", "are", "up", "out", "on", "in",
  "at", "to", "of", "and", "or", "that", "this", "it", "when", "always", "never",
  // Negation words such as "not" are deliberately NOT in here — they stay as
  // tokens. "never" is dropped as a token but still trips the negation flag.
]);

const NEGATION_RE =
  /(\bnot\b|\bnever\b|\bno\b|\bnone\b|\bnothing\b|\bwithout\b|\b(fail|fails|failing|forget|forgets|forgetting|refuse|refuses|neglect|neglects|avoid|avoids)\s+to\b)/;

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

/** Lowercase, de-contract, de-filler, de-punctuate, de-stopword, light stem. */
export function normalize(text) {
  let s = String(text == null ? "" : text).toLowerCase().trim();
  s = expandContractions(s);
  s = s.replace(FILLER_RE, "");
  s = s.replace(/[^a-z0-9\s]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(FILLER_RE, "");
  const words = s.split(" ").filter(Boolean);
  const kept = [];
  for (let i = 0; i < words.length; i += 1) {
    if (STOPWORDS.has(words[i])) continue;
    kept.push(stemWord(words[i]));
  }
  return kept.join(" ");
}

export function tokenSet(text) {
  const n = normalize(text);
  return new Set(n ? n.split(" ") : []);
}

/** 2 * |A n B| / (|A| + |B|) */
export function diceCoefficient(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  a.forEach((t) => {
    if (b.has(t)) shared += 1;
  });
  return (2 * shared) / (a.size + b.size);
}

export function hasNegation(text) {
  const s = expandContractions(String(text == null ? "" : text).toLowerCase())
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ");
  return NEGATION_RE.test(s);
}

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

/** Pull the verdict out of whatever the model wrapped it in. Throws if absent. */
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

/**
 * Score one pair. `answerText` is the truth, `guessText` is the prediction.
 * `sendToJudge` takes the request body and returns the raw API response; it is
 * injected so the browser can route through a proxy and the server can call
 * the API directly. Omit it and tier 3 degrades to the offline fallback.
 *
 * Returns { match, reason, tier, dice }.
 */
export async function evaluatePair(question, answerName, answerText, guessName, guessText, sendToJudge) {
  const a = String(answerText || "").trim();
  const g = String(guessText || "").trim();

  if (!a || !g) {
    return { match: false, reason: "Nothing written down.", tier: "empty", dice: 0 };
  }

  // Numeric questions are scored by closeness, not by meaning.
  if (question.mode === "numeric") {
    const truth = parseNumber(a);
    const guess = parseNumber(g);
    if (truth !== null && guess !== null) {
      const tolerance = Math.abs(truth) * 0.25;
      const match = Math.abs(guess - truth) <= tolerance + 1e-9;
      return {
        match: match,
        reason:
          "Guessed " + tidyNumber(guess) + ", actual " + tidyNumber(truth) +
          " — " + (match ? "inside" : "outside") + " the 25% window.",
        tier: "numeric",
        dice: 0,
      };
    }
    // No number on one side: fall through to the language tiers.
  }

  // Negation is read up front. The stopword list drops "never" as a token, so
  // "he never apologizes first" and "he apologizes first" normalize to the same
  // string — without this guard tier 1 would call that a match.
  const negA = hasNegation(a);
  const negG = hasNegation(g);

  // Tier 1 — normalized exact compare.
  const na = normalize(a);
  const ng = normalize(g);
  if (na && ng && na === ng && negA === negG) {
    return {
      match: true,
      reason: "The same answer once the wording is stripped away.",
      tier: "exact",
      dice: 1,
    };
  }

  // Tier 2 — token overlap plus negation agreement.
  const d = diceCoefficient(tokenSet(a), tokenSet(g));
  const shown = d.toFixed(2);

  if (d >= 0.6 && negA === negG) {
    return { match: true, reason: "Nearly the same words (overlap " + shown + ").", tier: "overlap", dice: d };
  }
  if (d <= 0.15) {
    return { match: false, reason: "Almost nothing in common (overlap " + shown + ").", tier: "overlap", dice: d };
  }

  // Tier 3 — Claude reads both and decides.
  try {
    if (!sendToJudge) throw new Error("No judge available");
    const data = await sendToJudge({
      model: JUDGE_MODEL,
      max_tokens: 1000,
      messages: [
        { role: "user", content: buildJudgePrompt(question.text, answerName, a, guessName, g) },
      ],
    });
    const verdict = parseJudgeReply(data);
    return { match: verdict.match, reason: verdict.reason, tier: "judge", dice: d };
  } catch (err) {
    return { match: d >= 0.4, reason: "Judged offline.", tier: "offline", dice: d };
  }
}

/** Score both directions of one question at once. */
export async function evaluateBoth(question, names, entries, sendToJudge) {
  const [vA, vB] = await Promise.all([
    evaluatePair(question, names[0], entries[0].answer, names[1], entries[1].guess, sendToJudge),
    evaluatePair(question, names[1], entries[1].answer, names[0], entries[0].guess, sendToJudge),
  ]);
  return { vA: { ...vA, flipped: false }, vB: { ...vB, flipped: false } };
}
