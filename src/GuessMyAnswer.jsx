import React, { useState, useEffect, useRef, useMemo } from "react";
import { evaluateBoth } from "./matching.js";

/* ==================================================================== *
 *  GUESS MY ANSWER — The Fourth Anniversary Edition
 *  Michael & Hannah Bean
 *
 *  EVERYTHING WORTH EDITING LIVES IN THIS BLOCK.
 *  (It is all editable from inside the app too: "Edit the questions".)
 * ==================================================================== */

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
  { id: "r2", name: "Round Two", subtitle: "now it gets personal" },
  { id: "r3", name: "Round Three", subtitle: "money, dreams and bad ideas" },
];

// mode: "numeric" scores by closeness (within 25%) instead of by meaning.
const DEFAULT_QUESTIONS = [
  { id: "q1", round: "r1", text: "Which thing I bought did you call a waste and now use more than I do?" },
  { id: "q2", round: "r1", text: "What is my tell when I am annoyed and pretending not to be?" },
  { id: "q3", round: "r1", text: "One restaurant for the rest of my life. Which one am I picking?" },
  { id: "q4", round: "r1", text: "What is my guilty-pleasure show — the one I would deny watching?" },
  { id: "q5", round: "r1", text: "What does Kiya do that is one hundred percent me?" },
  { id: "q6", round: "r2", text: "My most annoying habit. Be specific. “Everything” is not a point." },
  { id: "q7", round: "r2", text: "If you could delete one of my hobbies, which one goes first?" },
  { id: "q8", round: "r2", text: "What do I always say I am going to do and never actually do?" },
  { id: "q9", round: "r2", text: "Which piece of my clothing would you throw out tonight if you could?" },
  { id: "q10", round: "r2", text: "What is my most overused phrase?" },
  { id: "q11", round: "r3", text: "Anywhere in the world, money is no object. Where am I taking you?" },
  { id: "q12", round: "r3", text: "We win the lottery tomorrow. What do I buy first?" },
  { id: "q13", round: "r3", text: "Dinner with anyone, alive or dead. Who am I picking?" },
  { id: "q14", round: "r3", text: "What is my comfort meal after a genuinely terrible day?" },
  { id: "q15", round: "r3", text: "The house is on fire and Kiya is already outside. What do I grab?" },
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
 *  REACHING THE JUDGE FROM THE BROWSER
 *
 *  The matching engine itself lives in ./matching.js so the server can run
 *  byte-identical code in room mode. All this adds is how the browser gets to
 *  the judge: the same-origin proxy first (deployed), then the API directly
 *  (which is how it works pasted into a Claude artifact).
 * ==================================================================== */

async function sendToJudgeFromBrowser(body) {
  try {
    const proxied = await fetch("/api/judge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (proxied.ok) return await proxied.json();
  } catch (err) {
    // No server here. Try the direct route instead.
  }
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("Judge responded " + response.status);
  return await response.json();
}

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
      else setShown(value);
    };
    raf = requestAnimationFrame(step);
    // A locked or backgrounded phone stops running animation frames entirely,
    // which would leave the score frozen on the old number. Timers still fire,
    // so this lands the real value whether or not the animation ever ran.
    const guard = setTimeout(() => setShown(value), duration + 60);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(guard);
    };
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
  // Solo state. In room mode the server owns the equivalents and these become
  // the host's editing scratchpad, pushed up as config.
  const [soloNames, setNames] = useState(DEFAULT_NAMES);
  const [soloRounds, setRounds] = useState(DEFAULT_ROUNDS);
  const [soloQuestions, setQuestions] = useState(DEFAULT_QUESTIONS);
  const [soloRules, setRules] = useState(DEFAULT_RULES);
  const [soloClosing, setClosing] = useState(DEFAULT_CLOSING);

  // Two phones, one game. creds identify this seat; room is the latest view
  // the server sent us, already redacted for whichever seat we are.
  const [mode, setMode] = useState("solo");
  const [creds, setCreds] = useState(null);
  const [room, setRoom] = useState(null);
  const [roomError, setRoomError] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [introFor, setIntroFor] = useState(null);
  const introShown = useRef(new Set());

  const [screen, setScreen] = useState("title");
  const [returnScreen, setReturnScreen] = useState("title");
  const [soloQIndex, setQIndex] = useState(0);
  const [turn, setTurn] = useState(0);
  const [pending, setPending] = useState([null, null]);
  const [draft, setDraft] = useState({ answer: "", guess: "" });
  const [masked, setMasked] = useState({ answer: true, guess: true });
  const [soloRecords, setRecords] = useState([]);
  const [soloJudging, setJudging] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [secretOut, setSecretOut] = useState(false);

  const judgeToken = useRef(0);
  const [judgeReady, setJudgeReady] = useState(false);
  const answerRef = useRef(null);
  const guessRef = useRef(null);

  const inRoom = mode === "room" && Boolean(room);
  const names = inRoom ? room.names : soloNames;
  const rounds = inRoom ? room.rounds : soloRounds;
  const questions = inRoom ? room.questions : soloQuestions;
  const rules = inRoom ? room.rules : soloRules;
  const closing = inRoom ? room.closing : soloClosing;
  const qIndex = inRoom ? room.qIndex : soloQIndex;
  const records = inRoom ? room.records : soloRecords;
  const mySeat = inRoom ? room.seat : 0;
  const judging = inRoom ? room.phase === "judging" : soloJudging;

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

  const localScores = useMemo(() => {
    let a = 0;
    let b = 0;
    soloRecords.forEach((rec) => {
      if (!rec) return;
      if (effective(rec.vB)) a += 1; // player one read player two correctly
      if (effective(rec.vA)) b += 1; // player two read player one correctly
    });
    return [a, b];
  }, [soloRecords]);
  const scores = inRoom ? room.scores : localScores;

  const record = records[qIndex] || null;
  const partnerOf = (i) => names[i === 0 ? 1 : 0];
  const turnSeat = inRoom ? mySeat : turn;

  /* ---------------- two phones ---------------- */

  const roomFetch = async (path, options) => {
    const res = await fetch(path, options);
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || "request_failed");
    return data;
  };

  const configPayload = () => ({
    names: soloNames,
    rounds: soloRounds,
    questions: soloQuestions,
    rules: soloRules,
    closing: soloClosing,
  });

  const hostRoom = async () => {
    setBusy(true);
    setRoomError("");
    try {
      const made = await roomFetch("/api/room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configPayload()),
      });
      introShown.current = new Set();
      clearDraft(false);
      setCreds(made);
      setMode("room");
      setScreen("lobby");
    } catch (err) {
      setRoomError("Could not open a room. Is the game online?");
    }
    setBusy(false);
  };

  const enterRoom = async () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 4) {
      setRoomError("Room codes are four characters.");
      return;
    }
    setBusy(true);
    setRoomError("");
    try {
      const got = await roomFetch("/api/room/" + code + "/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      introShown.current = new Set();
      clearDraft(false);
      setCreds(got);
      setMode("room");
      setScreen("lobby");
    } catch (err) {
      const why = err && err.message;
      setRoomError(
        why === "room_full" ? "That room already has two players."
          : why === "no_such_room" ? "No room with that code."
          : "Could not join. Check the code and try again."
      );
    }
    setBusy(false);
  };

  const roomAction = async (path, body) => {
    if (!creds) return;
    try {
      const next = await roomFetch("/api/room/" + creds.code + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ token: creds.token }, body || {})),
      });
      setRoom(next);
    } catch (err) {
      // Whatever went wrong, the next poll reconciles us with the server.
    }
  };

  const leaveRoom = () => {
    setCreds(null);
    setRoom(null);
    setMode("solo");
    setRoomError("");
    setJoinCode("");
    introShown.current = new Set();
    setIntroFor(null);
    setScreen("title");
  };

  /* ---------------- flow ---------------- */

  const startsNewRound = (i) => {
    if (i === 0) return true;
    const prev = playList[i - 1];
    const now = playList[i];
    return !prev || !now || prev.round !== now.round;
  };

  const clearDraft = (hidden) => {
    setDraft({ answer: "", guess: "" });
    const hide = hidden === undefined ? !inRoom : hidden;
    setMasked({ answer: hide, guess: hide });
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

    let verdicts;
    try {
      verdicts = await evaluateBoth(q, names, entries, judgeReady ? sendToJudgeFromBrowser : null);
    } catch (err) {
      const offline = { match: false, reason: "Judged offline.", tier: "offline", dice: 0, flipped: false };
      verdicts = { vA: { ...offline }, vB: { ...offline } };
    }

    if (token !== judgeToken.current) return;
    setRecords((prev) => {
      const next = prev.slice();
      const base = next[index];
      if (!base) return prev;
      next[index] = Object.assign({}, base, { vA: verdicts.vA, vB: verdicts.vB });
      return next;
    });
    setJudging(false);
  };

  const canSubmit = draft.answer.trim().length > 0 && draft.guess.trim().length > 0;

  const submitTurn = () => {
    if (!canSubmit) return;
    const entry = { answer: draft.answer.trim(), guess: draft.guess.trim() };
    if (inRoom) {
      roomAction("/submit", entry);
      clearDraft();
      return;
    }
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
    if (inRoom) {
      roomAction("/next");
      return;
    }
    const i = soloQIndex + 1;
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
    setSecretOut(false);
    if (inRoom) {
      introShown.current = new Set();
      setIntroFor(null);
      roomAction("/again");
      return;
    }
    setRecords([]);
    setQIndex(0);
    setTurn(0);
    setPending([null, null]);
    clearDraft();
    setJudging(false);
    setScreen("title");
  };

  const flip = (which) => {
    if (inRoom) {
      roomAction("/override", { which: which });
      return;
    }
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
    if (inRoom) {
      // The host edited the book; the room is the source of truth from here.
      roomAction("/config", configPayload());
      setScreen("lobby");
      return;
    }
    setQIndex((i) => Math.max(0, Math.min(i, Math.max(0, playList.length - 1))));
    setScreen(returnScreen);
  };

  let active = screen;
  if (inRoom && screen !== "editor") {
    if (room.phase === "lobby") active = "lobby";
    else if (introFor !== null) active = "roundIntro";
    else if (room.phase === "answering") active = room.submitted[mySeat] ? "waiting" : "question";
    else if (room.phase === "judging" || room.phase === "reveal") active = "reveal";
    else if (room.phase === "final") active = "final";
  }

  // One probe at startup. No key configured means the built-in matcher
  // decides everything, instantly and offline.
  useEffect(() => {
    let alive = true;
    fetch("/healthz")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && d.judge === true) setJudgeReady(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  /* ---------------- timers & keyboard ---------------- */

  // Short polling, deliberately. A phone that locks its screen kills a socket
  // or an event stream and needs reconnect logic; a poll just resumes.
  useEffect(() => {
    if (!creds) return undefined;
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/room/" + creds.code + "?token=" + creds.token);
        if (!res.ok) return;
        const data = await res.json();
        if (alive) setRoom(data);
      } catch (err) {
        // Lost signal. The next tick picks it back up.
      }
    };
    tick();
    const id = setInterval(tick, 1200);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [creds]);

  // Both phones show the round card at the same moment.
  const roomPhase = room ? room.phase : null;
  const roomQIndex = room ? room.qIndex : null;
  useEffect(() => {
    if (!inRoom || roomPhase !== "answering") return undefined;
    if (introShown.current.has(roomQIndex)) return undefined;
    introShown.current.add(roomQIndex);
    const prev = playList[roomQIndex - 1];
    const now = playList[roomQIndex];
    const fresh = roomQIndex === 0 || (prev && now && prev.round !== now.round);
    if (!fresh) return undefined;
    setIntroFor(roomQIndex);
    const t = setTimeout(() => setIntroFor(null), 2100);
    return () => clearTimeout(t);
  }, [inRoom, roomPhase, roomQIndex]);

  useEffect(() => {
    if (screen !== "roundIntro") return undefined;
    const t = setTimeout(() => setScreen("question"), 2100);
    return () => clearTimeout(t);
  }, [screen, qIndex]);

  useEffect(() => {
    if (screen !== "question" && !(inRoom && roomPhase === "answering")) return undefined;
    const t = setTimeout(() => {
      if (answerRef.current) answerRef.current.focus();
    }, 80);
    return () => clearTimeout(t);
  }, [screen, turn, qIndex, inRoom, roomPhase]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Enter") return;
      const tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (active === "rules") startRoundOne();
      else if (active === "roundIntro" && !inRoom) setScreen("question");
      else if (active === "handoff") takeSecondTurn();
      else if (active === "reveal" && !judging) nextQuestion();
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
            Begin on this phone
          </Button>
          {total ? null : (
            <p className="mt-3" style={{ fontFamily: SERIF, fontSize: "0.85rem", color: C.rose }}>
              There are no questions yet. Add some first.
            </p>
          )}
          <div className="mt-4">
            <Button tone="ghost" onClick={hostRoom} disabled={!total || busy}>
              {busy ? "Opening…" : "Play on two phones"}
            </Button>
          </div>

          <Heart className="mt-8" />

          <div className="mt-8 text-left">
            <Label className="mb-2">Joining a room?</Label>
            <div className="flex gap-2">
              <input
                type="text"
                value={joinCode}
                placeholder="CODE"
                maxLength={4}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => {
                  setRoomError("");
                  setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    enterRoom();
                  }
                }}
                className="gmaField w-full rounded-sm px-3 py-3 text-center"
                style={{
                  fontFamily: SERIF,
                  letterSpacing: "0.4em",
                  color: C.ink,
                  backgroundColor: C.bg,
                  border: "1px solid " + C.rule,
                }}
              />
              <div style={{ flex: "0 0 auto", width: "40%" }}>
                <Button tone="ghost" onClick={enterRoom} disabled={busy || joinCode.length !== 4}>
                  Join
                </Button>
              </div>
            </div>
          </div>

          {roomError ? (
            <p className="gmaWrap mt-4" style={{ fontFamily: SERIF, fontSize: "0.9rem", color: C.rose }}>
              {roomError}
            </p>
          ) : null}

          <div className="mt-6">
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
      onClick={() => { if (!inRoom) setScreen("question"); }}
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
            {inRoom ? "Your" : names[turnSeat] + "’s"} turn
          </div>
          <p className="gmaWrap mt-2" style={{ fontFamily: SERIF, fontSize: "0.9rem", lineHeight: 1.5, color: C.muted }}>
            {inRoom
              ? partnerOf(mySeat) + " sees none of this until you have both locked in."
              : "Keep the screen to yourself. Both boxes stay hidden as you type."}
          </p>
          {inRoom && room.submitted[mySeat === 0 ? 1 : 0] ? (
            <div className="gmaFade mt-4 flex items-center justify-center gap-2">
              <span style={{ color: C.rose, fontSize: "0.7rem", lineHeight: 1 }}>&#9829;</span>
              <span
                style={{
                  fontFamily: SANS,
                  fontSize: "0.65rem",
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: C.rose,
                }}
              >
                {partnerOf(mySeat)} has locked in
              </span>
            </div>
          ) : null}
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
            label={"What will " + partnerOf(turnSeat) + " say?"}
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
            <div className="mt-5">
              <Button tone="ghost" onClick={() => flip(which)}>
                {v.flipped
                  ? "Undo — put it back"
                  : matched
                    ? "Actually, not a match"
                    : "Actually, call it a match"}
              </Button>
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
    let secret;
    if (scores[0] === scores[1]) {
      headline = "A dead tie.";
      warm =
        "Four years of paying attention, split straight down the middle. Nobody has to win this one.";
      secret =
        "A tie is the correct answer anyway. Four years each, both of you winning the whole time.";
    } else {
      const firstWon = scores[0] > scores[1];
      const winner = firstWon ? names[0] : names[1];
      const other = firstWon ? names[1] : names[0];
      headline = winner + " was paying closer attention.";
      warm =
        other +
        ", the ones you missed are the ones worth talking about tonight. That is the whole point of the game.";
      secret = firstWon
        ? "Actually, " + names[1] + " — you are the winner. You got to be married to me for four years."
        : "But the real winner is " + names[0] + ", who got to be married to you for four years.";
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

          {secretOut ? (
            <div className="gmaFade mt-9">
              <Heart />
              <p
                className="gmaWrap mx-auto mt-7 max-w-sm"
                style={{
                  fontFamily: SERIF,
                  fontStyle: "italic",
                  fontSize: "1.2rem",
                  lineHeight: 1.6,
                  color: C.rose,
                }}
              >
                {secret}
              </p>
            </div>
          ) : (
            <div className="mt-9">
              <Button tone="quiet" onClick={() => setSecretOut(true)}>
                <span className="gmaPulse">&#9829;&nbsp; one more thing</span>
              </Button>
            </div>
          )}

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
    if (soloQuestions.some((q) => q.round === id)) return;
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
            {soloRules.map((rule, i) => (
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

        {soloRounds.map((round, ri) => {
          const mine = soloQuestions.filter((q) => q.round === round.id);
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
                        {soloRounds.map((r) => (
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
              value={soloClosing.text}
              onChange={(e) => {
                const v = e.target.value;
                setClosing((c) => Object.assign({}, c, { text: v }));
              }}
              className="gmaField w-full rounded-sm px-3 py-2 text-base"
              style={Object.assign({}, editorInput, { fontStyle: "italic" })}
            />
            <input
              type="text"
              value={soloClosing.note}
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
          <Button onClick={closeEditor} disabled={!soloQuestions.length}>
            Done editing
          </Button>
          {soloQuestions.length ? null : (
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

  const lobbyScreen = (
    <Frame>
      <div className="gmaFade text-center">
        <Label>{mySeat === 0 ? "Your room is open" : "You are in"}</Label>
        <div
          className="mx-auto mt-7 rounded-sm px-4 py-6"
          style={{ backgroundColor: C.panel, border: "1px solid " + C.rule }}
        >
          <Label>Room code</Label>
          <div
            className="mt-3"
            style={{
              fontFamily: SERIF,
              fontSize: "3rem",
              lineHeight: 1,
              letterSpacing: "0.28em",
              textIndent: "0.28em",
              color: C.ink,
            }}
          >
            {creds ? creds.code : ""}
          </div>
        </div>

        <Heart className="mt-8" />

        <p
          className="gmaWrap mx-auto mt-8 max-w-sm"
          style={{ fontFamily: SERIF, fontSize: "1.05rem", lineHeight: 1.6, color: C.ink }}
        >
          {mySeat === 0
            ? "Read this code to " + names[1] + ". On their phone they type it under “Joining a room?” and the game starts by itself."
            : "Waiting for the game to begin."}
        </p>

        <div className="mt-8 flex items-center justify-center gap-2">
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
            Waiting for {names[1]}
          </span>
        </div>

        <div className="mt-10 space-y-4">
          {mySeat === 0 ? (
            <Button tone="ghost" onClick={openEditor}>
              Edit the questions first
            </Button>
          ) : null}
          <Button tone="quiet" onClick={leaveRoom}>
            Leave the room
          </Button>
        </div>
      </div>
    </Frame>
  );

  const waitingScreen = (
    <Frame>
      {scoreboard}
      <div className="gmaFade py-8 text-center">
        <Label>Locked in</Label>
        <h2
          className="gmaWrap mt-6 text-4xl sm:text-5xl"
          style={{ fontFamily: SERIF, fontStyle: "italic", lineHeight: 1.15, color: C.ink }}
        >
          Waiting for {partnerOf(mySeat)}
        </h2>
        <Heart className="mt-8" />
        <p
          className="gmaWrap mx-auto mt-8 max-w-sm"
          style={{ fontFamily: SERIF, fontSize: "1rem", lineHeight: 1.6, color: C.muted }}
        >
          Yours is in and sealed. Nothing shows on either screen until you have
          both written something down.
        </p>
        <div className="mt-8 flex items-center justify-center gap-2">
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
            {partnerOf(mySeat) + " is still writing"}
          </span>
        </div>
      </div>
    </Frame>
  );

  /* ---------------- render ---------------- */

  let body = titleScreen;
  if (active === "rules") body = rulesScreen;
  else if (active === "roundIntro") body = roundIntroScreen;
  else if (active === "question") body = questionScreen;
  else if (active === "handoff") body = handoffScreen;
  else if (active === "reveal") body = revealScreen;
  else if (active === "final") body = finalScreen;
  else if (active === "editor") body = editorScreen;
  else if (active === "lobby") body = lobbyScreen;
  else if (active === "waiting") body = waitingScreen;

  if (active === "roundIntro") {
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
        <div key={active + "-" + qIndex + "-" + turn}>{body}</div>
      </div>
    </div>
  );
}
