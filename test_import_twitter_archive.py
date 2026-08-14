"""Self-check for import_twitter_archive.py's parsing logic (no network calls)."""
import io
import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import Mock, patch

os.environ.setdefault("COLLECT_SECRET", "test-secret")  # the module reads this at import time

import import_twitter_archive as importer  # noqa: E402


class TestImportTwitterArchive(unittest.TestCase):
    def test_matched_characters_uses_loose_x_style_matching(self):
        hashtags = {"秧秧": ["YangyangXuanling"], "長離": ["Changli"]}
        self.assertEqual(importer.matched_characters("look #YangyangXuanling fanart", hashtags), ["秧秧"])
        self.assertEqual(importer.matched_characters("unrelated post", hashtags), [])

    def test_media_url_re_extracts_author_and_type(self):
        m = importer.MEDIA_URL_RE.match("https://twitter.com/hyang331/status/2087820140348100869/photo/1")
        self.assertEqual(m.group(1), "hyang331")
        self.assertEqual(m.group(2), "2087820140348100869")
        self.assertEqual(m.group(3), "photo")

    def test_media_url_re_rejects_non_media_urls(self):
        self.assertIsNone(importer.MEDIA_URL_RE.match("https://twitter.com/someone/status/123"))
        self.assertIsNone(importer.MEDIA_URL_RE.match("https://example.com/not-twitter/photo/1"))

    def test_fetch_redirect_location_returns_immediately_on_success(self):
        ok_response = Mock(status_code=301, headers={"location": "https://twitter.com/a/status/1/photo/1"})
        with patch("import_twitter_archive.requests.head", return_value=ok_response) as mock_head:
            location = importer.fetch_redirect_location("https://t.co/x")
        self.assertEqual(location, "https://twitter.com/a/status/1/photo/1")
        mock_head.assert_called_once()

    def test_fetch_redirect_location_retries_past_429_then_succeeds(self):
        rate_limited = Mock(status_code=429, headers={})
        ok_response = Mock(status_code=301, headers={"location": "https://twitter.com/a/status/1/photo/1"})
        with patch("import_twitter_archive.requests.head", side_effect=[rate_limited, rate_limited, ok_response]), \
             patch("import_twitter_archive.time.sleep"):
            # max_retries 明講，不依賴預設值——預設值是特意壓低的速度/耐心取捨（少等、卡住的快點丟去
            # retry_later，讓外層繼續跑下一則），跟這裡要測的「重試最終會成功」是兩件事。
            location = importer.fetch_redirect_location("https://t.co/x", max_retries=3)
        self.assertEqual(location, "https://twitter.com/a/status/1/photo/1")

    def test_fetch_redirect_location_raises_rate_limited_after_exhausting_retries(self):
        rate_limited = Mock(status_code=429, headers={})
        with patch("import_twitter_archive.requests.head", return_value=rate_limited), \
             patch("import_twitter_archive.time.sleep"):
            with self.assertRaises(importer.RateLimited):
                importer.fetch_redirect_location("https://t.co/x", max_retries=3)

    def test_resolve_media_does_not_swallow_rate_limited(self):
        # 這是實際爆掉的那個 bug 的迴歸測試：resolve_media 不能把 RateLimited 吞掉當成「沒有媒體」，
        # 一定要讓例外往上傳給 main() 處理，不然重試/retry_later 那套機制全部形同虛設。
        with patch("import_twitter_archive.fetch_redirect_location", side_effect=importer.RateLimited("x")):
            with self.assertRaises(importer.RateLimited):
                importer.resolve_media("1", "https://t.co/x")

    def test_main_refuses_to_run_when_lock_already_held(self):
        # 這是背景執行環境曾經把同一個指令啟動兩份、兩邊搶著寫同一份 progress 檔案那個事故的迴歸測試。
        # 用暫存路徑代替真正的 LOCK_PATH——這支測試常常跟真的匯入程序同時跑，共用同一個檔案會互相卡到。
        test_lock = Path(tempfile.mktemp(suffix=".lock"))
        test_lock.touch(exist_ok=False)
        try:
            with patch.object(importer, "LOCK_PATH", test_lock), \
                 patch("sys.argv", ["import_twitter_archive.py", "dummy.zip"]), \
                 patch("import_twitter_archive._run") as mock_run:
                with self.assertRaises(SystemExit):
                    importer.main()
            mock_run.assert_not_called()
        finally:
            test_lock.unlink(missing_ok=True)

    def test_main_releases_lock_after_running(self):
        test_lock = Path(tempfile.mktemp(suffix=".lock"))
        try:
            with patch.object(importer, "LOCK_PATH", test_lock), \
                 patch("sys.argv", ["import_twitter_archive.py", "dummy.zip"]), \
                 patch("import_twitter_archive._run"):
                importer.main()
            self.assertFalse(test_lock.exists())
        finally:
            test_lock.unlink(missing_ok=True)

    def test_parse_archive_strips_js_assignment_prefix(self):
        payload = [{"like": {"tweetId": "1", "fullText": "hi", "expandedUrl": "x"}}]
        raw = "window.YTD.like.part0 = " + json.dumps(payload)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("data/like.js", raw)
        buf.seek(0)
        with open("_scratch_test_archive.zip", "wb") as f:
            f.write(buf.read())
        try:
            self.assertEqual(importer.parse_archive("_scratch_test_archive.zip"), [payload[0]["like"]])
        finally:
            import os
            os.remove("_scratch_test_archive.zip")


if __name__ == "__main__":
    unittest.main()
