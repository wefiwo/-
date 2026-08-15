"""Self-check for /collect's hashtag matching + dedup logic (the one non-trivial branch)."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

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
        self._real_hashtags_bopomofo = app_module.HASHTAGS_BOPOMOFO
        app_module.HASHTAGS = {
            "秧秧": ["YangyangXuanling"], "長離": ["Changli"], "達妮婭": ["Denia"],
            "金城": ["Jincheng"], "景然": ["Jingran"], "瑾軒": ["Jinxuan"],
        }
        app_module.HASHTAGS_PINYIN = app_module.build_pinyin_table(app_module.HASHTAGS)
        app_module.HASHTAGS_BOPOMOFO = app_module.build_bopomofo_table(app_module.HASHTAGS)
        self.addCleanup(self._restore)

    def _restore(self):
        app_module.COLLECTED_PATH.unlink(missing_ok=True)
        app_module.COLLECTED_PATH = self._real_path
        app_module.HASHTAGS = self._real_hashtags
        app_module.HASHTAGS_PINYIN = self._real_hashtags_pinyin
        app_module.HASHTAGS_BOPOMOFO = self._real_hashtags_bopomofo

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

    def test_delete_entry_removes_matching_url(self):
        app_module.save_collected({"秧秧": [{"url": "https://x.com/a/status/1", "author": "a", "type": "photo"}]})
        self.assertTrue(app_module.delete_entry("秧秧", "https://x.com/a/status/1"))
        self.assertEqual(app_module.load_collected()["秧秧"], [])

    def test_delete_entry_returns_false_when_url_not_found(self):
        app_module.save_collected({"秧秧": [{"url": "https://x.com/a/status/1", "author": "a", "type": "photo"}]})
        self.assertFalse(app_module.delete_entry("秧秧", "https://x.com/nope/status/9"))
        self.assertEqual(len(app_module.load_collected()["秧秧"]), 1)

    def test_delete_entry_matches_the_vxtwitter_link_shown_in_replies(self):
        # /抓圖 的回覆秀出的是 fix_embed_url() 轉過的 vxtwitter.com 連結，使用者複製貼上那個網址進來
        # 刪也要能對上 collected.json 裡存的原始 x.com 網址。
        app_module.save_collected({"秧秧": [{"url": "https://x.com/a/status/1", "author": "a", "type": "photo"}]})
        self.assertTrue(app_module.delete_entry("秧秧", "https://vxtwitter.com/a/status/1"))
        self.assertEqual(app_module.load_collected()["秧秧"], [])

    def test_delete_entry_by_hash_removes_matching_entry(self):
        entry = {"url": "https://x.com/a/status/1", "author": "a", "type": "photo"}
        app_module.save_collected({"秧秧": [entry]})
        deleted = app_module.delete_entry_by_hash("秧秧", app_module.url_hash(entry["url"]))
        self.assertEqual(deleted, entry)
        self.assertEqual(app_module.load_collected()["秧秧"], [])

    def test_delete_entry_by_hash_returns_none_when_not_found(self):
        entry = {"url": "https://x.com/a/status/1", "author": "a", "type": "photo"}
        app_module.save_collected({"秧秧": [entry]})
        self.assertIsNone(app_module.delete_entry_by_hash("秧秧", "deadbeef0000"))
        self.assertEqual(len(app_module.load_collected()["秧秧"]), 1)

    def test_build_pick_reply_single_entry_has_no_numbering(self):
        entries = [{"url": "https://x.com/a/status/1", "author": "a", "type": "photo"}]
        content, components, followups = app_module.build_pick_reply("秧秧", "圖片", entries)
        self.assertNotIn("1. ", content)
        self.assertEqual(len(components[0]["components"]), 1)
        self.assertNotIn("label", components[0]["components"][0])
        self.assertEqual(followups, [])

    def test_build_pick_reply_multiple_entries_are_numbered(self):
        entries = [
            {"url": "https://x.com/a/status/1", "author": "a", "type": "photo"},
            {"url": "https://x.com/b/status/2", "author": "b", "type": "photo"},
        ]
        content, components, followups = app_module.build_pick_reply("秧秧", "圖片", entries)
        self.assertIn("1. ", content)
        self.assertIn("2. ", content)
        self.assertIn("（2 張）", content)
        buttons = components[0]["components"]
        self.assertEqual([b["label"] for b in buttons], ["1", "2"])
        self.assertNotEqual(buttons[0]["custom_id"], buttons[1]["custom_id"])
        self.assertEqual(followups, [])

    def test_build_pick_reply_splits_beyond_five_into_followups(self):
        # Discord 只幫一則訊息裡的前 5 個連結產生預覽圖，第 6~10 張要拆成 follow-up 訊息，各自帶自己
        # 那幾張的刪除按鈕。
        entries = [{"url": f"https://x.com/a/status/{i}", "author": "a", "type": "photo"} for i in range(7)]
        content, components, followups = app_module.build_pick_reply("秧秧", "圖片", entries)
        self.assertIn("5. ", content)
        self.assertNotIn("6. ", content)
        self.assertEqual(len(components[0]["components"]), 5)
        self.assertEqual(len(followups), 1)
        self.assertIn("6. ", followups[0]["content"])
        self.assertIn("7. ", followups[0]["content"])
        self.assertEqual(len(followups[0]["components"][0]["components"]), 2)

    def test_build_stats_content_counts_across_characters(self):
        app_module.save_collected({
            "秧秧": [
                {"url": "https://x.com/a/status/1", "author": "a", "type": "photo"},
                {"url": "https://x.com/a/status/2", "author": "a", "type": "video"},
            ],
            "長離": [{"url": "https://x.com/b/status/3", "author": "b", "type": "photo"}],
        })
        content = app_module.build_stats_content()
        self.assertIn("📷 2 張圖片", content)
        self.assertIn("🎬 1 部影片", content)
        self.assertIn("2 個有收藏", content)
        # 金城/景然/瑾軒/達妮婭 in the test HASHTAGS set have nothing collected
        self.assertIn("4 個還是空的", content)
        self.assertIn("秧秧 - 2", content)

    def test_url_choices_filters_by_author_or_url_substring(self):
        app_module.save_collected({"秧秧": [
            {"url": "https://x.com/artistA/status/1", "author": "artistA", "type": "photo"},
            {"url": "https://x.com/artistB/status/2", "author": "artistB", "type": "video"},
        ]})
        choices = app_module.url_choices("秧秧", "artista")
        self.assertEqual([c["value"] for c in choices], ["https://x.com/artistA/status/1"])

    def test_build_list_content_shows_counts_and_entries(self):
        app_module.save_collected({"秧秧": [
            {"url": "https://x.com/a/status/1", "author": "a", "type": "photo"},
            {"url": "https://x.com/b/status/2", "author": "b", "type": "video"},
        ]})
        content = app_module.build_list_content("秧秧", None)
        self.assertIn("📷 1 張圖片", content)
        self.assertIn("🎬 1 部影片", content)
        self.assertIn("https://x.com/a/status/1", content)
        self.assertIn("https://x.com/b/status/2", content)

    def test_build_list_content_filters_by_type(self):
        app_module.save_collected({"秧秧": [
            {"url": "https://x.com/a/status/1", "author": "a", "type": "photo"},
            {"url": "https://x.com/b/status/2", "author": "b", "type": "video"},
        ]})
        content = app_module.build_list_content("秧秧", "影片")
        self.assertNotIn("https://x.com/a/status/1", content)
        self.assertIn("https://x.com/b/status/2", content)

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

    def test_collect_accepts_facebook_post_url_with_author_from_url(self):
        payload = {
            "url": "https://www.facebook.com/some.artist/posts/pfbid02abc123?__cft__[0]=xyz",
            "author": "should-be-ignored",  # URL wins, same as X
            "type": "photo",
            "text": "#YangyangXuanling fanart",
        }
        r = self.client.post("/collect", json=payload, headers={"X-Collect-Secret": "test-secret"})
        self.assertEqual(r.get_json()["added_to"], ["秧秧"])
        self.assertEqual(app_module.load_collected()["秧秧"][0]["url"], "https://www.facebook.com/some.artist/posts/pfbid02abc123")
        self.assertEqual(app_module.load_collected()["秧秧"][0]["author"], "some.artist")

    def test_collect_accepts_facebook_reel_with_valid_author(self):
        payload = {
            "url": "https://www.facebook.com/reel/1234567890",
            "author": "some.artist",
            "type": "video",
            "text": "#YangyangXuanling fanart",
        }
        r = self.client.post("/collect", json=payload, headers={"X-Collect-Secret": "test-secret"})
        self.assertEqual(r.get_json()["added_to"], ["秧秧"])

    def test_collect_rejects_facebook_reel_with_bad_author(self):
        payload = {
            "url": "https://www.facebook.com/reel/1234567890",
            "author": "not a valid username!",
            "type": "video",
            "text": "#YangyangXuanling fanart",
        }
        r = self.client.post("/collect", json=payload, headers={"X-Collect-Secret": "test-secret"})
        self.assertEqual(r.status_code, 400)

    def test_collect_accepts_facebook_group_post_with_valid_author(self):
        payload = {
            "url": "https://www.facebook.com/groups/fanart.group/posts/998877?__cft__[0]=xyz",
            "author": "some.artist",
            "type": "photo",
            "text": "#YangyangXuanling fanart",
        }
        r = self.client.post("/collect", json=payload, headers={"X-Collect-Secret": "test-secret"})
        self.assertEqual(r.get_json()["added_to"], ["秧秧"])
        self.assertEqual(
            app_module.load_collected()["秧秧"][0]["url"],
            "https://www.facebook.com/groups/fanart.group/posts/998877",
        )

    def test_collect_facebook_requires_hash_prefix_on_keyword(self):
        # X/IG match a keyword anywhere in the text; Facebook must not — plain mentions without a
        # leading # are way too common there (discussion posts, not just fanart) to trust loosely.
        payload = {
            "url": "https://www.facebook.com/some.artist/posts/pfbid02abc123",
            "author": "irrelevant",
            "type": "photo",
            "text": "just talking about YangyangXuanling, no fanart here",  # keyword present, no #
        }
        r = self.client.post("/collect", json=payload, headers={"X-Collect-Secret": "test-secret"})
        self.assertEqual(r.get_json()["added_to"], [])

        payload["text"] = "#YangyangXuanling fanart"
        payload["url"] = "https://www.facebook.com/some.artist/posts/pfbid02abc124"  # avoid the dedup path
        r = self.client.post("/collect", json=payload, headers={"X-Collect-Secret": "test-secret"})
        self.assertEqual(r.get_json()["added_to"], ["秧秧"])

    def test_collect_announce_flag_skipped_without_channel_configured(self):
        # ANNOUNCE_CHANNEL_IDS is empty in the test env — announce:true shouldn't attempt a request.
        payload = {"url": "https://x.com/a/status/9", "author": "a", "type": "photo", "text": "#YangyangXuanling", "announce": True}
        with patch("app.requests.post") as mock_post:
            r = self.client.post("/collect", json=payload, headers={"X-Collect-Secret": "test-secret"})
        self.assertEqual(r.get_json()["added_to"], ["秧秧"])
        mock_post.assert_not_called()

    def test_collect_announce_flag_posts_to_both_configured_channels(self):
        payload = {"url": "https://x.com/a/status/10", "author": "a", "type": "photo", "text": "#YangyangXuanling", "announce": True}
        with patch.object(app_module, "ANNOUNCE_CHANNEL_IDS", ["111", "222"]), patch("app.requests.post") as mock_post:
            r = self.client.post("/collect", json=payload, headers={"X-Collect-Secret": "test-secret"})
        self.assertEqual(r.get_json()["added_to"], ["秧秧"])
        self.assertEqual(mock_post.call_count, 2)
        called_urls = {c.args[0] for c in mock_post.call_args_list}
        self.assertEqual(called_urls, {
            "https://discord.com/api/v10/channels/111/messages",
            "https://discord.com/api/v10/channels/222/messages",
        })

    def test_collect_without_announce_flag_never_posts(self):
        payload = {"url": "https://x.com/a/status/11", "author": "a", "type": "photo", "text": "#YangyangXuanling"}
        with patch.object(app_module, "ANNOUNCE_CHANNEL_IDS", ["111"]), patch("app.requests.post") as mock_post:
            self.client.post("/collect", json=payload, headers={"X-Collect-Secret": "test-secret"})
        mock_post.assert_not_called()

    def test_get_autocomplete_endpoint_returns_matches(self):
        r = self.client.get("/autocomplete", query_string={"q": "央"})
        self.assertEqual(r.status_code, 200)
        self.assertIn("秧秧", r.get_json())

    def test_autocomplete_matches_homophone(self):
        # 秧秧 is pinyin "yangyang"; 央 is a homophone of 秧 (both "yang") but a different character.
        self.assertIn("秧秧", app_module.autocomplete_matches("央"))
        self.assertIn("秧秧", app_module.autocomplete_matches("秧"))  # exact substring still matches too
        self.assertNotIn("秧秧", app_module.autocomplete_matches("完全不相關"))

    def test_autocomplete_heteronym_override(self):
        # 長 is polyphonic (cháng vs zhǎng); pypinyin defaults to zhǎng here without the override
        # registered in app.py, which would break matching on "常" (cháng)-sounding homophones.
        self.assertIn("長離", app_module.autocomplete_matches("常"))

    def test_autocomplete_ni_reading_override(self):
        # pypinyin's dictionary default for 妮 is nī, but nobody actually says it that way in these
        # character names — everyone reads/types it as ní (same as 尼/泥), so it needs the same kind
        # of override as 長離's heteronym fix above.
        self.assertIn("達妮婭", app_module.autocomplete_matches("尼"))
        self.assertIn("達妮婭", app_module.autocomplete_matches("泥"))

    def test_autocomplete_matches_exact_syllable_not_prefix(self):
        # jīn (金) shouldn't match jǐng (景然) just because the string "jin" happens to be a
        # literal prefix of "jing" once pinyin syllables get concatenated without boundaries.
        self.assertIn("金城", app_module.autocomplete_matches("金"))
        self.assertNotIn("景然", app_module.autocomplete_matches("金"))

    def test_autocomplete_matches_same_tone_only(self):
        # 金 is jīn (1st tone); 瑾 is jǐn (3rd tone) — same toneless reading but a different tone,
        # so it shouldn't count as a homophone match.
        self.assertIn("金城", app_module.autocomplete_matches("金"))
        self.assertNotIn("瑾軒", app_module.autocomplete_matches("金"))

    def test_autocomplete_matches_bopomofo(self):
        # Discord's autocomplete box sometimes can't reach a Zhuyin IME's candidate popup, so it
        # submits the raw bopomofo symbols before a character was ever selected (秧 -> ㄧㄤ).
        self.assertIn("秧秧", app_module.autocomplete_matches("ㄧㄤ"))
        self.assertNotIn("秧秧", app_module.autocomplete_matches("ㄔㄤ"))


if __name__ == "__main__":
    unittest.main()
