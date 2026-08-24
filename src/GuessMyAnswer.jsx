import React, { useState, useEffect, useRef, useMemo } from "react";

/* ==================================================================== *
 *  GUESS MY ANSWER — The Fourth Anniversary Edition
 *  Michael & Hannah Bean
 *
 *  EVERYTHING WORTH EDITING LIVES IN THIS BLOCK.
 *  (It is all editable from inside the app too: "Edit the questions".)
 * ==================================================================== */

const JUDGE_MODEL = "claude-sonnet-4-6";

const OCCASION = {
  kicker: "The Fourth Anniversary Edition",
  dateline: "Four Years  ·  August 24, 2026",
  subtitle: "One phone, two answers, and absolutely no negotiating.",
  epigraph: "The heart of man plans his way, but the LORD establishes his steps.",
  epigraphSource: "Proverbs 16:9",
};

const DEFAULT_NAMES = ["Michael", "Hannah"];

const DEFAULT_RULES = [
  "Both write your answer down. No talking, no peeking. A match is a point.",
  "No negotiating after the reveal.",
  "Answer as the other person would, not as you wish they would.",
];

const DEFAULT_ROUNDS = [
  { id: "r1", name: "Round One", subtitle: "how well do you know me" },
  { id: "r2", name: "Round Two", subtitle: "closer to the bone" },
  { id: "r3", name: "Round Three", subtitle: "no wrong answers, only wrong guesses" },
];

// mode: "numeric" scores by closeness (within 25%) instead of by meaning.
const DEFAULT_QUESTIONS = [
  { id: "q1", round: "r1", text: "Which thing I bought did you call a waste and now use more than I do?" },
  { id: "q2", round: "r1", text: "How many hours a week do I really spend on the D&D app? Closest wins.", mode: "numeric" },
  { id: "q3", round: "r1", text: "What is my tell when I am annoyed and pretending not to be?" },
  { id: "q4", round: "r1", text: "Which of my side projects did you quietly think would flop?" },
  { id: "q5", round: "r1", text: "Who apologizes first, and how long does it usually take?" },
  { id: "q6", round: "r2", text: "What did you actually think of me the first time we met?" },
  { id: "q7", round: "r2", text: "What was the hardest month of these four years, and why that one?" },
  { id: "q8", round: "r2", text: "When were you last proud of me and did not say it out loud?" },
  { id: "q9", round: "r2", text: "What do I do now that I did not do four years ago?" },
  { id: "q10", round: "r2", text: "My most annoying habit. Be specific. “Everything” is not a point." },
  { id: "q11", round: "r3", text: "If you could delete one of my hobbies, which one goes first?" },
  { id: "q12", round: "r3", text: "Which horror movie actually kept you up? Do not say none." },
  { id: "q13", round: "r3", text: "Who is better at bedtime with Kiya? Be honest." },
  { id: "q14", round: "r3", text: "One free Saturday. No kid, no work, no house. What am I doing?" },
  { id: "q15", round: "r3", text: "Where are we living in ten years?" },
];

const DEFAULT_CLOSING = {
  text: "What do you want more of in year five?",
  note: "No points. No flipping. Just answer it.",
};

/* ==================================================================== *
 *  PALETTE & TYPE
 * ==================================================================== */

const C = {
  bg: "#FCF7EF",
  ink: "#3A322C",
  rose: "#A8453B",
  muted: "#8A7C6E",
  rule: "#D9CBB8",
  panel: "#F5EBDD",
};

const SERIF = "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', serif";
const SANS = "'Helvetica Neue', Helvetica, 'Segoe UI', Arial, sans-serif";

/* ==================================================================== *
 *  THE MATCHING ENGINE
 *    Tier 1 — normalize + exact compare
 *    Tier 2 — Dice coefficient on token sets + negation flags
 *    Tier 3 — Claude as judge (falls back to Dice >= 0.4, "Judged offline.")
 * ==================================================================== */

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
  // tokens. "never" is dropped as a token but still trips the tier-2 flag.
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
function normalize(text) {
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

function tokenSet(text) {
  const n = normalize(text);
  return new Set(n ? n.split(" ") : []);
}

/** 2 * |A n B| / (|A| + |B|) */
function diceCoefficient(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  a.forEach((t) => {
    if (b.has(t)) shared += 1;
  });
  return (2 * shared) / (a.size + b.size);
}

function hasNegation(text) {
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

function parseNumber(text) {
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

function buildJudgePrompt(questionText, answerName, answerText, guessName, guessText) {
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

/**
 * Two ways to reach the judge, so one file works in both homes:
 *   1. Same-origin /api/judge — the deployed server holds the API key.
 *   2. Straight to the API — inside a Claude artifact the key is handled.
 * Whichever answers first wins; if neither does, the caller falls back offline.
 */
async function askJudge(payload) {
  try {
    const proxied = await fetch("/api/judge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (proxied.ok) return await proxied.json();
  } catch (err) {
    // No server here. Try the direct route instead.
  }
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Judge responded " + response.status);
  return await response.json();
}

async function judgeWithClaude(questionText, answerName, answerText, guessName, guessText) {
  const prompt = buildJudgePrompt(questionText, answerName, answerText, guessName, guessText);
  const data = await askJudge({
    model: JUDGE_MODEL,
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
  });
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
 * Returns { match, reason, tier, dice }.
 */
async function evaluatePair(question, answerName, answerText, guessName, guessText) {
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
  const ta = tokenSet(a);
  const tg = tokenSet(g);
  const d = diceCoefficient(ta, tg);
  const shown = d.toFixed(2);

  if (d >= 0.6 && negA === negG) {
    return { match: true, reason: "Nearly the same words (overlap " + shown + ").", tier: "overlap", dice: d };
  }
  if (d <= 0.15) {
    return { match: false, reason: "Almost nothing in common (overlap " + shown + ").", tier: "overlap", dice: d };
  }

  // Tier 3 — Claude reads both and decides.
  try {
    const verdict = await judgeWithClaude(question.text, answerName, a, guessName, g);
    return { match: verdict.match, reason: verdict.reason, tier: "judge", dice: d };
  } catch (err) {
    return { match: d >= 0.4, reason: "Judged offline.", tier: "offline", dice: d };
  }
}

/* ==================================================================== *
 *  SMALL PIECES
 * ==================================================================== */

/* Mobile first, and mobile strictly: this gets played on a phone that is
   handed across a table. The floor is a 375px-wide screen — nothing may
   scroll sideways, nothing may escape its card, every tap target is 44px. */
const STYLE_SHEET = [
  ":root { --gmaVh: 100vh; --gmaSafeTop: env(safe-area-inset-top, 0px);",
  "  --gmaSafeBottom: env(safe-area-inset-bottom, 0px);",
  "  --gmaSafeLeft: env(safe-area-inset-left, 0px);",
  "  --gmaSafeRight: env(safe-area-inset-right, 0px); }",
  "@supports (height: 100dvh) { :root { --gmaVh: 100dvh; } }",
  "html { scrollbar-gutter: stable; -webkit-text-size-adjust: 100%; }",
  ".gmaRoot { overscroll-behavior-y: none; -webkit-tap-highlight-color: transparent;",
  "  overflow-x: hidden; }",
  ".gmaRoot * { min-width: 0; }",
  ".gmaWrap { overflow-wrap: anywhere; word-break: break-word; }",
  "@keyframes gmaFade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }",
  "@keyframes gmaSoft { from { opacity: 0; } to { opacity: 1; } }",
  "@keyframes gmaDraw { from { transform: scaleX(0); } to { transform: scaleX(1); } }",
  "@keyframes gmaPulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }",
  "@keyframes gmaSpin { to { transform: rotate(360deg); } }",
  ".gmaFade { animation: gmaFade 0.6s ease-out both; }",
  ".gmaSoft { animation: gmaSoft 0.9s ease-out both; }",
  ".gmaDraw { transform-origin: center; animation: gmaDraw 1.1s ease-out both; }",
  ".gmaPulse { animation: gmaPulse 3.2s ease-in-out infinite; }",
  ".gmaSpin { animation: gmaSpin 0.9s linear infinite; }",
  ".gmaField::placeholder { color: #B7A896; }",
  ".gmaField:focus { outline: none; border-color: #A8453B; }",
  /* 16px minimum or iOS zooms the whole page on focus. min-width:0 or a
     native input refuses to shrink and puts itself through the card wall. */
  ".gmaField { font-size: 16px; min-width: 0; max-width: 100%; min-height: 44px; }",
  ".gmaTap { -webkit-tap-highlight-color: transparent; touch-action: manipulation;",
  "  min-height: 44px; }",
  ".gmaTapSmall { -webkit-tap-highlight-color: transparent; touch-action: manipulation;",
  "  min-height: 44px; min-width: 44px; display: inline-flex; align-items: center;",
  "  justify-content: center; }",
].join("\n");

function Label({ children, color, className }) {
  return (
    <div
      className={"uppercase " + (className || "")}
      style={{
        fontFamily: SANS,
        fontSize: "0.6875rem",
        letterSpacing: "0.22em",
        color: color || C.muted,
      }}
    >
      {children}
    </div>
  );
}

function Hairline({ className, style }) {
  return (
    <div
      className={className}
      style={Object.assign({ height: "1px", backgroundColor: C.rule }, style || {})}
    />
  );
}

function Heart({ className }) {
  return (
    <div className={"flex items-center justify-center " + (className || "")}>
      <Hairline className="flex-1" />
      <span className="px-3" style={{ color: C.rose, fontSize: "0.7rem", lineHeight: 1 }}>
        &#9829;
      </span>
      <Hairline className="flex-1" />
    </div>
  );
}

function Frame({ children }) {
  return (
    <div className="w-full rounded-sm p-1" style={{ border: "1px solid " + C.rule }}>
      <div className="rounded-sm px-5 py-7 sm:px-8 sm:py-9" style={{ border: "1px solid " + C.rule }}>
        {children}
      </div>
    </div>
  );
}

function Button({ children, onClick, disabled, tone, className }) {
  const ghost = tone === "ghost";
  const quiet = tone === "quiet";
  const soft = ghost || quiet;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={"gmaTap w-full rounded-sm px-5 py-3 transition-colors duration-200 " + (className || "")}
      style={{
        fontFamily: SANS,
        fontSize: quiet ? "0.6875rem" : "0.75rem",
        letterSpacing: "0.2em",
        textTransform: "uppercase",
        border: "1px solid " + (soft ? C.rule : C.rose),
        backgroundColor: soft ? "transparent" : C.rose,
        color: soft ? C.muted : C.bg,
        opacity: disabled ? 0.35 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function TinyButton({ children, onClick, active, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="gmaTapSmall rounded-sm px-3 py-1 transition-colors duration-200"
      style={{
        fontFamily: SANS,
        fontSize: "0.625rem",
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        border: "1px solid " + (active ? C.rose : C.rule),
        backgroundColor: active ? C.rose : "transparent",
        color: active ? C.bg : C.muted,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function EyeIcon({ open }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M1.8 12S5.4 5.5 12 5.5 22.2 12 22.2 12 18.6 18.5 12 18.5 1.8 12 1.8 12Z" />
      <circle cx="12" cy="12" r="3.1" />
      {open ? null : <path d="M3.5 3.5 20.5 20.5" />}
    </svg>
  );
}

function Spinner() {
  return (
    <span
      className="gmaSpin inline-block rounded-full"
      style={{
        width: "13px",
        height: "13px",
        border: "1.5px solid " + C.rule,
        borderTopColor: C.rose,
      }}
    />
  );
}

/** Ticks up to the target instead of snapping to it. */
function Tally({ value }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (start === value) {
      setShown(value);
      return undefined;
    }
    const t0 = Date.now();
    const duration = 650;
    let raf = 0;
    const step = () => {
      const t = Math.min(1, (Date.now() - t0) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(start + (value - start) * eased));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span>{shown}</span>;
}

function Field({ label, value, onChange, onEnter, masked, onToggleMask, inputRef, placeholder, fieldName }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <Label>{label}</Label>
        <button
          type="button"
          onClick={onToggleMask}
          title={masked ? "Show what I typed" : "Hide what I typed"}
          className="gmaTapSmall"
          style={{ color: C.muted, cursor: "pointer" }}
        >
          <EyeIcon open={!masked} />
        </button>
      </div>
      <input
        ref={inputRef}
        type={masked ? "password" : "text"}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onEnter();
          }
        }}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="sentences"
        spellCheck={false}
        name={fieldName}
        data-lpignore="true"
        data-1p-ignore="true"
        className="gmaField w-full rounded-sm px-3 py-3 text-base"
        style={{
          fontFamily: SERIF,
          color: C.ink,
          backgroundColor: C.bg,
          border: "1px solid " + C.rule,
          letterSpacing: masked ? "0.12em" : "normal",
        }}
      />
    </div>
  );
}

/* ==================================================================== *
 *  THE GAME
 * ==================================================================== */

let idCounter = 100;
function freshId(prefix) {
  idCounter += 1;
  return prefix + idCounter;
}

export default function GuessMyAnswer() {
  const [names, setNames] = useState(DEFAULT_NAMES);
  const [rounds, setRounds] = useState(DEFAULT_ROUNDS);
  const [questions, setQuestions] = useState(DEFAULT_QUESTIONS);
  const [rules, setRules] = useState(DEFAULT_RULES);
  const [closing, setClosing] = useState(DEFAULT_CLOSING);

  const [screen, setScreen] = useState("title");
  const [returnScreen, setReturnScreen] = useState("title");
  const [qIndex, setQIndex] = useState(0);
  const [turn, setTurn] = useState(0);
  const [pending, setPending] = useState([null, null]);
  const [draft, setDraft] = useState({ answer: "", guess: "" });
  const [masked, setMasked] = useState({ answer: true, guess: true });
  const [records, setRecords] = useState([]);
  const [judging, setJudging] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const judgeToken = useRef(0);
  const answerRef = useRef(null);
  const guessRef = useRef(null);

  // Play order: rounds in order, then the questions inside each round.
  const playList = useMemo(() => {
    const out = [];
    rounds.forEach((r) => {
      questions.forEach((q) => {
        if (q.round === r.id) out.push(q);
      });
    });
    questions.forEach((q) => {
      if (!rounds.some((r) => r.id === q.round)) out.push(q);
    });
    return out;
  }, [rounds, questions]);

  const total = playList.length;
  const question = playList[qIndex] || null;
  const currentRound = rounds.find((r) => r.id === (question ? question.round : null)) || null;

  const effective = (v) => (v ? (v.flipped ? !v.match : v.match) : false);

  const scores = useMemo(() => {
    let a = 0;
    let b = 0;
    records.forEach((rec) => {
      if (!rec) return;
      if (effective(rec.vB)) a += 1; // player one read player two correctly
      if (effective(rec.vA)) b += 1; // player two read player one correctly
    });
    return [a, b];
  }, [records]);

  const record = records[qIndex] || null;
  const partnerOf = (i) => names[i === 0 ? 1 : 0];

  /* ---------------- flow ---------------- */

  const startsNewRound = (i) => {
    if (i === 0) return true;
    const prev = playList[i - 1];
    const now = playList[i];
    return !prev || !now || prev.round !== now.round;
  };

  const clearDraft = () => {
    setDraft({ answer: "", guess: "" });
    setMasked({ answer: true, guess: true });
  };

  const beginGame = () => {
    if (!total) return;
    setRecords([]);
    setQIndex(0);
    setTurn(0);
    setPending([null, null]);
    clearDraft();
    setScreen("rules");
  };

  const startRoundOne = () => {
    if (!total) return;
    setQIndex(0);
    setTurn(0);
    setScreen("roundIntro");
  };

  const runJudging = async (entries, index) => {
    const q = playList[index];
    if (!q) return;
    const token = judgeToken.current + 1;
    judgeToken.current = token;
    setJudging(true);
    setRecords((prev) => {
      const next = prev.slice();
      next[index] = {
        qId: q.id,
        text: q.text,
        a0: entries[0].answer,
        g0: entries[0].guess,
        a1: entries[1].answer,
        g1: entries[1].guess,
        vA: null,
        vB: null,
      };
      return next;
    });

    let vA = null;
    let vB = null;
    try {
      const both = await Promise.all([
        evaluatePair(q, names[0], entries[0].answer, names[1], entries[1].guess),
        evaluatePair(q, names[1], entries[1].answer, names[0], entries[0].guess),
      ]);
      vA = both[0];
      vB = both[1];
    } catch (err) {
      vA = { match: false, reason: "Judged offline.", tier: "offline", dice: 0 };
      vB = { match: false, reason: "Judged offline.", tier: "offline", dice: 0 };
    }

    if (token !== judgeToken.current) return;
    setRecords((prev) => {
      const next = prev.slice();
      const base = next[index];
      if (!base) return prev;
      next[index] = Object.assign({}, base, {
        vA: Object.assign({ flipped: false }, vA),
        vB: Object.assign({ flipped: false }, vB),
      });
      return next;
    });
    setJudging(false);
  };

  const canSubmit = draft.answer.trim().length > 0 && draft.guess.trim().length > 0;

  const submitTurn = () => {
    if (!canSubmit) return;
    const entry = { answer: draft.answer.trim(), guess: draft.guess.trim() };
    if (turn === 0) {
      setPending([entry, null]);
      clearDraft();
      setScreen("handoff");
    } else {
      const entries = [pending[0] || { answer: "", guess: "" }, entry];
      setPending(entries);
      clearDraft();
      setScreen("reveal");
      runJudging(entries, qIndex);
    }
  };

  const takeSecondTurn = () => {
    setTurn(1);
    clearDraft();
    setScreen("question");
  };

  const nextQuestion = () => {
    const i = qIndex + 1;
    if (i >= total) {
      setScreen("final");
      return;
    }
    setQIndex(i);
    setTurn(0);
    setPending([null, null]);
    clearDraft();
    setScreen(startsNewRound(i) ? "roundIntro" : "question");
  };

  const playAgain = () => {
    setRecords([]);
    setQIndex(0);
    setTurn(0);
    setPending([null, null]);
    clearDraft();
    setJudging(false);
    setScreen("title");
  };

  const flip = (which) => {
    setRecords((prev) => {
      const next = prev.slice();
      const rec = next[qIndex];
      if (!rec || !rec[which]) return prev;
      const patch = {};
      patch[which] = Object.assign({}, rec[which], { flipped: !rec[which].flipped });
      next[qIndex] = Object.assign({}, rec, patch);
      return next;
    });
  };

  const openEditor = () => {
    setConfirmReset(false);
    setReturnScreen(screen === "editor" ? "title" : screen);
    setScreen("editor");
  };

  const closeEditor = () => {
    setConfirmReset(false);
    setQIndex((i) => Math.max(0, Math.min(i, Math.max(0, playList.length - 1))));
    setScreen(returnScreen);
  };

  /* ---------------- timers & keyboard ---------------- */

  useEffect(() => {
    if (screen !== "roundIntro") return undefined;
    const t = setTimeout(() => setScreen("question"), 2100);
    return () => clearTimeout(t);
  }, [screen, qIndex]);

  useEffect(() => {
    if (screen !== "question") return undefined;
    const t = setTimeout(() => {
      if (answerRef.current) answerRef.current.focus();
    }, 80);
    return () => clearTimeout(t);
  }, [screen, turn, qIndex]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Enter") return;
      const tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (screen === "rules") startRoundOne();
      else if (screen === "roundIntro") setScreen("question");
      else if (screen === "handoff") takeSecondTurn();
      else if (screen === "reveal" && !judging) nextQuestion();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ---------------- persistent scoreboard ---------------- */

  const scoreboard = (
    <div
      className="sticky top-0 z-10 -mx-5 mb-6 px-5 pb-3 pt-3 sm:-mx-8 sm:px-8"
      style={{
        backgroundColor: C.bg,
        borderBottom: "1px solid " + C.rule,
        paddingTop: "calc(0.75rem + var(--gmaSafeTop))",
      }}
    >
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <Label className="truncate">{names[0] || "Player one"}</Label>
          <div style={{ fontFamily: SERIF, fontSize: "1.75rem", lineHeight: 1.1, color: C.ink }}>
            <Tally value={scores[0]} />
          </div>
        </div>
        <div className="pb-1 text-center">
          <Label color={C.rose}>
            {total ? "Question " + Math.min(qIndex + 1, total) + " of " + total : "No questions"}
          </Label>
          <div className="mt-1" style={{ color: C.rule, fontSize: "0.65rem", lineHeight: 1 }}>
            &#9829;
          </div>
        </div>
        <div className="min-w-0 text-right">
          <Label className="truncate">{names[1] || "Player two"}</Label>
          <div style={{ fontFamily: SERIF, fontSize: "1.75rem", lineHeight: 1.1, color: C.ink }}>
            <Tally value={scores[1]} />
          </div>
        </div>
      </div>
    </div>
  );

  /* ---------------- screens ---------------- */

  const titleScreen = (
    <Frame>
      <div className="text-center">
        <div className="gmaSoft">
          <Label>{OCCASION.kicker}</Label>
        </div>
        <Hairline className="gmaDraw mx-auto mt-5 w-24" style={{ animationDelay: "0.25s" }} />
        <div className="gmaFade mt-8" style={{ animationDelay: "0.35s" }}>
          <div style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: "1.35rem", color: C.muted }}>
            Welcome to
          </div>
          <h1
            className="gmaWrap mt-1 text-4xl sm:text-5xl"
            style={{ fontFamily: SERIF, fontStyle: "italic", lineHeight: 1.05, color: C.ink }}
          >
            Guess My Answer
          </h1>
        </div>
        <div className="gmaFade mt-6" style={{ animationDelay: "0.65s" }}>
          <p style={{ fontFamily: SERIF, fontSize: "1rem", lineHeight: 1.6, color: C.muted }}>
            {OCCASION.subtitle}
          </p>
          <div className="mt-4">
            <Label className="gmaPulse">{OCCASION.dateline}</Label>
          </div>
        </div>

        <Heart className="gmaFade mt-9" />

        <div className="gmaFade mt-8 space-y-5 text-left" style={{ animationDelay: "0.85s" }}>
          {[0, 1].map((i) => (
            <div key={i}>
              <Label className="mb-2">{i === 0 ? "Player One" : "Player Two"}</Label>
              <input
                type="text"
                value={names[i]}
                onChange={(e) => {
                  const v = e.target.value;
                  setNames((prev) => {
                    const next = prev.slice();
                    next[i] = v;
                    return next;
                  });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    beginGame();
                  }
                }}
                className="gmaField w-full rounded-sm px-3 py-3 text-base"
                style={{
                  fontFamily: SERIF,
                  fontStyle: "italic",
                  color: C.ink,
                  backgroundColor: C.bg,
                  border: "1px solid " + C.rule,
                }}
              />
            </div>
          ))}
        </div>

        <div className="gmaFade mt-8" style={{ animationDelay: "1s" }}>
          <Button onClick={beginGame} disabled={!total}>
            Begin
          </Button>
          {total ? null : (
            <p className="mt-3" style={{ fontFamily: SERIF, fontSize: "0.85rem", color: C.rose }}>
              There are no questions yet. Add some first.
            </p>
          )}
          <div className="mt-4">
            <Button tone="quiet" onClick={openEditor}>
              Edit the questions
            </Button>
          </div>
        </div>
      </div>
    </Frame>
  );

  const rulesScreen = (
    <Frame>
      <div className="gmaFade">
        <div className="text-center">
          <Label>How to Play</Label>
        </div>
        <Heart className="mt-5" />
        <ol className="mt-7 space-y-6">
          {rules.map((rule, i) => (
            <li key={i} className="flex gap-4">
              <span
                style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: "1.5rem", lineHeight: 1.1, color: C.rose }}
              >
                {i + 1}
              </span>
              <span style={{ fontFamily: SERIF, fontSize: "1.05rem", lineHeight: 1.6, color: C.ink }}>{rule}</span>
            </li>
          ))}
        </ol>
        <Heart className="mt-8" />
        <div className="mt-8">
          <Button onClick={startRoundOne} disabled={!total}>
            Start {rounds.length ? rounds[0].name : "Round One"}
          </Button>
          <div className="mt-4">
            <Button tone="quiet" onClick={openEditor}>
              Edit the questions
            </Button>
          </div>
        </div>
      </div>
    </Frame>
  );

  const roundIntroScreen = (
    <div
      className="gmaTap flex w-full cursor-pointer items-center justify-center px-6"
      style={{ minHeight: "var(--gmaVh)" }}
      onClick={() => setScreen("question")}
    >
      <div className="gmaFade w-full max-w-md text-center">
        <Hairline className="gmaDraw mx-auto w-16" />
        <div className="mt-8">
          <Label color={C.rose}>{currentRound ? currentRound.name : "Round"}</Label>
        </div>
        <h2
          className="mt-5"
          style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: "2.1rem", lineHeight: 1.2, color: C.ink }}
        >
          {currentRound ? currentRound.subtitle : ""}
        </h2>
        <Heart className="mt-9" />
        <div className="gmaPulse mt-8">
          <Label>Tap to continue</Label>
        </div>
      </div>
    </div>
  );

  const questionScreen = (
    <Frame>
      {scoreboard}
      <div className="gmaFade">
        <div className="flex items-center justify-between gap-3">
          <Label>{currentRound ? currentRound.name : ""}</Label>
          {question && question.mode === "numeric" ? <Label color={C.rose}>Closest wins</Label> : null}
        </div>
        <p className="gmaWrap mt-4" style={{ fontFamily: SERIF, fontSize: "1.4rem", lineHeight: 1.4, color: C.ink }}>
          {question ? question.text : ""}
        </p>

        <Heart className="mt-7" />

        <div className="mt-7 text-center">
          <div style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: "1.35rem", color: C.rose }}>
            {names[turn]}&#8217;s turn
          </div>
          <p className="mt-2" style={{ fontFamily: SERIF, fontSize: "0.9rem", lineHeight: 1.5, color: C.muted }}>
            Keep the screen to yourself. Both boxes stay hidden as you type.
          </p>
        </div>

        <div className="mt-7 space-y-5">
          <Field
            label="Your answer"
            fieldName="gma-one"
            value={draft.answer}
            masked={masked.answer}
            inputRef={answerRef}
            placeholder="the honest one"
            onToggleMask={() => setMasked((m) => ({ answer: !m.answer, guess: m.guess }))}
            onChange={(v) => setDraft((d) => ({ answer: v, guess: d.guess }))}
            onEnter={() => {
              if (guessRef.current) guessRef.current.focus();
            }}
          />
          <Field
            label={"What will " + partnerOf(turn) + " say?"}
            fieldName="gma-two"
            value={draft.guess}
            masked={masked.guess}
            inputRef={guessRef}
            placeholder="your guess at theirs"
            onToggleMask={() => setMasked((m) => ({ answer: m.answer, guess: !m.guess }))}
            onChange={(v) => setDraft((d) => ({ answer: d.answer, guess: v }))}
            onEnter={submitTurn}
          />
        </div>

        <div className="mt-8">
          <Button onClick={submitTurn} disabled={!canSubmit}>
            {turn === 0 ? "Lock it in" : "Lock it in & reveal"}
          </Button>
        </div>
      </div>
    </Frame>
  );

  const handoffScreen = (
    <Frame>
      {scoreboard}
      <div className="gmaFade py-10 text-center">
        <Label>Hands off</Label>
        <h2
          className="gmaWrap mt-6 text-4xl sm:text-5xl"
          style={{ fontFamily: SERIF, fontStyle: "italic", lineHeight: 1.15, color: C.ink }}
        >
          Pass to {names[1]}
        </h2>
        <Heart className="mt-8" />
        <p className="mt-8" style={{ fontFamily: SERIF, fontSize: "1rem", lineHeight: 1.6, color: C.muted }}>
          {names[1]}, take the screen. Nobody else presses this button.
        </p>
        <div className="mt-9">
          <Button onClick={takeSecondTurn}>I&#8217;m {names[1]} &#8212; my turn</Button>
        </div>
      </div>
    </Frame>
  );

  const verdictPanel = (which) => {
    if (!record) return null;
    const isA = which === "vA";
    const answerName = isA ? names[0] : names[1];
    const guessName = isA ? names[1] : names[0];
    const answerText = isA ? record.a0 : record.a1;
    const guessText = isA ? record.g1 : record.g0;
    const v = record[which];
    const matched = effective(v);

    return (
      <div className="rounded-sm px-4 py-5" style={{ backgroundColor: C.panel, border: "1px solid " + C.rule }}>
        <Label>{answerName} answered</Label>
        <p className="gmaWrap mt-1" style={{ fontFamily: SERIF, fontSize: "1.1rem", lineHeight: 1.45, color: C.ink }}>
          {answerText}
        </p>
        <Hairline className="my-4" />
        <Label>{guessName} guessed</Label>
        <p className="gmaWrap mt-1" style={{ fontFamily: SERIF, fontSize: "1.1rem", lineHeight: 1.45, color: C.ink }}>
          {guessText}
        </p>
        <Hairline className="my-4" />

        {v ? (
          <div className="gmaFade">
            <div className="flex items-baseline justify-between gap-3">
              <span
                style={{
                  fontFamily: SERIF,
                  fontStyle: "italic",
                  fontSize: "1.25rem",
                  color: matched ? C.rose : C.muted,
                }}
              >
                {matched ? "Match" : "No match"}
              </span>
              <span
                style={{
                  fontFamily: SANS,
                  fontSize: "0.6875rem",
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: matched ? C.rose : C.muted,
                }}
              >
                {matched ? "+1 " + guessName : "no point"}
              </span>
            </div>
            <p
              className="mt-2"
              style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: "0.9rem", lineHeight: 1.5, color: C.muted }}
            >
              {v.flipped ? "Overridden by hand. " : ""}
              {v.reason}
            </p>
            <div className="mt-4">
              <TinyButton onClick={() => flip(which)} active={v.flipped}>
                {v.flipped ? "Undo override" : "Override"}
              </TinyButton>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Spinner />
            <span
              style={{
                fontFamily: SANS,
                fontSize: "0.65rem",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: C.muted,
              }}
            >
              Reading them both
            </span>
          </div>
        )}
      </div>
    );
  };

  const revealScreen = (
    <Frame>
      {scoreboard}
      <div className="gmaFade">
        <div className="text-center">
          <Label>The reveal</Label>
          <p
            className="gmaWrap mx-auto mt-3 max-w-sm"
            style={{ fontFamily: SERIF, fontSize: "1rem", lineHeight: 1.5, color: C.muted }}
          >
            {record ? record.text : question ? question.text : ""}
          </p>
        </div>

        {judging ? (
          <div className="mt-5 flex items-center justify-center gap-2">
            <Spinner />
            <span
              style={{
                fontFamily: SANS,
                fontSize: "0.65rem",
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: C.muted,
              }}
            >
              Consulting the judge
            </span>
          </div>
        ) : null}

        <Heart className="mt-6" />

        <div className="mt-6 space-y-5">
          {verdictPanel("vA")}
          {verdictPanel("vB")}
        </div>

        <div className="mt-8">
          <Button onClick={nextQuestion} disabled={judging}>
            {qIndex + 1 >= total ? "See the final score" : "Next question"}
          </Button>
        </div>
      </div>
    </Frame>
  );

  const finalScreen = (() => {
    let headline;
    let warm;
    if (scores[0] === scores[1]) {
      headline = "A dead tie.";
      warm =
        "Four years of paying attention, split straight down the middle. Nobody has to win this one.";
    } else {
      const winner = scores[0] > scores[1] ? names[0] : names[1];
      const other = scores[0] > scores[1] ? names[1] : names[0];
      headline = winner + " was paying closer attention.";
      warm =
        other +
        ", the ones you missed are the ones worth talking about tonight. That is the whole point of the game.";
    }

    return (
      <Frame>
        <div className="gmaFade text-center">
          <Label>Final score</Label>
          <div className="mt-6 flex items-end justify-center gap-8">
            <div>
              <div style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: "1.05rem", color: C.muted }}>
                {names[0]}
              </div>
              <div style={{ fontFamily: SERIF, fontSize: "3.2rem", lineHeight: 1, color: C.ink }}>
                <Tally value={scores[0]} />
              </div>
            </div>
            <div className="pb-4" style={{ color: C.rule, fontFamily: SERIF, fontSize: "1.25rem" }}>
              &#9829;
            </div>
            <div>
              <div style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: "1.05rem", color: C.muted }}>
                {names[1]}
              </div>
              <div style={{ fontFamily: SERIF, fontSize: "3.2rem", lineHeight: 1, color: C.ink }}>
                <Tally value={scores[1]} />
              </div>
            </div>
          </div>

          <h2
            className="mt-8"
            style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: "1.7rem", lineHeight: 1.25, color: C.rose }}
          >
            {headline}
          </h2>
          <p
            className="mx-auto mt-4 max-w-sm"
            style={{ fontFamily: SERIF, fontSize: "1rem", lineHeight: 1.6, color: C.ink }}
          >
            {warm}
          </p>

          <Heart className="mt-10" />

          <div className="mt-10">
            <Label>One last question</Label>
            <p
              className="gmaWrap mx-auto mt-6 max-w-sm"
              style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: "1.8rem", lineHeight: 1.3, color: C.ink }}
            >
              {closing.text}
            </p>
            <p className="mt-6" style={{ fontFamily: SERIF, fontSize: "0.95rem", color: C.muted }}>
              {closing.note}
            </p>
          </div>

          <Heart className="mt-10" />

          <p
            className="mx-auto mt-8 max-w-sm"
            style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: "0.9rem", lineHeight: 1.6, color: C.muted }}
          >
            &#8220;{OCCASION.epigraph}&#8221;
          </p>
          <div className="mt-2">
            <Label>{OCCASION.epigraphSource}</Label>
          </div>

          <div className="mt-10">
            <Button onClick={playAgain}>Play again</Button>
            <div className="mt-4">
              <Button tone="quiet" onClick={openEditor}>
                Edit the questions
              </Button>
            </div>
          </div>
        </div>
      </Frame>
    );
  })();

  /* ---------------- editor ---------------- */

  const patchQuestion = (id, patch) =>
    setQuestions((prev) => prev.map((q) => (q.id === id ? Object.assign({}, q, patch) : q)));

  const removeQuestion = (id) => setQuestions((prev) => prev.filter((q) => q.id !== id));

  const addQuestion = (roundId) =>
    setQuestions((prev) => {
      const next = prev.slice();
      let insertAt = next.length;
      for (let i = next.length - 1; i >= 0; i -= 1) {
        if (next[i].round === roundId) {
          insertAt = i + 1;
          break;
        }
      }
      next.splice(insertAt, 0, { id: freshId("q"), round: roundId, text: "" });
      return next;
    });

  const moveQuestion = (id, delta) =>
    setQuestions((prev) => {
      const q = prev.find((x) => x.id === id);
      if (!q) return prev;
      const siblings = prev.filter((x) => x.round === q.round);
      const pos = siblings.indexOf(q);
      const target = pos + delta;
      if (target < 0 || target >= siblings.length) return prev;
      const reordered = siblings.slice();
      reordered.splice(pos, 1);
      reordered.splice(target, 0, q);
      let k = 0;
      return prev.map((x) => {
        if (x.round !== q.round) return x;
        const swapped = reordered[k];
        k += 1;
        return swapped;
      });
    });

  const moveQuestionToRound = (id, roundId) =>
    setQuestions((prev) => {
      const q = prev.find((x) => x.id === id);
      if (!q || q.round === roundId) return prev;
      const without = prev.filter((x) => x.id !== id);
      const moved = Object.assign({}, q, { round: roundId });
      let insertAt = without.length;
      for (let i = without.length - 1; i >= 0; i -= 1) {
        if (without[i].round === roundId) {
          insertAt = i + 1;
          break;
        }
      }
      without.splice(insertAt, 0, moved);
      return without;
    });

  const patchRound = (id, patch) =>
    setRounds((prev) => prev.map((r) => (r.id === id ? Object.assign({}, r, patch) : r)));

  const addRound = () =>
    setRounds((prev) => prev.concat([{ id: freshId("r"), name: "Round " + (prev.length + 1), subtitle: "" }]));

  const removeRound = (id) => {
    if (questions.some((q) => q.round === id)) return;
    setRounds((prev) => prev.filter((r) => r.id !== id));
  };

  const moveRound = (id, delta) =>
    setRounds((prev) => {
      const pos = prev.findIndex((r) => r.id === id);
      const target = pos + delta;
      if (pos < 0 || target < 0 || target >= prev.length) return prev;
      const next = prev.slice();
      const moved = next.splice(pos, 1)[0];
      next.splice(target, 0, moved);
      return next;
    });

  const resetEverything = () => {
    setRounds(DEFAULT_ROUNDS);
    setQuestions(DEFAULT_QUESTIONS);
    setRules(DEFAULT_RULES);
    setClosing(DEFAULT_CLOSING);
  };

  const editorInput = {
    fontFamily: SERIF,
    fontSize: "1rem",
    lineHeight: 1.5,
    color: C.ink,
    backgroundColor: C.bg,
    border: "1px solid " + C.rule,
  };

  const editorScreen = (
    <Frame>
      <div className="gmaFade">
        <div className="text-center">
          <Label>Edit everything</Label>
          <h2 className="mt-3" style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: "1.9rem", color: C.ink }}>
            The Question Book
          </h2>
          <p className="mt-3" style={{ fontFamily: SERIF, fontSize: "0.9rem", lineHeight: 1.5, color: C.muted }}>
            Rewrite anything. Numeric questions are scored by closeness &#8212; within 25% counts.
          </p>
        </div>

        <Heart className="mt-6" />

        <div className="mt-7">
          <Label>The three rules</Label>
          <div className="mt-3 space-y-3">
            {rules.map((rule, i) => (
              <div key={i} className="flex items-start gap-3">
                <span style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: "1.1rem", color: C.rose }}>
                  {i + 1}
                </span>
                <textarea
                  rows={2}
                  value={rule}
                  onChange={(e) => {
                    const v = e.target.value;
                    setRules((prev) => prev.map((r, k) => (k === i ? v : r)));
                  }}
                  className="gmaField w-full rounded-sm px-3 py-2 text-base"
                  style={editorInput}
                />
              </div>
            ))}
          </div>
        </div>

        {rounds.map((round, ri) => {
          const mine = questions.filter((q) => q.round === round.id);
          return (
            <div key={round.id} className="mt-9">
              <Hairline />
              <div className="mt-5 flex items-center justify-between gap-2">
                <Label color={C.rose}>Round {ri + 1}</Label>
                <div className="flex gap-2">
                  <TinyButton onClick={() => moveRound(round.id, -1)} title="Move round up">
                    &#8593;
                  </TinyButton>
                  <TinyButton onClick={() => moveRound(round.id, 1)} title="Move round down">
                    &#8595;
                  </TinyButton>
                  <TinyButton
                    onClick={() => removeRound(round.id)}
                    title={mine.length ? "Empty this round first" : "Delete this round"}
                  >
                    Delete
                  </TinyButton>
                </div>
              </div>
              <div className="mt-3 space-y-3">
                <input
                  type="text"
                  value={round.name}
                  placeholder="Round name"
                  onChange={(e) => patchRound(round.id, { name: e.target.value })}
                  className="gmaField w-full rounded-sm px-3 py-2 text-base"
                  style={Object.assign({}, editorInput, { fontStyle: "italic" })}
                />
                <input
                  type="text"
                  value={round.subtitle}
                  placeholder="Round subtitle"
                  onChange={(e) => patchRound(round.id, { subtitle: e.target.value })}
                  className="gmaField w-full rounded-sm px-3 py-2 text-base"
                  style={Object.assign({}, editorInput, { color: C.muted })}
                />
              </div>

              <div className="mt-5 space-y-4">
                {mine.map((q, qi) => (
                  <div
                    key={q.id}
                    className="rounded-sm px-3 py-3"
                    style={{ backgroundColor: C.panel, border: "1px solid " + C.rule }}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <Label>Question {qi + 1}</Label>
                      <div className="flex gap-2">
                        <TinyButton onClick={() => moveQuestion(q.id, -1)} title="Move up">
                          &#8593;
                        </TinyButton>
                        <TinyButton onClick={() => moveQuestion(q.id, 1)} title="Move down">
                          &#8595;
                        </TinyButton>
                        <TinyButton onClick={() => removeQuestion(q.id)} title="Remove this question">
                          &#10005;
                        </TinyButton>
                      </div>
                    </div>
                    <textarea
                      rows={3}
                      value={q.text}
                      placeholder="Write the question"
                      onChange={(e) => patchQuestion(q.id, { text: e.target.value })}
                      className="gmaField w-full rounded-sm px-3 py-2 text-base"
                      style={editorInput}
                    />
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <TinyButton
                        active={q.mode === "numeric"}
                        onClick={() =>
                          patchQuestion(q.id, { mode: q.mode === "numeric" ? undefined : "numeric" })
                        }
                        title="Score by closeness instead of by meaning"
                      >
                        Numeric
                      </TinyButton>
                      <select
                        value={q.round}
                        onChange={(e) => moveQuestionToRound(q.id, e.target.value)}
                        className="gmaTapSmall rounded-sm px-3 py-1"
                        style={{
                          fontFamily: SANS,
                          fontSize: "0.625rem",
                          letterSpacing: "0.12em",
                          textTransform: "uppercase",
                          color: C.muted,
                          backgroundColor: "transparent",
                          border: "1px solid " + C.rule,
                        }}
                      >
                        {rounds.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
                {mine.length ? null : (
                  <p style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: "0.9rem", color: C.muted }}>
                    This round is empty.
                  </p>
                )}
              </div>

              <div className="mt-4">
                <Button tone="ghost" onClick={() => addQuestion(round.id)}>
                  + Add a question here
                </Button>
              </div>
            </div>
          );
        })}

        <div className="mt-6">
          <Button tone="quiet" onClick={addRound}>
            + Add a round
          </Button>
        </div>

        <Heart className="mt-9" />

        <div className="mt-7">
          <Label>One last question</Label>
          <div className="mt-3 space-y-3">
            <textarea
              rows={2}
              value={closing.text}
              onChange={(e) => {
                const v = e.target.value;
                setClosing((c) => Object.assign({}, c, { text: v }));
              }}
              className="gmaField w-full rounded-sm px-3 py-2 text-base"
              style={Object.assign({}, editorInput, { fontStyle: "italic" })}
            />
            <input
              type="text"
              value={closing.note}
              onChange={(e) => {
                const v = e.target.value;
                setClosing((c) => Object.assign({}, c, { note: v }));
              }}
              className="gmaField w-full rounded-sm px-3 py-2 text-base"
              style={Object.assign({}, editorInput, { color: C.muted })}
            />
          </div>
        </div>

        <div className="mt-9 space-y-4">
          <Button onClick={closeEditor} disabled={!total}>
            Done editing
          </Button>
          {total ? null : (
            <p className="text-center" style={{ fontFamily: SERIF, fontSize: "0.85rem", color: C.rose }}>
              Add at least one question before you go back.
            </p>
          )}
          <Button
            tone="quiet"
            onClick={() => {
              if (confirmReset) {
                resetEverything();
                setConfirmReset(false);
              } else {
                setConfirmReset(true);
              }
            }}
          >
            {confirmReset ? "Tap again to restore the printed card" : "Reset to the printed card"}
          </Button>
        </div>
      </div>
    </Frame>
  );

  /* ---------------- render ---------------- */

  let body = titleScreen;
  if (screen === "rules") body = rulesScreen;
  else if (screen === "roundIntro") body = roundIntroScreen;
  else if (screen === "question") body = questionScreen;
  else if (screen === "handoff") body = handoffScreen;
  else if (screen === "reveal") body = revealScreen;
  else if (screen === "final") body = finalScreen;
  else if (screen === "editor") body = editorScreen;

  if (screen === "roundIntro") {
    return (
      <div className="gmaRoot w-full" style={{ backgroundColor: C.bg, color: C.ink, minHeight: "var(--gmaVh)" }}>
        <style>{STYLE_SHEET}</style>
        <div key={"intro-" + qIndex}>{body}</div>
      </div>
    );
  }

  return (
    <div
      className="gmaRoot w-full px-3 py-5 sm:px-6 sm:py-10"
      style={{
        backgroundColor: C.bg,
        color: C.ink,
        minHeight: "var(--gmaVh)",
        paddingLeft: "calc(0.75rem + var(--gmaSafeLeft))",
        paddingRight: "calc(0.75rem + var(--gmaSafeRight))",
        paddingBottom: "calc(1.25rem + var(--gmaSafeBottom))",
      }}
    >
      <style>{STYLE_SHEET}</style>
      <div className="mx-auto w-full max-w-md">
        <div key={screen + "-" + qIndex + "-" + turn}>{body}</div>
      </div>
    </div>
  );
}
