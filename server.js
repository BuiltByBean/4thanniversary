import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createRoom, joinRoom, getRoom, seatOf, viewForSeat,
  submitAnswer, judgeRoom, overrideVerdict, advance, playAgain,
  updateConfig, roomCount,
} from "./rooms.js";
import { JUDGE_MODEL as DEFAULT_JUDGE_MODEL } from "./src/matching.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;

// The judge model is pinned here, not taken from the client, so this endpoint
// can never be repurposed as a general-purpose API proxy by anyone who
// stumbles onto the URL.
const JUDGE_MODEL = process.env.JUDGE_MODEL || DEFAULT_JUDGE_MODEL;
const MAX_PROMPT_CHARS = 4000;

app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

app.get("/healthz", (req, res) => {
  res.status(200).json({
    ok: true,
    judge: Boolean(process.env.ANTHROPIC_API_KEY),
    rooms: roomCount(),
  });
});

/** Calls Anthropic with the server's key. Throws so the engine falls back. */
async function sendToJudge(body) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("no_api_key");
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      max_tokens: 1000,
      messages: body.messages,
    }),
  });
  if (!upstream.ok) throw new Error("judge_status_" + upstream.status);
  return await upstream.json();
}

/* ------------------------------------------------------------------ *
 *  Solo mode: the browser judges, and posts here only to borrow the key.
 * ------------------------------------------------------------------ */
app.post("/api/judge", async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "no_api_key" });
  const messages = Array.isArray(req.body && req.body.messages) ? req.body.messages : [];
  const prompt = messages.length === 1 && typeof messages[0].content === "string"
    ? messages[0].content
    : null;
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
    return res.status(400).json({ error: "bad_request" });
  }
  try {
    const data = await sendToJudge({ messages: [{ role: "user", content: prompt }] });
    return res.status(200).json(data);
  } catch (err) {
    return res.status(502).json({ error: "judge_unreachable" });
  }
});

/* ------------------------------------------------------------------ *
 *  Room mode: two phones, the server referees.
 * ------------------------------------------------------------------ */

/** Resolves the room and the caller's seat, or answers the request itself. */
function withSeat(req, res) {
  const room = getRoom(req.params.code);
  if (!room) {
    res.status(404).json({ error: "no_such_room" });
    return null;
  }
  const token = (req.body && req.body.token) || req.query.token;
  const seat = seatOf(room, token);
  if (seat === -1) {
    res.status(403).json({ error: "not_in_room" });
    return null;
  }
  return { room, seat };
}

app.post("/api/room", (req, res) => {
  const c = req.body || {};
  if (!Array.isArray(c.questions) || !Array.isArray(c.rounds) || !Array.isArray(c.names)) {
    return res.status(400).json({ error: "bad_config" });
  }
  const created = createRoom({
    names: c.names,
    rounds: c.rounds,
    questions: c.questions,
    rules: Array.isArray(c.rules) ? c.rules : [],
    closing: c.closing || { text: "", note: "" },
  });
  res.status(201).json(created);
});

app.post("/api/room/:code/join", (req, res) => {
  const result = joinRoom(req.params.code, req.body && req.body.token);
  if (result.error) {
    return res.status(result.error === "no_such_room" ? 404 : 409).json(result);
  }
  res.status(200).json(result);
});

app.get("/api/room/:code", (req, res) => {
  const ctx = withSeat(req, res);
  if (!ctx) return undefined;
  res.status(200).json(viewForSeat(ctx.room, ctx.seat));
});

app.post("/api/room/:code/submit", async (req, res) => {
  const ctx = withSeat(req, res);
  if (!ctx) return undefined;
  const result = submitAnswer(ctx.room, ctx.seat, req.body.answer, req.body.guess);
  if (result.error) return res.status(409).json(result);

  // Answer the phone immediately; judging happens behind the poll.
  res.status(200).json(viewForSeat(ctx.room, ctx.seat));
  if (result.bothIn) {
    judgeRoom(ctx.room, sendToJudge).catch(() => {});
  }
  return undefined;
});

app.post("/api/room/:code/override", (req, res) => {
  const ctx = withSeat(req, res);
  if (!ctx) return undefined;
  const result = overrideVerdict(ctx.room, req.body.which);
  if (result.error) return res.status(409).json(result);
  res.status(200).json(viewForSeat(ctx.room, ctx.seat));
});

app.post("/api/room/:code/next", (req, res) => {
  const ctx = withSeat(req, res);
  if (!ctx) return undefined;
  const result = advance(ctx.room);
  if (result.error) return res.status(409).json(result);
  res.status(200).json(viewForSeat(ctx.room, ctx.seat));
});

app.post("/api/room/:code/again", (req, res) => {
  const ctx = withSeat(req, res);
  if (!ctx) return undefined;
  playAgain(ctx.room);
  res.status(200).json(viewForSeat(ctx.room, ctx.seat));
});

app.post("/api/room/:code/config", (req, res) => {
  const ctx = withSeat(req, res);
  if (!ctx) return undefined;
  const result = updateConfig(ctx.room, ctx.seat, req.body || {});
  if (result.error) return res.status(403).json(result);
  res.status(200).json(viewForSeat(ctx.room, ctx.seat));
});

/* ------------------------------------------------------------------ */

const dist = path.join(__dirname, "dist");
app.use(express.static(dist, { index: false, maxAge: "1h" }));

// Single page app: everything else gets index.html.
app.use((req, res) => {
  res.sendFile(path.join(dist, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Guess My Answer listening on 0.0.0.0:" + PORT);
});
