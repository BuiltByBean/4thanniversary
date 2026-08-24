import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;

// The judge model is pinned here, not taken from the client, so this endpoint
// can never be repurposed as a general-purpose API proxy by anyone who
// stumbles onto the URL.
const JUDGE_MODEL = process.env.JUDGE_MODEL || "claude-sonnet-4-6";
const MAX_PROMPT_CHARS = 4000;

app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));

app.get("/healthz", (req, res) => {
  res.status(200).json({ ok: true, judge: Boolean(process.env.ANTHROPIC_API_KEY) });
});

/**
 * Tier 3 of the matching engine. The browser cannot call the Anthropic API
 * directly (no key, and CORS would block it anyway), so it posts here and the
 * server signs the request. If the key is missing the client quietly falls
 * back to its offline Dice scoring, so the game still finishes.
 */
app.post("/api/judge", async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(503).json({ error: "no_api_key" });
  }

  const messages = Array.isArray(req.body && req.body.messages) ? req.body.messages : [];
  const prompt = messages.length === 1 && typeof messages[0].content === "string"
    ? messages[0].content
    : null;
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
    return res.status(400).json({ error: "bad_request" });
  }

  try {
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
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (err) {
    return res.status(502).json({ error: "judge_unreachable" });
  }
});

const dist = path.join(__dirname, "dist");
app.use(express.static(dist, { index: false, maxAge: "1h" }));

// Single page app: everything else gets index.html.
app.use((req, res) => {
  res.sendFile(path.join(dist, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Guess My Answer listening on 0.0.0.0:" + PORT);
});
