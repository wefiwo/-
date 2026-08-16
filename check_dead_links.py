"""One-off/periodic tool: check every collected entry's embed-proxy link (vxtwitter/kkinstagram/
facebed — the same rewrite app.py's fix_embed_url() uses to get Discord to render an inline preview)
and report which ones no longer resolve (tweet deleted, account suspended/private, etc.). A dead
proxy link isn't something our own code can fix — the tweet is gone on X's side, not ours — the only
way to stop a broken preview surfacing at /抓圖 pick time is to prune dead entries before they can be
handed out. Reads the live collection via GET /export and deletes confirmed-dead ones via
POST /admin/delete (both gated by COLLECT_SECRET) — doesn't touch collected.json directly, there's
no local copy of it (see CLAUDE.md's Storage note).

Usage:
    python check_dead_links.py [--limit N] [--delay SECONDS] [--delete]

Reports only by default (prints what it found) — pass --delete to actually remove confirmed-dead
entries. Progress (which URLs have been checked + outcome) is saved to
dead_link_check_progress.json next to this script, so re-running after an interruption skips URLs
already checked. Delete that file to force a full re-check (e.g. after tuning DEAD_MARKERS).
"""
import argparse
import json
import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv()
sys.stdout.reconfigure(line_buffering=True)  # 背景執行時 stdout 預設整批緩衝，這樣才能即時看到進度

BACKEND_URL = "https://bobobobob.pythonanywhere.com"
COLLECT_SECRET = os.environ["COLLECT_SECRET"]
PROGRESS_PATH = Path(__file__).parent / "dead_link_check_progress.json"
DISCORDBOT_UA = "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)"

# 跟 app.py 的 EMBED_PROXIES 手動保持一致——這幾個代理服務才是 Discord 實際爬去產生預覽圖的網址，
# 不是原始的 x.com/instagram.com/facebook.com，死不死要看代理服務那邊真正回什麼。
EMBED_PROXIES = {
    "https://x.com/": "https://vxtwitter.com/",
    "https://twitter.com/": "https://vxtwitter.com/",
    "https://www.instagram.com/": "https://kkinstagram.com/",
    "https://instagram.com/": "https://kkinstagram.com/",
    "https://www.facebook.com/": "https://facebed.com/",
    "https://facebook.com/": "https://facebed.com/",
}

# vxtwitter/fxtwitter（BetterTwitFix）掛掉時回的錯誤頁字樣。kkinstagram/facebed 目前沒遇過死連結
# 的實際案例可以參考，先只處理 X 這條——之後真的遇到 IG/FB 的死連結錯誤頁再照樣加。
DEAD_MARKERS = ["Failed to scan your link"]


def fix_embed_url(url):
    for prefix, proxy in EMBED_PROXIES.items():
        if url.startswith(prefix):
            return proxy + url[len(prefix):]
    return url


def is_dead(url):
    # 用 Discord 爬蟲同一支 User-Agent 打，因為 vxtwitter 對一般瀏覽器跟 Discordbot 回的內容不一樣
    # （一般瀏覽器就算 X 那邊解析失敗，也可能還是回一個能正常導向 x.com 的 200 頁面）。
    try:
        r = requests.get(fix_embed_url(url), headers={"User-Agent": DISCORDBOT_UA}, timeout=15)
    except requests.RequestException:
        return None  # 網路本身的問題，不能當成連結死了，None 代表「這次沒查到，之後重跑再說」
    if r.status_code >= 400:
        return True
    return any(marker in r.text for marker in DEAD_MARKERS)


def load_progress():
    return json.loads(PROGRESS_PATH.read_text(encoding="utf-8")) if PROGRESS_PATH.exists() else {}


def save_progress(progress):
    PROGRESS_PATH.write_text(json.dumps(progress, ensure_ascii=False), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--limit", type=int, default=None, help="只檢查前 N 筆（小規模測試用）")
    parser.add_argument("--delete", action="store_true", help="確認死掉的連結直接刪除，不加這個只會列出來、不動資料")
    args = parser.parse_args()

    r = requests.get(f"{BACKEND_URL}/export", headers={"X-Collect-Secret": COLLECT_SECRET}, timeout=30)
    r.raise_for_status()
    data = r.json()
    entries = [(char, e["url"]) for char, bucket in data.items() for e in bucket]

    progress = load_progress()
    todo = [(char, url) for char, url in entries if url not in progress]
    already_checked = len(entries) - len(todo)
    if args.limit:
        todo = todo[:args.limit]
    print(f"總共 {len(entries)} 筆收藏，已檢查過 {already_checked} 筆，這次要查 {len(todo)} 筆")

    dead = []
    for i, (char, url) in enumerate(todo, 1):
        result = is_dead(url)
        if result is None:
            continue  # 網路問題，留給下次重跑，不寫進 progress
        progress[url] = "dead" if result else "alive"
        if result:
            dead.append((char, url))
            print(f"  [{i}/{len(todo)}] 💀 {char}: {url}")
        if i % 50 == 0:
            save_progress(progress)
            print(f"  進度 {i}/{len(todo)} — 目前發現 {len(dead)} 個死連結")
    save_progress(progress)

    print(f"\n完成，共發現 {len(dead)} 個死連結。")
    if not args.delete:
        print("沒加 --delete，資料庫沒有被動到——確認上面列出來的沒問題後，加 --delete 重跑一次來刪除。")
        return

    for char, url in dead:
        resp = requests.post(f"{BACKEND_URL}/admin/delete", json={"character": char, "url": url},
                              headers={"X-Collect-Secret": COLLECT_SECRET}, timeout=15)
        ok = resp.ok and resp.json().get("deleted")
        print(f"  {'✅' if ok else '❌'} 刪除 {char}: {url}")


if __name__ == "__main__":
    main()
