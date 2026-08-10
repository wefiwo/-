"""Run once (and again whenever the command shape changes) to register the /抓圖 slash command."""
import os

import requests
from dotenv import load_dotenv

load_dotenv()

API_BASE = "https://discord.com/api/v10"
BOT_TOKEN = os.environ["DISCORD_BOT_TOKEN"]
headers = {"Authorization": f"Bot {BOT_TOKEN}"}

app_id = requests.get(f"{API_BASE}/oauth2/applications/@me", headers=headers).json()["id"]
print("Application ID:", app_id)

command = {
    "name": "抓圖",
    "description": "從 X 抓取角色圖片或影片",
    "integration_types": [1],  # 1 = USER_INSTALL (works without adding the bot to a server)
    "contexts": [0, 1, 2],  # 0=guild, 1=bot DM, 2=group DM/private channel
    "options": [
        {
            "name": "角色",
            "description": "角色名稱",
            "type": 3,  # STRING
            "required": True,
            "autocomplete": True,
        },
        {
            "name": "類型",
            "description": "圖片或影片（預設圖片）",
            "type": 3,
            "required": False,
            "choices": [
                {"name": "圖片", "value": "圖片"},
                {"name": "影片", "value": "影片"},
            ],
        },
    ],
}

guild_id = os.environ.get("GUILD_ID")  # optional: set for instant-propagate testing in one server
endpoint = f"{API_BASE}/applications/{app_id}/guilds/{guild_id}/commands" if guild_id else f"{API_BASE}/applications/{app_id}/commands"

resp = requests.put(endpoint, headers=headers, json=[command])
resp.raise_for_status()
print("Registered:", resp.json())
if not guild_id:
    print("這是全域指令，Discord 同步到各端可能要等最多 1 小時；要秒生效測試，先在 .env 設 GUILD_ID 再重跑一次。")
