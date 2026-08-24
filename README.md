# Guess My Answer

A two-player guessing game. Pass one phone back and forth, or play it on two
phones at once with the scores kept in sync.
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

No API key is required — the built-in matcher handles scoring on its own.

`PORT` is provided by Railway and read automatically. `JUDGE_MODEL` is
optional and defaults to `claude-sonnet-4-6`.

Check `/healthz` after deploy — it returns `{"ok":true,"judge":true}` once the
key is set. `"judge":false` means the key is missing and the game will score
with the offline fallback instead.

## Two phones

You can play either way. The title screen offers both.

**One phone** is the original ritual: write, hand it over, the handoff screen
hides everything, both boxes are masked as you type.

**Two phones** puts each of you on your own device. One person taps *Play on
two phones* and reads out the four-character room code; the other types it
under *Joining a room?* and the game starts by itself. From then on both
screens move together — same question, same round card, same scoreboard. When
you lock yours in you get a *Waiting for…* screen, and your partner sees a
quiet "has locked in" line on their question. Nothing is revealed until you
have both written something down. Overrides and Next sync to both phones.
Because it is your own phone, the answer boxes are not masked.

Some notes on how it works, and what it does not do:

- **The server is the referee.** It holds the room, gates the reveal, and runs
  the judge exactly once so both phones see an identical verdict rather than
  scoring separately and disagreeing.
- **A player never receives their partner's answer before committing their
  own.** Everything a client sees is redacted per seat by `viewForSeat()` in
  `rooms.js`; while a question is open, the only thing you learn about the
  other seat is whether they have locked in. Not their text, not its length.
- **Short polling, roughly every 1.2s** — not WebSockets or SSE. A phone that
  locks its screen drops a live connection and needs reconnect logic; a poll
  just resumes on the next tick. For a game where you are waiting on someone to
  type a sentence, the latency is invisible.
- **Refresh is safe.** Your seat is held by a token, so reloading rejoins the
  same seat rather than taking a new one.
- **Rooms live in memory** with a 12-hour idle expiry. A Railway redeploy or
  restart clears them — fine for one evening, but you would start over.
- **Questions are edited by the host, in the lobby.** Once the first question
  is answered the set is locked so indices cannot shift underneath a game in
  progress.

## How answers get scored

No API key needed. Everything below runs offline in the browser, in about a
millisecond, and whatever it gets wrong there is a button on the reveal screen
to flip.

Answers are short free text and almost never match literally. "not hanging the
kitchen towel up" and "leaving the kitchen towel out" are the same complaint
and have to score. The engine works in layers:

- **Normalising.** Lowercase, expand contractions, strip leading filler ("i
  think", "probably"), drop punctuation and function words, map common
  synonyms (film/movie, annoyed/mad, apologise/sorry), and stem what is left.
- **Who is who.** "me" becomes whoever wrote it and "you" becomes the other
  one, so Michael answering "me" and Hannah guessing "you" land on the same
  string. Naming the same person is strong evidence; naming different people
  settles it the other way.
- **Three similarity signals**, strongest wins: token overlap (Dice), the same
  with fuzzy token matching so typos and odd inflections still pair
  ("towl"/"towel", "apologise"/"apologizes"), and containment, for when one
  answer is a short version of the other ("Colorado" inside "somewhere in
  Colorado"). Words too common to identify anything — day, thing, time, way —
  are excluded, so "our wedding day" and "the day Kiya was born" do not match
  on "day" alone.
- **Negation, handled properly.** A flat contradiction is a miss. But
  grammatically opposite framings of one act are not: when one side negates a
  tidying verb and the other affirms an abandoning verb — "never puts his
  laundry away" against "leaves laundry on the floor" — the disagreement is
  only grammar, and if they also name the same thing it scores.

Ambiguous pairs default to **no match**, deliberately. A wrong miss is one
button press to fix and you watch it happen; a wrong match quietly hands out a
point nobody earned.

Measured on 47 hand-written pairs drawn from these actual questions, it gets
43 right. The ones it misses are pure synonymy with no shared words ("stops
talking" / "goes silent") and pronouns with no resolvable referent. That is
what the override is for.

Question 2 is numeric (`mode: "numeric"`): it parses a number out of each side
and counts a match if the guess lands within 25% of the stated answer.

**Optional.** If `ANTHROPIC_API_KEY` is set on the server, genuinely ambiguous
pairs get a second opinion from Claude before the fallback decides. Nothing
depends on it — with no key the app never even makes the request.

## Editing the questions

Two ways, and they do not fight each other:

- **In the app.** "Edit the questions" on the title, rules, lobby, or final
  screen opens a full editor — question text, round names and subtitles, the three
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

The app imports its matching engine from `src/matching.js` so the server can
run identical code when refereeing a two-phone game. That is right for the
deployed app and wrong for pasting into a Claude conversation, which wants
exactly one file.

```bash
npm run artifact
```

writes `artifact/GuessMyAnswer.single.jsx` — engine inlined, React the only
import, one default export, no required props, no storage. Paste that one.
It is generated, so edit the sources and re-run rather than editing it.

In an artifact there is no server, so the room mode has nothing to talk to and
the two-phone buttons will not connect — the pass-one-phone game works fully.
The judge tries the same-origin `/api/judge` proxy first and falls back to
calling the Anthropic API directly, which is how it works in an artifact.
