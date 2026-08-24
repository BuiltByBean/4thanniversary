/* ==================================================================== *
 *  ROOMS — two phones, one game
 *
 *  The server is the referee. It holds the room, gates the reveal until both
 *  players have locked in, and runs the judge exactly once so both phones see
 *  the same verdict.
 *
 *  The rule this file exists to enforce: a player never receives their
 *  partner's answer before they have committed their own. Everything a client
 *  sees goes through viewForSeat(), which redacts by phase. Nothing else in
 *  the codebase is allowed to serialise a room.
 * ==================================================================== */

import { evaluateBoth } from "./src/matching.js";

// No I, O, 0 or 1 — these get read aloud across a table.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_TTL_MS = 12 * 60 * 60 * 1000; // a room outlives one long evening
const MAX_ROOMS = 200;

const rooms = new Map();

function makeCode() {
  let code = "";
  for (let i = 0; i < 4; i += 1) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

function makeToken() {
  let t = "";
  for (let i = 0; i < 24; i += 1) {
    t += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return t;
}

function sweep() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.lastSeen > ROOM_TTL_MS) rooms.delete(code);
  }
}

/** Play order: rounds in order, then the questions inside each round. */
function playList(room) {
  const out = [];
  for (const r of room.rounds) {
    for (const q of room.questions) if (q.round === r.id) out.push(q);
  }
  for (const q of room.questions) {
    if (!room.rounds.some((r) => r.id === q.round)) out.push(q);
  }
  return out;
}

const effective = (v) => (v ? (v.flipped ? !v.match : v.match) : false);

function scoresOf(room) {
  let a = 0;
  let b = 0;
  for (const rec of room.records) {
    if (!rec) continue;
    if (effective(rec.vB)) a += 1;
    if (effective(rec.vA)) b += 1;
  }
  return [a, b];
}

function touch(room) {
  room.version += 1;
  room.lastSeen = Date.now();
}

export function createRoom(config) {
  sweep();
  if (rooms.size >= MAX_ROOMS) {
    // Oldest first, so a flood can never lock out a real game.
    const oldest = [...rooms.entries()].sort((x, y) => x[1].lastSeen - y[1].lastSeen)[0];
    if (oldest) rooms.delete(oldest[0]);
  }
  let code = makeCode();
  while (rooms.has(code)) code = makeCode();

  const room = {
    code,
    createdAt: Date.now(),
    lastSeen: Date.now(),
    version: 1,
    phase: "lobby",
    qIndex: 0,
    names: config.names,
    rounds: config.rounds,
    questions: config.questions,
    rules: config.rules,
    closing: config.closing,
    tokens: [makeToken(), null],
    submissions: [null, null],
    records: [],
    judging: false,
  };
  rooms.set(code, room);
  return { code, seat: 0, token: room.tokens[0] };
}

export function joinRoom(code, token) {
  sweep();
  const room = rooms.get(String(code || "").toUpperCase());
  if (!room) return { error: "no_such_room" };

  // A refresh comes back with a token it already owns; let it resume its seat.
  if (token) {
    const seat = room.tokens.indexOf(token);
    if (seat !== -1) return { code: room.code, seat, token };
  }
  if (room.tokens[1]) return { error: "room_full" };

  room.tokens[1] = makeToken();
  if (room.phase === "lobby") room.phase = "answering";
  touch(room);
  return { code: room.code, seat: 1, token: room.tokens[1] };
}

export function getRoom(code) {
  const room = rooms.get(String(code || "").toUpperCase());
  if (room) room.lastSeen = Date.now();
  return room || null;
}

export function seatOf(room, token) {
  if (!token) return -1;
  return room.tokens.indexOf(token);
}

/**
 * The only way a room reaches a client.
 *
 * While the current question is still being answered, a seat learns exactly
 * one thing about the other seat: whether they have locked in. Not their
 * answer, not their guess, not the length of either.
 */
export function viewForSeat(room, seat) {
  const list = playList(room);
  const revealing = room.phase === "reveal" || room.phase === "final";
  const mine = seat === 0 || seat === 1 ? room.submissions[seat] : null;

  return {
    code: room.code,
    version: room.version,
    phase: room.phase,
    qIndex: room.qIndex,
    total: list.length,
    seat,
    names: room.names,
    rounds: room.rounds,
    questions: room.questions,
    rules: room.rules,
    closing: room.closing,
    partnerJoined: Boolean(room.tokens[1]),
    // Presence only. Never the text.
    submitted: [Boolean(room.submissions[0]), Boolean(room.submissions[1])],
    yourSubmission: mine ? { answer: mine.answer, guess: mine.guess } : null,
    scores: scoresOf(room),
    // Past questions are already revealed to both, so they are safe to send.
    records: room.records.slice(0, revealing ? room.records.length : room.qIndex),
  };
}

export function submitAnswer(room, seat, answer, guess) {
  if (room.phase !== "answering") return { error: "not_answering" };
  if (seat !== 0 && seat !== 1) return { error: "bad_seat" };
  if (room.submissions[seat]) return { error: "already_submitted" };
  const a = String(answer || "").trim();
  const g = String(guess || "").trim();
  if (!a || !g) return { error: "incomplete" };
  if (a.length > 500 || g.length > 500) return { error: "too_long" };

  room.submissions[seat] = { answer: a, guess: g };
  touch(room);

  if (room.submissions[0] && room.submissions[1]) {
    room.phase = "judging";
    touch(room);
    return { ok: true, bothIn: true };
  }
  return { ok: true, bothIn: false };
}

/** Runs once per question. Called by the server after the second submission. */
export async function judgeRoom(room, sendToJudge) {
  if (room.judging) return;
  room.judging = true;
  const list = playList(room);
  const question = list[room.qIndex];
  const entries = [room.submissions[0], room.submissions[1]];

  let verdicts;
  try {
    verdicts = await evaluateBoth(question, room.names, entries, sendToJudge);
  } catch (err) {
    const offline = { match: false, reason: "Judged offline.", tier: "offline", dice: 0, flipped: false };
    verdicts = { vA: { ...offline }, vB: { ...offline } };
  }

  room.records[room.qIndex] = {
    qId: question.id,
    text: question.text,
    a0: entries[0].answer,
    g0: entries[0].guess,
    a1: entries[1].answer,
    g1: entries[1].guess,
    vA: verdicts.vA,
    vB: verdicts.vB,
  };
  room.phase = "reveal";
  room.judging = false;
  touch(room);
}

export function overrideVerdict(room, which) {
  if (which !== "vA" && which !== "vB") return { error: "bad_verdict" };
  const rec = room.records[room.qIndex];
  if (!rec || !rec[which]) return { error: "nothing_to_flip" };
  rec[which] = { ...rec[which], flipped: !rec[which].flipped };
  touch(room);
  return { ok: true };
}

export function advance(room) {
  if (room.phase !== "reveal") return { error: "not_revealing" };
  const list = playList(room);
  if (room.qIndex + 1 >= list.length) {
    room.phase = "final";
  } else {
    room.qIndex += 1;
    room.submissions = [null, null];
    room.phase = "answering";
  }
  touch(room);
  return { ok: true };
}

export function playAgain(room) {
  room.qIndex = 0;
  room.records = [];
  room.submissions = [null, null];
  room.phase = room.tokens[1] ? "answering" : "lobby";
  touch(room);
  return { ok: true };
}

/** Host edits the question set. Lobby only — mid-game edits would shift indices. */
export function updateConfig(room, seat, config) {
  if (seat !== 0) return { error: "not_host" };
  if (room.phase !== "lobby" && room.phase !== "answering") return { error: "in_progress" };
  if (room.records.length) return { error: "in_progress" };
  if (config.names) room.names = config.names;
  if (config.rounds) room.rounds = config.rounds;
  if (config.questions) room.questions = config.questions;
  if (config.rules) room.rules = config.rules;
  if (config.closing) room.closing = config.closing;
  touch(room);
  return { ok: true };
}

export function roomCount() {
  return rooms.size;
}
