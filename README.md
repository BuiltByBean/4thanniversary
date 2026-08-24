# Guess My Answer

A two-player guessing game for one phone passed back and forth.
The fourth anniversary edition — Michael & Hannah Bean, August 24, 2026.

Each question, both players write two things: their own honest answer, and
what they think their partner is going to write. You score when *your guess*
matches *their answer*. Two points are available per question, and nobody
scores for their own answer.

## Running it

```bash
npm install
npm run dev
```

`npm run dev` binds to `0.0.0.0`, so a phone on the same wifi can reach it at
`http://<your-laptop-ip>:5173`.

For the production shape (built assets served by the same Node process that
proxies the judge):

```bash
npm run build && npm start
```

## Deploying on Railway

The repo already carries `railway.json` and a `Procfile`, matching the
convention used in Data-Dungeon and KuperPlumbing: Nixpacks builder,
`/healthz` health check, restart on failure up to 5 times.

1. New Project → Deploy from GitHub repo → `BuiltByBean/4thanniversary`.
2. Nixpacks detects Node, runs `npm ci` then `npm run build`, and starts
   `node server.js`. No build config needed.
3. Add one variable under **Variables**:

   | Variable            | Value                        |
   | ------------------- | ---------------------------- |
   | `ANTHROPIC_API_KEY` | your key from console.anthropic.com |

4. Networking → Generate Domain.

`PORT` is provided by Railway and read automatically. `JUDGE_MODEL` is
optional and defaults to `claude-sonnet-4-6`.

Check `/healthz` after deploy — it returns `{"ok":true,"judge":true}` once the
key is set. `"judge":false` means the key is missing and the game will score
with the offline fallback instead.

## How answers get scored

Answers are short free text and almost never match literally. "not hanging the
kitchen towel up" and "leaving the kitchen towel out" are the same complaint
and have to score. Three tiers run in order, stopping at the first confident
result:

**Tier 1 — normalize and compare.** `normalize()` lowercases, expands
contractions, strips leading filler ("i think", "probably"), strips
punctuation, drops a stopword list, and applies a light regex stemmer.
Identical results are a match — unless the two sides disagree about negation,
which drops through to tier 3. (`never` is a stopword, so without that guard
"he never apologizes first" and "he apologizes first" would normalize
identically and score.)

**Tier 2 — token overlap.** Dice coefficient over the normalized token sets,
plus a negation flag per side. `>= 0.6` with negation agreeing is a match;
`<= 0.15` is not; anything between, or any negation disagreement, goes to
tier 3.

**Tier 3 — Claude judges.** The question and both texts go to
`claude-sonnet-4-6`, which returns `{"match": bool, "reason": string}`. It is
told to be generous about phrasing and strict about meaning: opposite framings
of the same behaviour match, different subjects do not. On any failure the
result falls back to Dice >= 0.4 with the reason "Judged offline."

Both pairs are judged in parallel, and every verdict on the reveal screen has
an **Override** control for when the judge gets one obviously wrong.

Question 2 is numeric (`mode: "numeric"`): it parses a number out of each side
and counts a match if the guess lands within 25% of the stated answer.

## Editing the questions

Two ways, and they do not fight each other:

- **In the app.** "Edit the questions" on the title, rules, or final screen
  opens a full editor — question text, round names and subtitles, the three
  rules, the closing question, reordering, moving questions between rounds,
  the numeric flag, adding and deleting. "Reset to the printed card" restores
  the originals.
- **In the file.** `DEFAULT_QUESTIONS`, `DEFAULT_ROUNDS`, `DEFAULT_RULES` and
  `DEFAULT_CLOSING` sit at the top of `src/GuessMyAnswer.jsx`.

In-app edits live in React state only — no localStorage anywhere — so they
last for the session and reset on reload.

## Mobile rules this follows

It gets played on a phone handed across a table, so the floor is a 375px-wide
screen:

- Nothing scrolls sideways — `document.scrollWidth === clientWidth`.
- Nothing overflows its own card; player-typed text wraps with
  `overflow-wrap: anywhere`.
- Every tap target is at least 44px.
- Inputs carry `min-width: 0` and a 16px font, so they neither burst their
  container nor trigger the iOS zoom-on-focus.
- `100dvh` via a `--gmaVh` custom property, not `100vh`.
- `env(safe-area-inset-*)` gutters, `scrollbar-gutter: stable`,
  `overscroll-behavior-y: none`, and no tap highlight.

## The single-file version

`src/GuessMyAnswer.jsx` is self-contained — one default export, no required
props, no storage. It can be pasted straight into a Claude conversation as an
artifact. The judge call tries the same-origin `/api/judge` proxy first (this
server) and falls back to calling the Anthropic API directly (which is how it
works inside a Claude artifact), so the same file runs in both places.
