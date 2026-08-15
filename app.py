"""Discord HTTP-interactions bot: /抓圖 <角色> <類型> replies with a random post from your own collection.

Media source: posts you like on X, Instagram, or Facebook get auto-collected by a userscript
(see likewatcher.user.js) that watches your own logged-in browser session — see README for why
this replaces both the official X API (search needs a paid plan) and scraping (means bypassing
X's anti-bot defenses, which this project won't do). Discord auto-embeds the link itself, no
download needed.
"""
import hashlib
import json
import os
import random
import re
import threading
from pathlib import Path

import requests
from dotenv import load_dotenv
from flask import Flask, abort, jsonify, request
from nacl.exceptions import BadSignatureError
from nacl.signing import VerifyKey
from pypinyin import Style, load_phrases_dict, lazy_pinyin

# pypinyin 的字典有時跟大家實際唸法對不上——「長離」的長預設猜成首長的 zhǎng，不是角色實際唸法
# cháng；「妮」字典預設是 nī，但沒人這樣唸，「達妮婭」「贊妮」這些名字裡大家都唸 ní。這裡手動修正
# 遇到的個案，之後同音字比對又抓錯哪個角色再往這裡加一行就好。
load_phrases_dict({"長離": [["cháng"], ["lí"]], "妮": [["ní"]]})

load_dotenv()

app = Flask(__name__)

API_BASE = "https://discord.com/api/v10"
BOT_TOKEN = os.environ["DISCORD_BOT_TOKEN"]
VERIFY_KEY = VerifyKey(bytes.fromhex(os.environ["DISCORD_PUBLIC_KEY"]))
COLLECT_SECRET = os.environ["COLLECT_SECRET"]
# 選填：設了才會在 client 主動要求時（見 /collect 的 announce 欄位）主動推播新收藏——兩個都設的話
# 同一則會兩邊都發，只設一個就只發那邊，都不設就整個跳過。bot 要先被邀進對應伺服器、在該頻道有發言
# 權限——User Install 不夠，這個一定要真的邀進去才行。
ANNOUNCE_CHANNEL_IDS = [c for c in [
    os.environ.get("TEXT_ANNOUNCE_CHANNEL_ID", ""),
    os.environ.get("MARUNA_ANNOUNCE_CHANNEL_ID", ""),
] if c]

APP_ID = os.environ.get("DISCORD_APPLICATION_ID") or requests.get(
    f"{API_BASE}/oauth2/applications/@me", headers={"Authorization": f"Bot {BOT_TOKEN}"}
).json()["id"]

TWEET_URL_RE = re.compile(r"^https://(?:x|twitter)\.com/([A-Za-z0-9_]{1,15})/status/(\d+)$")
INSTAGRAM_URL_RE = re.compile(r"^https://(?:www\.)?instagram\.com/(?:p|reel)/([A-Za-z0-9_-]+)/?$")
INSTAGRAM_USERNAME_RE = re.compile(r"^[A-Za-z0-9_.]{1,30}$")

# FB 貼文網址帶的追蹤參數（?__cft__[0]=...）長度不固定，故意不用 $ 錨定字串結尾，抓到需要的部分就好，
# 尾巴不管。只認得下面四種形狀（個人/粉專貼文、影片、單張照片、社團貼文）——permalink.php／story.php
# 先不處理，之後真的用得到再加一個 elif 就好。
FACEBOOK_POST_RE = re.compile(r"^https://(?:www\.|m\.)?facebook\.com/(?P<user>[A-Za-z0-9.]{5,50})/(?P<kind>posts|videos)/(?P<id>[A-Za-z0-9]+)")
FACEBOOK_REEL_RE = re.compile(r"^https://(?:www\.|m\.)?facebook\.com/reel/(?P<id>\d+)")
FACEBOOK_PHOTO_RE = re.compile(r"^https://(?:www\.|m\.)?facebook\.com/photo/?\?fbid=(?P<id>\d+)")
# 社團貼文網址不帶發文者的帳號，只有社團 id——作者一樣得靠 client 端抓，跟 reel/photo 同一個信任層級。
FACEBOOK_GROUP_RE = re.compile(r"^https://(?:www\.|m\.)?facebook\.com/groups/(?P<group>[A-Za-z0-9_.]{1,50})/(?P<kind>posts|permalink)/(?P<id>[A-Za-z0-9]+)")
FACEBOOK_USERNAME_RE = re.compile(r"^[A-Za-z0-9.]{5,50}$")

HASHTAGS_PATH = Path(__file__).parent / "hashtags.json"
COLLECTED_PATH = Path(__file__).parent / "collected.json"

# Optional: Upstash Redis free tier for persistence across Render free-tier restarts
# (its local disk gets wiped on every redeploy/spin-down-then-wake). Falls back to the
# local JSON file when these aren't set — fine for local dev, not for a free-tier deploy.
UPSTASH_URL = os.environ.get("UPSTASH_REDIS_REST_URL", "").rstrip("/")
UPSTASH_TOKEN = os.environ.get("UPSTASH_REDIS_REST_TOKEN", "")

with open(HASHTAGS_PATH, encoding="utf-8") as f:
    HASHTAGS = {k: (v if isinstance(v, list) else [v]) for k, v in json.load(f).items() if not k.startswith("_")}

# 拼音/注音查一次存起來，同音字（碎/歲/穗都唸 sui，聲調也一樣）autocomplete 才找得到，不用每次打字
# 都重轉換——build_pinyin_table/build_bopomofo_table 也是 test_app.py 重建這兩張表時共用的那份，
# 兩邊各寫一份會不小心不同步。
_BOPOMOFO_TONE_MARKS = str.maketrans("", "", "ˊˇˋ˙")


def build_pinyin_table(names):
    # 存成音節清單而不是直接拼接字串，比對時才不會把 jin 誤判成 jing 的前綴（兩個不同音節，拼起來
    # 字串上卻剛好一個是另一個的子字串）。帶聲調（Style.TONE）比對，同音不同調（金 jīn vs 瑾 jǐn）
    # 才不會互相誤判——純 ASCII 查詢（沒有調號可標）不受影響，一樣照原樣比對。
    return {name: lazy_pinyin(name, style=Style.TONE) for name in names}


def build_bopomofo_table(names):
    # 注音同理：Discord 的輸入框有時接不到注音輸入法的選字視窗，打到一半會直接送出還沒選字的注音符號
    # （例如打「金」只送出 ㄐㄧㄣ），所以也比照拼音做成同音字對照表。聲調符號略過比較——沒選字的話
    # 通常連聲調鍵都還沒按。
    return {name: "".join(lazy_pinyin(name, style=Style.BOPOMOFO)).translate(_BOPOMOFO_TONE_MARKS) for name in names}


HASHTAGS_PINYIN = build_pinyin_table(HASHTAGS)
HASHTAGS_BOPOMOFO = build_bopomofo_table(HASHTAGS)


def _contains_syllables(needle, haystack):
    return any(haystack[i:i + len(needle)] == needle for i in range(len(haystack) - len(needle) + 1))


def autocomplete_matches(query):
    query_syllables = lazy_pinyin(query, style=Style.TONE) if query else []
    query_bopomofo = query.translate(_BOPOMOFO_TONE_MARKS) if query else ""
    return [
        name for name in HASHTAGS
        if query in name
        or (query_syllables and _contains_syllables(query_syllables, HASHTAGS_PINYIN[name]))
        or (query_bopomofo and query_bopomofo in HASHTAGS_BOPOMOFO[name])
    ][:25]


def load_collected():
    if UPSTASH_URL:
        r = requests.get(f"{UPSTASH_URL}/get/collected", headers={"Authorization": f"Bearer {UPSTASH_TOKEN}"})
        r.raise_for_status()
        result = r.json().get("result")
        return json.loads(result) if result else {}
    if not COLLECTED_PATH.exists():
        return {}
    with open(COLLECTED_PATH, encoding="utf-8") as f:
        return json.load(f)


def save_collected(data):
    # ponytail: read-modify-write, no lock — fine for one person's browser posting
    # occasionally; add one if this ever gets concurrent writers.
    payload = json.dumps(data, ensure_ascii=False)
    if UPSTASH_URL:
        r = requests.post(f"{UPSTASH_URL}/set/collected", headers={"Authorization": f"Bearer {UPSTASH_TOKEN}"}, data=payload.encode())
        r.raise_for_status()
        return
    with open(COLLECTED_PATH, "w", encoding="utf-8") as f:
        f.write(payload)


def delete_entry(character, url):
    # X/FB 貼文在 /抓圖 的回覆裡顯示的是 fix_embed_url() 轉過的 vxtwitter.com/facebed.com 連結（見
    # build_link_lines）——使用者手動複製貼上那個網址進來刪，不會等於 collected.json 裡存的原始
    # x.com/facebook.com 網址。兩邊都跑一次 fix_embed_url() 再比對，兩種網址都能對上同一筆。
    data = load_collected()
    bucket = data.get(character, [])
    target = fix_embed_url(url)
    remaining = [e for e in bucket if fix_embed_url(e["url"]) != target]
    if len(remaining) == len(bucket):
        return False
    data[character] = remaining
    save_collected(data)
    return True


def url_hash(url):
    # Discord 的 button custom_id 限 100 字，直接塞完整網址（尤其 FB 那種長網址）風險太大——用短
    # hash 代替，點擊時再回頭比對找出實際是哪一筆。
    return hashlib.sha1(url.encode()).hexdigest()[:12]


def delete_entry_by_hash(character, short_hash):
    # 🗑️ 按鈕點擊要在 Discord 的 3 秒回應時限內做完，不能像原本那樣「先讀一次找是哪一筆、再呼叫
    # delete_entry 重新讀一次、寫一次」——一次點擊三趟 Upstash 太容易超時（尤其 Render 免費方案剛從
    # 休眠喚醒的時候），改成一次讀、原地篩、一次寫，找跟刪合成同一趟。順便把篩完剩下的清單一起回傳
    # ——呼叫端接著要用剩下的清單重畫訊息內容，不用再讀一次 Upstash（多這一趟讀曾經把已經修好的
    # 逾時問題帶回來過）。
    data = load_collected()
    bucket = data.get(character, [])
    remaining = [e for e in bucket if url_hash(e["url"]) != short_hash]
    if len(remaining) == len(bucket):
        return None, remaining
    deleted = next(e for e in bucket if url_hash(e["url"]) == short_hash)
    data[character] = remaining
    save_collected(data)
    return deleted, remaining


def media_emoji(entry_type):
    return "🎬" if entry_type == "video" else "📷"


def type_from_label(media_type_label):
    return "video" if media_type_label == "影片" else "photo"


def url_choices(character, query):
    # /抓圖刪除 的「網址」欄位自動完成——照選好的角色列出收藏的貼文，用網址或作者子字串篩選，不用先
    # 跑 /抓圖清單 複製貼上。Discord 的 choice name/value 都限 100 字，URL 理論上不會超過但保險截斷。
    query = query.lower()
    entries = load_collected().get(character, [])
    matches = [e for e in entries if query in e["url"].lower() or query in (e.get("author") or "").lower()]
    return [
        {
            "name": f"{media_emoji(e['type'])} {e.get('author') or '?'} - {e['url']}"[:100],
            "value": e["url"][:100],
        }
        for e in matches[:25]
    ]


def build_list_content(character, media_type_label):
    all_entries = load_collected().get(character, [])
    n_photo = sum(1 for e in all_entries if e.get("type") == "photo")
    n_video = sum(1 for e in all_entries if e.get("type") == "video")
    header = f"**{character}** 收藏總覽：📷 {n_photo} 張圖片、🎬 {n_video} 部影片"

    shown = all_entries
    if media_type_label:
        shown = [e for e in shown if e.get("type") == type_from_label(media_type_label)]
    if not shown:
        return header

    limit = 15
    lines = [
        f"{i}. {media_emoji(e['type'])} [{e.get('author') or '?'}]({e['url']})"
        for i, e in enumerate(shown[:limit], 1)
    ]
    if len(shown) > limit:
        lines.append(f"（還有 {len(shown) - limit} 筆，只顯示前 {limit} 筆）")
    return header + "\n" + "\n".join(lines)


def build_stats_content():
    data = load_collected()
    counts = {name: len(data.get(name, [])) for name in HASHTAGS}
    with_entries = {name: n for name, n in counts.items() if n}
    total_photo = sum(sum(1 for e in v if e.get("type") == "photo") for v in data.values())
    total_video = sum(sum(1 for e in v if e.get("type") == "video") for v in data.values())

    lines = [
        "📊 全部收藏統計",
        f"共 {len(HASHTAGS)} 個角色，{len(with_entries)} 個有收藏、{len(HASHTAGS) - len(with_entries)} 個還是空的",
        f"總計：📷 {total_photo} 張圖片、🎬 {total_video} 部影片",
    ]
    top = sorted(with_entries.items(), key=lambda kv: kv[1], reverse=True)[:10]
    if top:
        lines.append("\n收藏最多的前 10 個：")
        lines += [f"{i}. {name} - {n}" for i, (name, n) in enumerate(top, 1)]
    return "\n".join(lines)


# vxtwitter.com / kkinstagram.com / facebed.com are free public proxies that redirect straight
# to the real media file so Discord actually embeds the image/video inline (the real domains
# don't unfurl reliably there). kkinstagram picked over ddinstagram — the latter 403s now.
# facebed confirmed live: Facebook serves a real og:image to it but shows an unauthenticated
# Discordbot request a "log in to view" wall on facebook.com directly — this isn't a
# privacy-setting thing, Meta specifically blocks Discord's own crawler.
EMBED_PROXIES = {
    "https://x.com/": "https://vxtwitter.com/",
    "https://twitter.com/": "https://vxtwitter.com/",
    "https://www.instagram.com/": "https://kkinstagram.com/",
    "https://instagram.com/": "https://kkinstagram.com/",
    "https://www.facebook.com/": "https://facebed.com/",
    "https://facebook.com/": "https://facebed.com/",
}


def fix_embed_url(url):
    for prefix, proxy in EMBED_PROXIES.items():
        if url.startswith(prefix):
            return proxy + url[len(prefix):]
    return url


def _is_instagram(url):
    return url.startswith("https://instagram.com/") or url.startswith("https://www.instagram.com/")


def build_link_lines(url):
    # kkinstagram.com gives Discord's crawler the real media for a proper inline embed, but a
    # human clicking the same link gets bounced to an unrelated third-party site — so for IG,
    # hide that link behind neutral link text and put the real instagram.com link on its own
    # line underneath for people to actually click.
    if _is_instagram(url):
        return f"[嵌圖用 勿點]({fix_embed_url(url)})\n{url}"
    return fix_embed_url(url)


def build_pick_reply(character, media_type, entries):
    # 一次抽超過一張才編號、才在按鈕上加數字標籤——單張的話原本就沒有「是哪一張」的疑問，維持原樣。
    numbered = len(entries) > 1
    lines = [(f"{i}. " if numbered else "") + build_link_lines(e["url"]) for i, e in enumerate(entries, 1)]
    suffix = f"（{len(entries)} 張）" if numbered else ""
    header = f"**{character}** 的{media_type}{suffix}\n"

    # 🗑️ 按鈕代替反應——這個 bot 沒有常駐的 Gateway 連線，收不到 MESSAGE_REACTION_ADD 事件，但按鈕
    # 點擊一樣是打 /interactions（type 3），跟其他互動同一條路，不用額外接 WebSocket。按鈕大小是
    # Discord 客戶端固定渲染的，API 沒有 size 欄位可調。
    buttons = [
        {
            "type": 2, "style": 4, "emoji": {"name": "🗑️"},
            **({"label": str(i)} if numbered else {}),
            "custom_id": f"del:{character}:{url_hash(e['url'])}",
        }
        for i, e in enumerate(entries, 1)
    ]

    # Discord 一則訊息只會自動幫前 5 個「連結」產生預覽圖，不是前 5「張」——IG 那則貼文的
    # build_link_lines() 藏了兩個連結（給爬蟲嵌圖用的 kkinstagram + 給人點的真實 instagram.com），
    # 佔了 2 個額度，會把原本排得進同一則的下一張擠出預覽範圍外。所以分組要照每篇貼文實際佔用的
    # 連結數（IG 算 2、其他算 1）湊到 5 個額度就切一則，不能單純每 5 張切一刀。超過的部分連同各自的
    # 刪除按鈕拆成後續的 webhook follow-up message（沒有 3 秒回應時限，交給呼叫端非同步送）。
    group_sizes, count, budget_used = [], 0, 0
    for e in entries:
        cost = 2 if _is_instagram(e["url"]) else 1
        if count and budget_used + cost > 5:
            group_sizes.append(count)
            count, budget_used = 0, 0
        count += 1
        budget_used += cost
    group_sizes.append(count)

    messages, i = [], 0
    for size in group_sizes:
        messages.append({
            "content": "\n\n".join(lines[i:i + size]),
            "components": [{"type": 1, "components": buttons[i:i + size]}],
        })
        i += size
    messages[0]["content"] = header + messages[0]["content"]
    return messages[0]["content"], messages[0]["components"], messages[1:]


def remove_pick_from_message(message, character, remaining_bucket, clicked_custom_id):
    # 點垃圾桶只該讓「這一張」從畫面上消失，不是整則訊息（原本 type 7 UPDATE_MESSAGE 直接整則換成
    # 確認文字，會連同一則裡其他還沒刪的張一起消失）。這裡改成用該則訊息現有的按鈕列表（扣掉被點的
    # 那顆）反查目前收藏裡還在的網址，重新組出只少一張的內容——用按鈕本身當「這則訊息裡有哪幾張」的
    # 真相來源，不用去解析舊的文字內容。remaining_bucket 由呼叫端的 delete_entry_by_hash 順便回傳，
    # 這裡不再自己讀一次 Upstash——3 秒時限內每多一趟讀寫都是逾時風險。
    # ponytail: 剩下的張保留原本的編號（不會重排成連續 1,2,3...），省下同步改 custom_id 對應關係的
    # 麻煩——編號留缺口不影響能不能點開連結，只是好看度打折。
    header = ""
    if message.get("content", "").startswith("**"):
        first_line, _, _ = message["content"].partition("\n")
        header = first_line + "\n"

    by_hash = {url_hash(e["url"]): e["url"] for e in remaining_bucket}
    kept_buttons, lines = [], []
    for row in message.get("components", []):
        for button in row["components"]:
            if button["custom_id"] == clicked_custom_id:
                continue
            _, _, short_hash = button["custom_id"].split(":", 2)
            url = by_hash.get(short_hash)
            if url is None:  # already deleted through some other path — drop it too
                continue
            kept_buttons.append(button)
            prefix = f"{button['label']}. " if "label" in button else ""
            lines.append(prefix + build_link_lines(url))

    if not lines:
        return f"🗑️ 已從「{character}」的收藏刪除這一則。", []
    return header + "\n\n".join(lines), [{"type": 1, "components": kept_buttons}]


def send_followups(token, messages):
    for msg in messages:
        try:
            requests.post(f"{API_BASE}/webhooks/{APP_ID}/{token}", json=msg, timeout=10)
        except requests.RequestException as e:
            # ponytail: best-effort, same as post_announcement — a failed follow-up just means
            # that chunk of pictures doesn't show up, not worth retrying.
            print(f"[followup] 送出失敗: {e}", flush=True)


def post_announcement(characters, media_type, url):
    # flush=True: waitress/Render 預設會把 stdout 全緩衝，不強制 flush 的話這幾行可能久久不出現在
    # Render 的 Logs 分頁裡（不是沒印，是印了但還卡在緩衝區），害人以為程式碼根本沒跑到這裡。
    if not ANNOUNCE_CHANNEL_IDS:
        print("[announce] 沒設定任何推播頻道，略過", flush=True)
        return
    media_label = "影片" if media_type == "video" else "圖片"
    content = f"**{'、'.join(characters)}** 的新{media_label}\n{build_link_lines(url)}"
    for channel_id in ANNOUNCE_CHANNEL_IDS:
        # 每個頻道各自 try/except——其中一個頻道 ID 錯或沒權限，不該連累另一個也發不出去。
        try:
            r = requests.post(
                f"{API_BASE}/channels/{channel_id}/messages",
                headers={"Authorization": f"Bot {BOT_TOKEN}"},
                json={"content": content},
                timeout=10,
            )
            r.raise_for_status()
            print(f"[announce] 已推播到頻道 {channel_id}: {characters}", flush=True)
        except requests.RequestException as e:
            # ponytail: best-effort push, swallow errors so a bot-permission/channel-id hiccup
            # never blocks /collect's actual job (saving the entry) — just log for debugging.
            body = e.response.text if e.response is not None else ""
            print(f"[announce] 推播失敗（頻道 {channel_id}）: {e} {body}", flush=True)


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
        opts = {o["name"]: o["value"] for o in body["data"]["options"]}
        focused = next(o for o in body["data"]["options"] if o.get("focused"))
        if focused["name"] == "網址":
            choices = url_choices(opts.get("角色", ""), focused["value"].strip())
        else:
            choices = [{"name": n, "value": n} for n in autocomplete_matches(focused["value"].strip())]
        return jsonify({"type": 8, "data": {"choices": choices}})

    if itype == 3:  # message component (button) clicked
        custom_id = body["data"]["custom_id"]
        if custom_id.startswith("del:"):
            _, character, short_hash = custom_id.split(":", 2)
            _, remaining = delete_entry_by_hash(character, short_hash)
            # 找不到（這顆按鈕的那筆已經刪過了——常見於上一次點擊其實刪除成功了，只是那次的回應在
            # Discord 3 秒時限內沒送到，畫面沒更新，使用者以為沒刪又點了一次）也照樣重畫這則訊息，
            # 只是把這顆失效的按鈕拿掉，不要整則清空、連累其他還沒刪的張。
            content, components = remove_pick_from_message(body["message"], character, remaining, custom_id)
            return jsonify({"type": 7, "data": {"content": content, "components": components}})
        return ("", 400)

    if itype == 2:  # slash command invoked
        command_name = body["data"]["name"]
        opts = {o["name"]: o["value"] for o in body["data"].get("options", [])}

        if command_name == "抓圖統計":
            return jsonify({"type": 4, "data": {"content": build_stats_content()}})

        character = opts.get("角色", "")
        if character not in HASHTAGS:
            return jsonify({
                "type": 4,
                "data": {"content": f"找不到「{character}」的 Hashtag，請先在 hashtags.json 新增。", "flags": 64},
            })

        if command_name == "抓圖清單":
            return jsonify({"type": 4, "data": {"content": build_list_content(character, opts.get("類型"))}})

        if command_name == "抓圖刪除":
            target_url = (opts.get("網址") or "").strip()
            if not delete_entry(character, target_url):
                return jsonify({
                    "type": 4,
                    "data": {"content": f"「{character}」的收藏裡找不到這個網址。", "flags": 64},
                })
            return jsonify({"type": 4, "data": {"content": f"已從「{character}」的收藏刪除：{target_url}"}})

        media_type = opts.get("類型", "圖片")
        count = max(1, min(int(opts.get("數量", 1)), 10))
        pool = [e for e in load_collected().get(character, []) if e.get("type") == type_from_label(media_type)]
        if not pool:
            return jsonify({
                "type": 4,
                "data": {"content": f"「{character}」的{media_type}收藏是空的，去 X、FB、IG 上點幾個愛心吧。"},
            })

        picks = random.sample(pool, min(count, len(pool)))
        content, components, followups = build_pick_reply(character, media_type, picks)
        if len(picks) < count:
            content += f"\n（收藏只有 {len(picks)} 張，全部都在這了）"
        if followups:
            threading.Thread(target=send_followups, args=(body["token"], followups), daemon=True).start()
        return jsonify({"type": 4, "data": {"content": content, "components": components}})

    return ("", 400)


@app.route("/hashtags", methods=["GET"])
def get_hashtags():
    """Public, read-only — the userscript fetches this to know which hashtags to watch for."""
    return jsonify(HASHTAGS)


@app.route("/autocomplete", methods=["GET"])
def get_autocomplete():
    """Public, read-only — lets likewatcher.user.js's retweet-add character picker reuse the
    exact same homophone matching /抓圖's Discord autocomplete uses, instead of re-implementing
    pinyin matching in JS."""
    return jsonify(autocomplete_matches(request.args.get("q", "").strip()))


@app.route("/collect", methods=["POST"])
def collect():
    if request.headers.get("X-Collect-Secret") != COLLECT_SECRET:
        abort(401)

    body = request.get_json(force=True, silent=True) or {}
    text, media_type = body.get("text", ""), body.get("type")
    raw_url = body.get("url", "")
    if media_type not in ("photo", "video"):
        abort(400)

    tweet_m = TWEET_URL_RE.match(raw_url)
    ig_m = INSTAGRAM_URL_RE.match(raw_url)
    fb_post_m = FACEBOOK_POST_RE.match(raw_url)
    fb_reel_m = FACEBOOK_REEL_RE.match(raw_url)
    fb_photo_m = FACEBOOK_PHOTO_RE.match(raw_url)
    fb_group_m = FACEBOOK_GROUP_RE.match(raw_url)
    is_facebook = False
    if tweet_m:
        # x.com/twitter.com embeds the author right in the URL — trust that, not the client's claim.
        url, author = tweet_m.group(0).replace("twitter.com", "x.com"), tweet_m.group(1)
    elif ig_m:
        # Instagram post URLs don't carry the author, so this one has to come from the client
        # (extracted from the page DOM, same trust level as `text` below) — just shape-check it.
        url, author = ig_m.group(0), (body.get("author") or "").strip()
        if not INSTAGRAM_USERNAME_RE.match(author):
            abort(400)
    elif fb_post_m:
        # facebook.com/{user}/posts|videos/{id} embeds the author right in the URL too — trust that.
        url = f"https://www.facebook.com/{fb_post_m['user']}/{fb_post_m['kind']}/{fb_post_m['id']}"
        author, is_facebook = fb_post_m["user"], True
    elif fb_reel_m or fb_photo_m or fb_group_m:
        # Reel/photo/group-post URLs don't carry a (public) username, same situation as Instagram above.
        if fb_reel_m:
            url = f"https://www.facebook.com/reel/{fb_reel_m['id']}"
        elif fb_photo_m:
            url = f"https://www.facebook.com/photo/?fbid={fb_photo_m['id']}"
        else:
            url = f"https://www.facebook.com/groups/{fb_group_m['group']}/{fb_group_m['kind']}/{fb_group_m['id']}"
        author, is_facebook = (body.get("author") or "").strip(), True
        if not FACEBOOK_USERNAME_RE.match(author):
            abort(400)
    else:
        abort(400)  # reject anything that isn't actually a real x.com/twitter.com/instagram.com/facebook.com post link

    lower_text = text.lower()
    if is_facebook:
        # FB 貼文本文常常會提到角色名字但沒配圖（分享心得、討論串），純文字比對太容易誤觸——
        # 所以在 FB 上關鍵字「一定」要帶 # 才算數，X/IG 維持原本「文字裡出現就算」的寬鬆比對。
        matched = [name for name, tags in HASHTAGS.items() if any(f"#{t.lower().lstrip('#')}" in lower_text for t in tags)]
    else:
        matched = [name for name, tags in HASHTAGS.items() if any(t.lower() in lower_text for t in tags)]
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

    if added and body.get("announce"):
        # client-side opt-in flag (the userscript's own per-device toggle) — /collect itself
        # doesn't decide whether to announce, it just needs ANNOUNCE_CHANNEL_ID configured.
        post_announcement(added, media_type, url)

    return jsonify({"added_to": added})


if __name__ == "__main__":
    app.run(port=int(os.environ.get("PORT", 8787)))
