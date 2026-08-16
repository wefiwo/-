"""Self-check for check_dead_links.py's dead-link detection (no real network calls)."""
import os
import unittest
from unittest.mock import Mock, patch

os.environ.setdefault("COLLECT_SECRET", "test-secret")  # the module reads this at import time

import check_dead_links as checker  # noqa: E402


class TestCheckDeadLinks(unittest.TestCase):
    def test_fix_embed_url_rewrites_x_to_vxtwitter(self):
        self.assertEqual(
            checker.fix_embed_url("https://x.com/a/status/1"),
            "https://vxtwitter.com/a/status/1",
        )

    def test_fix_embed_url_leaves_unknown_domains_alone(self):
        self.assertEqual(checker.fix_embed_url("https://vxtwitter.com/a/status/1"), "https://vxtwitter.com/a/status/1")

    def test_is_dead_ambiguous_when_proxy_returns_scan_failure_page(self):
        # 這個字樣不是可靠的死亡證據——X 擋 NSFW 貼文的 guest token 存取，活著的敏感內容貼文一樣會
        # 回這個錯誤頁（見 check_dead_links.py 裡的說明），所以只能降級成「無法確定」，不能直接當死亡。
        resp = Mock(status_code=200, text="...Failed to scan your link! This may be due to...")
        with patch("check_dead_links.requests.get", return_value=resp):
            self.assertEqual(checker.is_dead("https://x.com/a/status/1"), "ambiguous")

    def test_is_dead_alive_for_a_normal_page(self):
        resp = Mock(status_code=200, text="<html>normal tweet embed</html>")
        with patch("check_dead_links.requests.get", return_value=resp):
            self.assertEqual(checker.is_dead("https://x.com/a/status/1"), "alive")

    def test_is_dead_true_on_http_error_status(self):
        resp = Mock(status_code=404, text="")
        with patch("check_dead_links.requests.get", return_value=resp):
            self.assertEqual(checker.is_dead("https://x.com/a/status/1"), "dead")

    def test_is_dead_returns_none_on_network_error(self):
        # 網路本身的問題（逾時、DNS 失敗…）不能當成連結真的死了——回 None 讓呼叫端跳過、下次重跑再查。
        import requests
        with patch("check_dead_links.requests.get", side_effect=requests.RequestException("boom")):
            self.assertIsNone(checker.is_dead("https://x.com/a/status/1"))


if __name__ == "__main__":
    unittest.main()
