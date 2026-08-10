"""Discord HTTP-interactions bot: /抓圖 <角色> <類型> replies with a random post from your own collection.

Media source: posts you like on X get auto-collected by a userscript (see likewatcher.user.js)
that watches your own logged-in browser session — see README for why this replaces both the
official X API (search needs a paid plan) and scraping (means bypassing X's anti-bot defenses,
which this project won't do). Discord auto-embeds the tweet link itself, no download needed.
"""
import json
import os
import random
from pathlib import Path

import requests
from dotenv import load_dotenv
from flask import Flask, abort, jsonify, request
from nacl.exceptions import BadSignatureError
from nacl.signing import VerifyKey

load_dotenv()

app = Flask(__name__)

API_BASE = "https://discord.com/api/v10"
BOT_TOKEN = os.environ["DISCORD_BOT_TOKEN"]
VERIFY_KEY = VerifyKey(bytes.fromhex(os.environ["DISCORD_PUBLIC_KEY"]))
COLLECT_SECRET = os.environ["COLLECT_SECRET"]

APP_ID = os.environ.get("DISCORD_APPLICATION_ID") or requests.get(
    f"{API_BASE}/oauth2/applications/@me", headers={"Authorization": f"Bot {BOT_TOKEN}"}
).json()["id"]

HASHTAGS_PATH = Path(__file__).parent / "hashtags.json"
COLLECTED_PATH = Path(__file__).parent / "collected.json"

with open(HASHTAGS_PATH, encoding="utf-8") as f:
    HASHTAGS = {k: (v if isinstance(v, list) else [v]) for k, v in json.load(f).items() if not k.startswith("_")}


def load_collected():
    if not COLLECTED_PATH.exists():
        return {}
    with open(COLLECTED_PATH, encoding="utf-8") as f:
        return json.load(f)


def save_collected(data):
    # ponytail: read-modify-write, no file lock — fine for one person's browser posting
    # occasionally; add a lock if this ever gets concurrent writers.
    with open(COLLECTED_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def fix_embed_url(url):
    # vxtwitter.com is a free public proxy that re-serves proper Open Graph tags so Discord
    # actually embeds the image/video inline (x.com's own tags don't unfurl reliably there).
    return url.replace("https://x.com/", "https://vxtwitter.com/").replace("https://twitter.com/", "https://vxtwitter.com/")


def verify(req):
    sig = req.headers.get("X-Signature-Ed25519", "")
    ts = req.headers.get("X-Signature-Timestamp", "")
    try:
        VERIFY_KEY.verify(ts.encode() + req.get_data(), bytes.fromhex(sig))
    except (BadSignatureError, ValueError):
        abort(401, "invalid request signature")


@app.route("/interactions", methods=["POST"])
def interactions():
    verify(request)
    body = request.get_json()
    itype = body["type"]

    if itype == 1:  # PING
        return jsonify({"type": 1})

    if itype == 4:  # autocomplete
        focused = next(o for o in body["data"]["options"] if o.get("focused"))
        query = focused["value"].strip()
        matches = [name for name in HASHTAGS if query in name][:25]
        return jsonify({"type": 8, "data": {"choices": [{"name": n, "value": n} for n in matches]}})

    if itype == 2:  # slash command invoked
        opts = {o["name"]: o["value"] for o in body["data"].get("options", [])}
        character = opts.get("角色", "")
        media_type = opts.get("類型", "圖片")

        if character not in HASHTAGS:
            return jsonify({
                "type": 4,
                "data": {"content": f"找不到「{character}」的 Hashtag，請先在 hashtags.json 新增。", "flags": 64},
            })

        want = "video" if media_type == "影片" else "photo"
        pool = [e for e in load_collected().get(character, []) if e.get("type") == want]
        if not pool:
            return jsonify({
                "type": 4,
                "data": {"content": f"「{character}」的{media_type}收藏是空的，去 X 上點幾個愛心吧（見 likewatcher.user.js）。"},
            })

        entry = random.choice(pool)
        content = f"**{character}** 的{media_type}\n{fix_embed_url(entry['url'])}\n繪師：@{entry['author']}"
        return jsonify({"type": 4, "data": {"content": content}})

    return ("", 400)


@app.route("/hashtags", methods=["GET"])
def get_hashtags():
    """Public, read-only — the userscript fetches this to know which hashtags to watch for."""
    return jsonify(HASHTAGS)


@app.route("/collect", methods=["POST"])
def collect():
    if request.headers.get("X-Collect-Secret") != COLLECT_SECRET:
        abort(401)

    body = request.get_json(force=True, silent=True) or {}
    url, author = body.get("url"), body.get("author")
    text, media_type = body.get("text", ""), body.get("type")
    if not url or not author or media_type not in ("photo", "video"):
        abort(400)

    lower_text = text.lower()
    matched = [name for name, tags in HASHTAGS.items() if any(f"#{t.lower()}" in lower_text for t in tags)]
    if not matched:
        return jsonify({"added_to": []})

    data = load_collected()
    added = []
    for character in matched:
        bucket = data.setdefault(character, [])
        if not any(e["url"] == url for e in bucket):
            bucket.append({"url": url, "author": author, "type": media_type})
            added.append(character)
    save_collected(data)
    return jsonify({"added_to": added})


if __name__ == "__main__":
    app.run(port=int(os.environ.get("PORT", 8787)))
