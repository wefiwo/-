"""One-off tool: backfill collected.json from a Twitter/X data-archive export's data/like.js,
matching against hashtags.json the same way a live X like normally gets collected. Not run
automatically by anything — invoke by hand whenever there's an archive to import.

The archive's like.js entries carry no author username and no photo/video info at all — both
get resolved from the tweet's own t.co media link via a single redirect hop (t.co is X's own
link-shortener; this just reads the Location header of the first redirect, e.g.
https://t.co/xxx -> https://twitter.com/{author}/status/{id}/photo/1). That's resolving a
public short link, not touching any of X's actual anti-bot-guarded pages. A tweet whose t.co
link(s) don't resolve to a .../photo|video/N path for that same tweet id is skipped as
text-only (or the t.co is some unrelated external link, not attached media).

Usage:
    python import_twitter_archive.py <archive.zip> [--limit N] [--delay SECONDS] [--redo-status STATUS]

--limit lets you test on a small batch first before committing to the whole archive.
Progress (which tweet IDs have been handled + outcome) is saved to
twitter_import_progress.json next to this script, so re-running after an interruption
skips tweets already done instead of re-querying them. Items t.co rate-limited on (429/503,
retried a few times with backoff and still failing) are marked "retry_later" and always
retried automatically on the next run, no flag needed. If an earlier run predates this
retry logic and may have misclassified rate-limited lookups as "no_media", re-open those
specifically with --redo-status no_media.
announce is always sent as false — a bulk historical backfill shouldn't spam the
auto-announce Discord channel(s) the way a real-time like would.
"""
import argparse
import json
import os
import re
import sys
import time
import zipfile
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv()

BACKEND_URL = "https://twitterlian-dong-dcshou-tu-bot.onrender.com"
COLLECT_SECRET = os.environ["COLLECT_SECRET"]
HASHTAGS_PATH = Path(__file__).parent / "hashtags.json"
PROGRESS_PATH = Path(__file__).parent / "twitter_import_progress.json"

TCO_RE = re.compile(r"https://t\.co/\w+")
MEDIA_URL_RE = re.compile(r"^https://(?:x|twitter)\.com/([A-Za-z0-9_]{1,15})/status/(\d+)/(photo|video)/\d+")


class RateLimited(Exception):
    """t.co 回了 429/503（或連續逾時），重試幾次還是這樣——別讓呼叫端把這個誤判成「這則沒有媒體」。"""


def load_hashtags():
    with open(HASHTAGS_PATH, encoding="utf-8") as f:
        return {k: (v if isinstance(v, list) else [v]) for k, v in json.load(f).items() if not k.startswith("_")}


def matched_characters(text, hashtags):
    # X 這邊本來就是寬鬆比對（不用 #），跟 app.py 的 /collect 對 X 貼文的比對邏輯一致。
    lower = text.lower()
    return [name for name, tags in hashtags.items() if any(t.lower() in lower for t in tags)]


def parse_archive(zip_path):
    with zipfile.ZipFile(zip_path) as z:
        raw = z.read("data/like.js").decode("utf-8")
    json_str = re.sub(r"^\s*window\.YTD\.like\.part0\s*=\s*", "", raw)
    return [item["like"] for item in json.loads(json_str)]


def fetch_redirect_location(tco_url, max_retries=4):
    # 連續打幾千次之後 t.co 偶爾會回 429/503——這種要重試，不能直接當成「這則沒有媒體」處理掉（第一次
    # 整批跑完就是吃了這個虧：跑了兩小時後開始被限流，舊版沒分辨就把之後全部誤判成沒有媒體）。
    delay = 2
    for attempt in range(max_retries):
        try:
            r = requests.head(tco_url, allow_redirects=False, timeout=10)
        except requests.RequestException:
            time.sleep(delay)
            delay *= 2
            continue
        if r.status_code in (429, 503):
            time.sleep(delay)
            delay *= 2
            continue
        return r.headers.get("location", "")
    raise RateLimited(tco_url)


def resolve_media(tweet_id, text):
    # 文字裡最後出現的 t.co 通常才是媒體連結，但保險起見每個候選都試一次，用重導向目標裡的 tweet id
    # 確認真的是同一則貼文自己的媒體（不是貼文裡另外貼的外部連結）。fetch_redirect_location 重試還是
    # 失敗會丟出 RateLimited，直接讓它往上傳給呼叫端（main）——不能在這裡吞掉當成「沒有媒體」，不然
    # 就是重蹈第一次整批跑完的覆轍：跑了兩小時後開始被限流，沒分辨這兩種情況，導致封存檔後面約 8,900
    # 則全部被誤判成沒有媒體，永遠不會重跑。
    for tco in TCO_RE.findall(text):
        location = fetch_redirect_location(tco)
        m = MEDIA_URL_RE.match(location)
        if m and m.group(2) == tweet_id:
            return m.group(1), "video" if m.group(3) == "video" else "photo"
    return None, None


def load_progress():
    if PROGRESS_PATH.exists():
        with open(PROGRESS_PATH, encoding="utf-8") as f:
            return json.load(f)
    return {}


LOCK_PATH = Path(__file__).parent / "twitter_import.lock"


def save_progress(progress):
    with open(PROGRESS_PATH, "w", encoding="utf-8") as f:
        json.dump(progress, f, ensure_ascii=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("archive", help="Twitter/X 資料封存的 zip 檔路徑")
    parser.add_argument("--limit", type=int, default=None, help="只處理前 N 則比對到的貼文（小規模測試用）")
    parser.add_argument("--delay", type=float, default=0.3, help="每則之間等待秒數，別把 t.co 打太兇（預設 0.3）")
    parser.add_argument("--redo-status", default=None,
                         help="把 progress 裡狀態符合的項目清掉重跑，例如 --redo-status no_media"
                              "（重新檢查之前可能被限流誤判成沒有媒體的那些）")
    args = parser.parse_args()

    # 排它鎖：曾經同一個指令被背景執行環境同時啟動兩份，兩邊搶著讀寫同一份 progress 檔案，後寫的直接
    # 蓋掉先寫的，白白重工還浪費 t.co 的額度。open(..., "x") 是原子操作，檔案已存在就直接失敗——鎖不到
    # 就整個不跑，不用猜是不是真的有另一份在跑。
    try:
        LOCK_PATH.touch(exist_ok=False)
    except FileExistsError:
        print(f"偵測到 {LOCK_PATH} 已存在，代表已經有一份在跑（或上次沒正常結束）——"
              f"確定沒有其他份在跑的話，手動刪掉這個檔案再重跑。")
        sys.exit(1)

    try:
        _run(args)
    finally:
        LOCK_PATH.unlink(missing_ok=True)


def _run(args):
    hashtags = load_hashtags()
    likes = parse_archive(args.archive)
    print(f"封存檔共 {len(likes)} 則按讚紀錄")

    matched = [item for item in likes if matched_characters(item.get("fullText", ""), hashtags)]
    print(f"比對到角色關鍵字：{len(matched)} 則")

    progress = load_progress()
    # retry_later 本來就是「這次被限流、下次一定要再試」的標記，每次啟動都自動清掉重跑；
    # --redo-status 則是手動指定要重跑哪種狀態（例如上一批用舊版程式碼跑出來、可能誤判的 no_media）。
    reopen = {tid for tid, status in progress.items() if status == "retry_later"}
    if args.redo_status:
        reopen |= {tid for tid, status in progress.items() if status == args.redo_status}
    for tid in reopen:
        del progress[tid]
    if reopen:
        print(f"重新開放 {len(reopen)} 則之前的紀錄，這次會重新檢查")

    remaining = [item for item in matched if item["tweetId"] not in progress]
    todo = remaining[:args.limit] if args.limit else remaining
    print(f"已處理過：{len(matched) - len(remaining)} 則；這次要處理：{len(todo)} 則")

    stats = {"added": 0, "no_media": 0, "dedup_or_no_match": 0, "retry_later": 0, "error": 0}
    consecutive_rate_limited = 0
    for i, item in enumerate(todo, 1):
        tweet_id, text = item["tweetId"], item.get("fullText", "")
        try:
            author, media_type = resolve_media(tweet_id, text)
        except RateLimited:
            progress[tweet_id] = "retry_later"
            stats["retry_later"] += 1
            consecutive_rate_limited += 1
            if consecutive_rate_limited >= 3:
                print(f"  [{i}/{len(todo)}] 連續被限流 {consecutive_rate_limited} 次，冷卻 60 秒再繼續…")
                time.sleep(60)
                consecutive_rate_limited = 0
            time.sleep(args.delay)
            continue
        consecutive_rate_limited = 0

        if not author:
            progress[tweet_id] = "no_media"
            stats["no_media"] += 1
        else:
            url = f"https://x.com/{author}/status/{tweet_id}"
            try:
                r = requests.post(
                    f"{BACKEND_URL}/collect",
                    headers={"Content-Type": "application/json", "X-Collect-Secret": COLLECT_SECRET},
                    json={"url": url, "author": author, "text": text, "type": media_type, "announce": False},
                    timeout=15,
                )
                added = r.json().get("added_to", []) if r.ok else []
                if added:
                    progress[tweet_id] = f"added:{','.join(added)}"
                    stats["added"] += 1
                else:
                    progress[tweet_id] = "dedup_or_no_match"
                    stats["dedup_or_no_match"] += 1
            except requests.RequestException as e:
                stats["error"] += 1
                print(f"  [{i}/{len(todo)}] {tweet_id} 送出失敗：{e}")
                time.sleep(args.delay)
                continue  # 不寫進 progress，下次重跑會重試

        if i % 50 == 0 or i == len(todo):
            print(f"  進度 {i}/{len(todo)} — added={stats['added']} no_media={stats['no_media']} "
                  f"skip={stats['dedup_or_no_match']} retry_later={stats['retry_later']} error={stats['error']}")
            save_progress(progress)
        time.sleep(args.delay)

    save_progress(progress)
    print("完成：", stats)


if __name__ == "__main__":
    main()
