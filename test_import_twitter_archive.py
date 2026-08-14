"""Self-check for import_twitter_archive.py's parsing logic (no network calls)."""
import io
import json
import os
import unittest
import zipfile

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
