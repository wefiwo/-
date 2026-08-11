# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pip install -r requirements.txt   # install deps
python -m unittest -v             # run the self-check (test_app.py)
python app.py                     # run the Flask backend locally (port from $PORT, default 8787)
python register_commands.py       # (re)register the /抓圖 slash command — only needed when the command's options/shape change
```

Deploy: push to `main` on GitHub → Render auto-deploys (Build: `pip install -r requirements.txt`, Start: `waitress-serve --host=0.0.0.0 --port=$PORT app:app`). No CI; the unittest run above is the only check before pushing.

For instant (non-1-hour-propagation) slash-command testing, set `GUILD_ID` in `.env` before running `register_commands.py`, then unset it and rerun before shipping (global commands only, so anyone who installs the app can use it).

## Architecture

This bot does **not** search X/Instagram live. `/抓圖 <角色> <類型>` just returns a random pick from `collected.json`, a personal collection built entirely by a browser userscript reacting to the user's own likes. There is no scraping and no official-API integration — see the README's "為什麼是「按讚蒐集」" section for why that was deliberately ruled out (paid-only official API, unsafe third-party scrapers, and a firm decision not to build anti-bot-bypass tooling even for a personal project).

**Data flow:** user likes a post on x.com/instagram.com (in their own logged-in browser, Tampermonkey installed) → `likewatcher.user.js` reads the post's text/URL/media-type off the live page → matches against the character→keyword map served by `GET /hashtags` → `POST /collect` with a shared-secret header → `app.py` **re-validates everything server-side** (URL must match a real x.com/twitter.com/instagram.com post-link regex, author for X is derived from the URL itself rather than trusted from the client, hashtag match is redone server-side) → dedupes by URL → persists into `collected.json`. `/抓圖` only ever reads from that already-built pool.

**Storage (`load_collected`/`save_collected` in app.py):** Upstash Redis (single key `"collected"`, whole JSON blob) when `UPSTASH_REDIS_REST_URL`/`_TOKEN` are set — required in production because Render's free-tier filesystem is wiped on every redeploy and on spin-down/wake. Falls back to a local `collected.json` file otherwise (local dev only).

**`hashtags.json`:** character → list of keywords, matched as case-insensitive substrings anywhere in the post text (no `#` required by default). A handful of entries are deliberately restricted to `#`-prefixed-only keywords (e.g. `心`, `安可`, `秋水`, `露西`, `蕾貝卡`, `菲比`, `千咲`, and bare `鳴潮` itself) because the bare word is a common word/name that would false-positive-match unrelated posts otherwise. Keep new entries consistent with this pattern — check whether a keyword is generic enough to need the `#`-only treatment before adding it bare. `角色關鍵字對照表.txt` is a human-readable mirror of this file (character：kw1、kw2、... format) — it is **not** auto-generated, update it by hand alongside `hashtags.json`.

**Discord embed rewriting (`fix_embed_url`/`build_link_lines` in app.py):** x.com/twitter.com links are rewritten to `vxtwitter.com` so Discord embeds them inline. Instagram is trickier — `kkinstagram.com` gives Discord's crawler a real media redirect, but a *human* clicking that same link gets bounced to an unrelated third-party site (`kkclip.com`), so IG replies post the `kkinstagram.com` link behind neutral anchor text ("嵌圖用 勿點") plus the real `instagram.com` link on its own line underneath.

**`likewatcher.user.js` — Instagram-specific quirks (non-obvious, found via live debugging, don't re-derive from scratch):**
- IG's Reels feed-scroll view renders the caption overlay inside a **closed shadow root** — genuinely unreadable by any DOM query, not a timing issue. Caption and photo/video type are instead read via a same-origin `fetch()` of the post's own canonical URL, parsing the response HTML's `og:description` (caption + hashtags) and `og:url` (contains `/reel/` vs `/p/`, used for media type — a DOM `<video>` query was unreliable and could pick up an unrelated video elsewhere on the page).
- IG post links come in three shapes: `/p/{code}/`, `/reel/{code}/`, and `/reels/{code}/` (plural — the Reels tab's own URL scheme; must not be misparsed as a username "reels"). A generic `/{username}/{code}/` form is also matched as a fallback, with a shortcode-shape heuristic (`looksLikeShortcode`: real codes contain a digit or uppercase letter) plus a reserved-word list to reject non-post nav links like `/legal/privacy/` or `/accounts/meta_verified/`.
- Author extraction relies on the real author's avatar+username links appearing twice in a row pointing at the same href; a single-occurrence link is a commenter or suggested account, not the post's author.

**Autocomplete (`autocomplete_matches`/`HASHTAGS_PINYIN` in app.py):** the 角色 option matches on homophones, not just literal substrings — every character name is pre-converted to toneless pinyin with `pypinyin.lazy_pinyin` at import time (`HASHTAGS_PINYIN`), and a typed query is converted the same way and substring-matched against both the literal name and its pinyin. `pypinyin` sometimes guesses the wrong reading for a polyphonic character (e.g. `長離`'s `長` defaulted to `zhǎng` instead of the correct `cháng`) — fix these by registering an override via `load_phrases_dict()` near the top of app.py (one is already there for `長離`); add another line there if a future character's homophone search doesn't work as expected.

**Auth model:** `COLLECT_SECRET` is the only gate on `/collect` — anyone holding it can add entries for any character, with no per-person attribution or revocation (single shared secret, deliberately simple). Since userscript v3.0 the secret is **not** embedded in `likewatcher.user.js` itself — it's stored via `GM_setValue`/`GM_getValue` (prompted once on first use) so the script can safely self-update via Tampermonkey's `@updateURL`/`@downloadURL` without an update clobbering a per-install secret. This is also why the GitHub repo is deliberately public — `@updateURL` points at `raw.githubusercontent.com`, which can't serve from a private repo. No secrets are tracked in git either way (`.env` and `collected.json` are gitignored).

**Windows dev note:** `python` fails to launch through this machine's Bash/git-bash tool (broken Anaconda launcher path); use PowerShell for any Python commands here.
