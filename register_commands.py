"""Registers the /抓圖, /抓圖清單, /抓圖刪除, /抓圖統計 slash commands. `register()` is imported and
called once by app.py on startup (see AUTO_REGISTER_COMMANDS below), so a fresh fork's commands show
up without the owner needing to know this script exists. Kept runnable standalone too — that's the
only way to do instant-propagate testing in one server via GUILD_ID (see CLAUDE.md), since a fresh
app boot only ever registers the global (slow-to-propagate) command set.

Usage: python register_commands.py
"""
import os

import requests
from dotenv import load_dotenv

load_dotenv()

API_BASE = "https://discord.com/api/v10"

CHARACTER_OPTION = {"name": "角色", "description": "角色名稱", "type": 3, "required": True, "autocomplete": True}
CHARACTER_OPTION_OPTIONAL = {**CHARACTER_OPTION, "required": False, "description": "只看這幾個角色的收藏數與排名，可用逗號隔開查多個（不填則顯示整體統計）"}
CHARACTER_OPTION_RANDOM = {**CHARACTER_OPTION, "required": False, "description": "角色名稱（留空則隨機挑一位角色）"}
TYPE_CHOICES = [{"name": "圖片", "value": "圖片"}, {"name": "影片", "value": "影片"}]
COMMON = {"integration_types": [1], "contexts": [0, 1, 2]}  # USER_INSTALL; guild/bot DM/group DM

COMMANDS = [
    {
        **COMMON,
        "name": "抓圖",
        "description": "從 X 抓取角色圖片或影片",
        "options": [
            CHARACTER_OPTION_RANDOM,
            {"name": "類型", "description": "圖片或影片（預設圖片）", "type": 3, "required": False, "choices": TYPE_CHOICES},
            {"name": "數量", "description": "一次要幾張（預設 1，最多 10）", "type": 4, "required": False, "min_value": 1, "max_value": 10},
            {"name": "作者", "description": "只抽這個畫師/帳號的（子字串比對，不填則不限）", "type": 3, "required": False},
        ],
    },
    {
        **COMMON,
        "name": "抓圖清單",
        "description": "查看某個角色收藏了哪些貼文",
        "options": [
            CHARACTER_OPTION,
            {"name": "類型", "description": "只看圖片或影片（不填顯示全部）", "type": 3, "required": False, "choices": TYPE_CHOICES},
        ],
    },
    {
        **COMMON,
        "name": "抓圖刪除",
        "description": "從某個角色的收藏裡刪除一則貼文",
        "options": [
            CHARACTER_OPTION,
            {"name": "網址", "description": "要刪除的貼文網址", "type": 3, "required": True, "autocomplete": True},
        ],
    },
    {
        **COMMON,
        "name": "抓圖統計",
        "description": "看所有角色的收藏概覽",
        "options": [CHARACTER_OPTION_OPTIONAL],
    },
]


def register(app_id, bot_token, guild_id=None):
    headers = {"Authorization": f"Bot {bot_token}"}
    endpoint = (
        f"{API_BASE}/applications/{app_id}/guilds/{guild_id}/commands" if guild_id
        else f"{API_BASE}/applications/{app_id}/commands"
    )
    resp = requests.put(endpoint, headers=headers, json=COMMANDS)
    resp.raise_for_status()
    return resp.json()


if __name__ == "__main__":
    BOT_TOKEN = os.environ["DISCORD_BOT_TOKEN"]
    headers = {"Authorization": f"Bot {BOT_TOKEN}"}
    app_id = requests.get(f"{API_BASE}/oauth2/applications/@me", headers=headers).json()["id"]
    print("Application ID:", app_id)

    guild_id = os.environ.get("GUILD_ID")  # optional: set for instant-propagate testing in one server
    result = register(app_id, BOT_TOKEN, guild_id)
    print("Registered:", result)
    if not guild_id:
        print("這是全域指令，Discord 同步到各端可能要等最多 1 小時；要秒生效測試，先在 .env 設 GUILD_ID 再重跑一次。")
