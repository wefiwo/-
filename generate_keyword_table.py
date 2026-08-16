"""重新產生 角色關鍵字對照表.txt——從 hashtags.json（程式實際在讀的那份資料）產生給人看的文字版
對照表，取代原本兩份分開手動維護、容易漏改其中一份的做法。換角色/加角色只要改 hashtags.json，
這支重跑一次就好，不用再手動同步第二份。

Usage:
    python generate_keyword_table.py
"""
import json
from pathlib import Path

HASHTAGS_PATH = Path(__file__).parent / "hashtags.json"
OUTPUT_PATH = Path(__file__).parent / "角色關鍵字對照表.txt"


def build_table(hashtags):
    lines = []
    for name, keywords in hashtags.items():
        if name.startswith("_"):  # hashtags.json 自己的說明用 key，不是角色，跳過
            continue
        keywords = keywords if isinstance(keywords, list) else [keywords]
        lines.append(f"{name}：{'、'.join(keywords)}")
    return "\n".join(lines) + "\n"


def main():
    with open(HASHTAGS_PATH, encoding="utf-8") as f:
        hashtags = json.load(f)
    table = build_table(hashtags)
    OUTPUT_PATH.write_text(table, encoding="utf-8")
    print(f"已重新產生 {OUTPUT_PATH.name}（{table.count(chr(10))} 個角色）")


if __name__ == "__main__":
    main()
