"""Self-check for generate_keyword_table.py's hashtags.json -> 角色關鍵字對照表.txt formatting."""
import unittest

import generate_keyword_table as gen


class TestGenerateKeywordTable(unittest.TestCase):
    def test_build_table_formats_name_and_joins_keywords_with_dun_hao(self):
        table = gen.build_table({"秧秧": ["#秧秧", "Yangyang"], "長離": ["Changli"]})
        self.assertEqual(table, "秧秧：#秧秧、Yangyang\n長離：Changli\n")

    def test_build_table_skips_underscore_prefixed_keys(self):
        # hashtags.json 自己的說明用 key（例如 "_format"），不是角色，不該出現在對照表裡。
        table = gen.build_table({"_format": "說明文字", "秧秧": ["Yangyang"]})
        self.assertEqual(table, "秧秧：Yangyang\n")

    def test_build_table_wraps_a_bare_string_value_as_single_keyword(self):
        table = gen.build_table({"秧秧": "Yangyang"})
        self.assertEqual(table, "秧秧：Yangyang\n")


if __name__ == "__main__":
    unittest.main()
