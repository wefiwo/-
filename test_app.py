"""Self-check for /collect's hashtag matching + dedup logic (the one non-trivial branch)."""
import os
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("DISCORD_PUBLIC_KEY", "00" * 32)
os.environ.setdefault("DISCORD_BOT_TOKEN", "test-token")
os.environ.setdefault("DISCORD_APPLICATION_ID", "123")
os.environ.setdefault("COLLECT_SECRET", "test-secret")

import app as app_module  # noqa: E402


class TestCollect(unittest.TestCase):
    def setUp(self):
        self.client = app_module.app.test_client()
        # never touch the real collected.json (it holds your actual data) — redirect to a
        # scratch file for the duration of each test and restore afterwards.
        self._real_path = app_module.COLLECTED_PATH
        app_module.COLLECTED_PATH = Path(tempfile.mktemp(suffix=".json"))
        # also isolate from the real (ever-growing) hashtags.json, so new characters you add
        # later can't collide with these fixed test keywords.
        self._real_hashtags = app_module.HASHTAGS
        self._real_hashtags_pinyin = app_module.HASHTAGS_PINYIN
        app_module.HASHTAGS = {"秧秧": ["YangyangXuanling"]}
        app_module.HASHTAGS_PINYIN = {name: "".join(app_module.lazy_pinyin(name)) for name in app_module.HASHTAGS}
        self.addCleanup(self._restore)

    def _restore(self):
        app_module.COLLECTED_PATH.unlink(missing_ok=True)
        app_module.COLLECTED_PATH = self._real_path
        app_module.HASHTAGS = self._real_hashtags
        app_module.HASHTAGS_PINYIN = self._real_hashtags_pinyin

    def test_collect_matches_hashtag_and_dedups(self):
        payload = {
            "url": "https://x.com/artist/status/1",
            "author": "artist",
            "type": "photo",
            "text": "look #YangyangXuanling fanart",
        }
        headers = {"X-Collect-Secret": "test-secret"}

        r1 = self.client.post("/collect", json=payload, headers=headers)
        self.assertEqual(r1.get_json()["added_to"], ["秧秧"])

        r2 = self.client.post("/collect", json=payload, headers=headers)  # same url again
        self.assertEqual(r2.get_json()["added_to"], [])

        self.assertEqual(len(app_module.load_collected()["秧秧"]), 1)

    def test_collect_rejects_wrong_secret(self):
        r = self.client.post(
            "/collect",
            json={"url": "https://x.com/a/status/2", "author": "a", "type": "photo", "text": "#YangyangXuanling"},
            headers={"X-Collect-Secret": "nope"},
        )
        self.assertEqual(r.status_code, 401)

    def test_collect_no_hashtag_match_is_ignored(self):
        payload = {"url": "https://x.com/a/status/3", "author": "a", "type": "photo", "text": "unrelated post"}
        r = self.client.post("/collect", json=payload, headers={"X-Collect-Secret": "test-secret"})
        self.assertEqual(r.get_json()["added_to"], [])

    def test_collect_rejects_non_x_url(self):
        payload = {"url": "https://evil.example.com/free-nitro", "author": "a", "type": "photo", "text": "#YangyangXuanling"}
        r = self.client.post("/collect", json=payload, headers={"X-Collect-Secret": "test-secret"})
        self.assertEqual(r.status_code, 400)

    def test_collect_accepts_instagram_url_with_valid_author(self):
        payload = {
            "url": "https://www.instagram.com/p/ABC123xyz/",
            "author": "some.artist_1",
            "type": "photo",
            "text": "#YangyangXuanling fanart",
        }
        r = self.client.post("/collect", json=payload, headers={"X-Collect-Secret": "test-secret"})
        self.assertEqual(r.get_json()["added_to"], ["秧秧"])

    def test_collect_rejects_instagram_url_with_bad_author(self):
        payload = {
            "url": "https://www.instagram.com/p/ABC123xyz/",
            "author": "not a valid username!",
            "type": "photo",
            "text": "#YangyangXuanling fanart",
        }
        r = self.client.post("/collect", json=payload, headers={"X-Collect-Secret": "test-secret"})
        self.assertEqual(r.status_code, 400)

    def test_autocomplete_matches_homophone(self):
        # 秧秧 is pinyin "yangyang"; 央 is a homophone of 秧 (both "yang") but a different character.
        self.assertIn("秧秧", app_module.autocomplete_matches("央"))
        self.assertIn("秧秧", app_module.autocomplete_matches("秧"))  # exact substring still matches too
        self.assertNotIn("秧秧", app_module.autocomplete_matches("完全不相關"))


if __name__ == "__main__":
    unittest.main()
