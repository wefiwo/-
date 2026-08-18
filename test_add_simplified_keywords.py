"""Self-check for add_simplified_keywords.py's Traditional-to-Simplified keyword expansion."""
import unittest

import add_simplified_keywords as asck


class TestAddSimplifiedKeywords(unittest.TestCase):
    def test_adds_simplified_variant_and_keeps_the_traditional_one(self):
        result, added = asck.add_simplified({"長離": ["長離", "Changli"]}, stop_at="_stop")
        self.assertEqual(result, {"長離": ["長離", "Changli", "长离"]})
        self.assertEqual(added, [("長離", "長離", "长离")])

    def test_preserves_leading_hash_on_the_simplified_copy(self):
        result, _ = asck.add_simplified({"熾霞": ["#熾霞"]}, stop_at="_stop")
        self.assertEqual(result["熾霞"], ["#熾霞", "#炽霞"])

    def test_skips_keywords_unchanged_between_traditional_and_simplified(self):
        # 「秧秧」在簡繁都是同一個字，不該多出一份一模一樣的重複關鍵字。
        result, added = asck.add_simplified({"秧秧": ["秧秧", "Yangyang"]}, stop_at="_stop")
        self.assertEqual(result["秧秧"], ["秧秧", "Yangyang"])
        self.assertEqual(added, [])

    def test_stops_before_the_given_key_and_leaves_everything_after_it_untouched(self):
        # stop_at 之後是别的語言的名字（例如日文 VTuber），共用漢字但不是中文，不該被轉換。
        result, added = asck.add_simplified(
            {"長離": ["長離"], "ときのそら": ["ときのそら"]}, stop_at="ときのそら"
        )
        self.assertEqual(result, {"長離": ["長離", "长离"], "ときのそら": ["ときのそら"]})
        self.assertEqual(added, [("長離", "長離", "长离")])

    def test_does_not_duplicate_a_simplified_form_that_already_exists(self):
        result, added = asck.add_simplified({"鑒心": ["鑒心", "鉴心"]}, stop_at="_stop")
        self.assertEqual(result["鑒心"], ["鑒心", "鉴心"])
        self.assertEqual(added, [])


if __name__ == "__main__":
    unittest.main()
