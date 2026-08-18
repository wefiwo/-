"""替每個中文關鍵字補上簡體字版本，寫回 hashtags.json——只加不減，繁體原本的關鍵字照樣留著。

只處理鳴潮那個中文角色區塊（STOP_AT 之前）。STOP_AT 之後是 Hololive 日文 VTuber 的名字，
共用漢字但不是中文，拿簡體轉換套用上去只會把人名轉成不存在的假字，所以不碰。

換角色/加角色照舊改 hashtags.json，如果新增的角色是中文名字，這支重跑一次就會把簡體版本
自動補齊，不用手動一個個轉。

Usage:
    python add_simplified_keywords.py
"""
import json
from pathlib import Path

import zhconv

HASHTAGS_PATH = Path(__file__).parent / "hashtags.json"
STOP_AT = "ときのそら"


def add_simplified(hashtags, stop_at=STOP_AT):
    """回傳 (新的 hashtags dict, 新增的 (角色, 繁體關鍵字, 簡體關鍵字) 清單)。不修改傳入的 dict。"""
    added = []
    result = {}
    reached_stop = False
    for name, kws in hashtags.items():
        if name == stop_at:
            reached_stop = True
        if reached_stop or name.startswith("_"):
            result[name] = kws
            continue
        new_kws = list(kws)
        for kw in kws:
            prefix = "#" if kw.startswith("#") else ""
            simp = prefix + zhconv.convert(kw[len(prefix):], "zh-cn")
            if simp != kw and simp not in new_kws:
                new_kws.append(simp)
                added.append((name, kw, simp))
        result[name] = new_kws
    return result, added


def main():
    with open(HASHTAGS_PATH, encoding="utf-8") as f:
        hashtags = json.load(f)
    result, added = add_simplified(hashtags)
    with open(HASHTAGS_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"新增 {len(added)} 個簡體關鍵字：")
    for name, kw, simp in added:
        print(f"  {name}: {kw} -> {simp}")


if __name__ == "__main__":
    main()
