# 抓圖 Discord Bot

三個 Slash Command，從**你自己在 X／Instagram／Facebook 按讚蒐集的收藏**裡管理貼文：`/抓圖`（角色 autocomplete + 類型：圖片/影片）隨機挑一則貼到 Discord，附上原貼文連結與繪師帳號；`/抓圖清單` 看某角色收藏了哪些、共幾張；`/抓圖刪除` 把收錯的一筆從收藏裡拿掉（網址欄位會自動帶出該角色目前收藏的貼文供選）。User Install 架構，私訊、群組、伺服器都能用，不需要把 bot 拉進伺服器。

## 為什麼是「按讚蒐集」而不是即時搜尋全網？

X 官方的搜尋 API 只開放付費方案，非官方的第三方爬蟲服務一樣要按量付費，而**自己寫程式登入帳號去爬 X 網頁**這條路，要嘛得想辦法繞過 X 的反自動化偵測（不做這個），要嘛做出來也三天兩頭被 X 改版弄壞——不划算也不穩。

所以改成完全免費、零風險的做法：你平常滑 X 看到喜歡的圖/影片，**按下愛心的當下**，一個裝在你瀏覽器裡的小腳本（userscript）會檢查貼文有沒有對到角色的 Hashtag，有的話就自動記錄下來。這不是自動化爬蟲——腳本只是在「你自己真人操作、已經登入的瀏覽器分頁」裡讀取畫面上的內容，沒有對 X 送出任何額外的請求，跟你手動複製貼上網址的效果一樣，只是自動化了「複製貼上」這個動作而已。

`/抓圖` 就是從這份收藏裡隨機挑一則貼出來。

## 檔案結構

```
app.py                # Flask：接收 Discord Interactions、驗簽、autocomplete、/抓圖、/collect、/hashtags
likewatcher.user.js   # 裝進瀏覽器（Tampermonkey）的按讚監看腳本
register_commands.py  # 註冊/更新 /抓圖 這個 slash command
hashtags.json          # 角色 → Hashtag 對照表，自行擴充，無上限
collected.json         # 你蒐集到的貼文（自動產生，第一次還沒有）
test_app.py            # /collect 比對＋去重邏輯的自我檢查
requirements.txt
.env.example / .env
```

## ⚠️ 先做這件事

你在對話裡貼了真實的 Discord Bot Token。已經幫你寫進 `.env`（該檔已加進 `.gitignore`，不會進版控），但這個 token 已經出現在聊天紀錄裡，等於外洩過一次。建議之後找時間到 Developer Portal → Bot → Reset Token 重置一次，養成習慣。

## 1. Discord Developer Portal 設定

1. https://discord.com/developers/applications → 選你的 App（或新建）。
2. **General Information**：複製 `PUBLIC KEY`，貼到 `.env` 的 `DISCORD_PUBLIC_KEY`。這是簽章驗證用的公鑰，`app.py` 靠它驗證每個進來的 request 真的來自 Discord。
3. **Installation**：
   - Installation Contexts 勾選 `User Install`（讓別人可以把這個 App 裝到自己帳號，不用邀請 bot 進伺服器）。
   - Install Link 選 Discord Provided Link 即可。
4. **General Information → Interactions Endpoint URL**：填你的 `https://<你的網域>/interactions`（見下方部署）。存檔時 Discord 會直接打一個 PING 過來驗證簽章，這一步 `app.py` 必須已經在跑且能被公網打到才會存檔成功。

## 2. 安裝套件

```bash
pip install -r requirements.txt
```

## 3. 裝按讚監看腳本

1. 瀏覽器裝 **Tampermonkey** 擴充功能（Chrome/Edge/Firefox 都有）。
2. Tampermonkey 面板 → 建立新腳本，把 [likewatcher.user.js](likewatcher.user.js) 的內容整份貼進去存檔。
3. 檔案開頭 `COLLECT_SECRET` 已經跟你 `.env` 的值對好了；如果 `.env` 的 `COLLECT_SECRET` 之後改掉，這裡也要跟著改。
4. 本機測試時 `BACKEND_URL` 保持 `http://localhost:8787` 就好（腳本是在你自己電腦的瀏覽器裡跑，直接打自己電腦的 Flask，不需要 ngrok，跟 Discord Interactions Endpoint 是兩件事）。之後部署到 Render，才需要把它換成 Render 網址（見部署章節）。

## 4. 註冊 Slash Command

```bash
python register_commands.py
```

改了 `register_commands.py` 裡的 command 定義（例如加選項）之後要重跑一次。

## 5. 本地測試

跑後端（這個視窗留著別關，也別在裡面打其他指令）：

```bash
python app.py
```

Discord 需要打到公網 HTTPS，本機用 ngrok 開個 tunnel（這個只是給 Discord 用，跟第 3 步的按讚腳本無關）：

```bash
ngrok http 8787
```

把 ngrok 給的 `https://xxx.ngrok-free.app/interactions` 填回 Developer Portal 的 Interactions Endpoint URL。

**實際測試流程：**
1. 去 X 上找一則有 `#YangyangXuanling`（或你在 `hashtags.json` 設的其他 hashtag）的貼文，按愛心。
2. 瀏覽器打開該分頁的開發者工具（F12）→ Console，應該會看到 `[抓圖收藏] ['秧秧'] 200 ...` 這樣的訊息。
3. 檢查 `collected.json` 有沒有多一筆資料。
4. 回 Discord 打 `/抓圖 秧秧`，應該會挑到剛剛那則。

跑自我檢查：

```bash
python -m unittest
```

## 6. 新增角色

編輯 `hashtags.json`，格式：

```json
{
  "角色名稱": ["Hashtag1", "Hashtag2"]
}
```

不用加 `#`，一個角色可以對多個 hashtag（例如簡稱 + 全名）。存檔後要重啟 `app.py` 才會生效（開機時讀一次進記憶體）；瀏覽器那邊的腳本每次重新整理頁面就會自動拉到最新的清單，不用改腳本本身。

## 7. 部署

隨便一台能長開的機器/PaaS 都行，重點是要有公網 HTTPS。`requirements.txt` 裡的 `waitress` 是跨平台的 WSGI server（Windows/Linux 都能跑），Start Command 統一用：

```
waitress-serve --host=0.0.0.0 --port=$PORT app:app
```

- **Render**：見下方「用 Render 部署」。
- **Railway / Fly.io**：流程類似，接 GitHub repo、設同樣的 Start Command、環境變數搬進它的 Variables 頁面即可。
- **自己的 VPS**：一樣跑 `waitress-serve`，前面接 Nginx/Caddy 做 TLS。

部署後把正式網域的 `/interactions` 填回 Interactions Endpoint URL，`.env` 的內容也要帶到部署環境的環境變數頁面，不要把 `.env` 傳上去（`.gitignore` 已經排除它）。**部署完後記得把 `likewatcher.user.js` 的 `BACKEND_URL` 也改成正式網域**，不然按讚蒐集還是只會送到你本機（`app.py` 沒開就會蒐集失敗）。

### 用 Render 部署

1. **把專案推上 GitHub**（Render 從 repo 部署）：
   ```bash
   git init
   git add .
   git commit -m "init"
   ```
   去 GitHub 網站新增一個空 repo（不要勾 Add README），複製它給的網址，然後：
   ```bash
   git remote add origin <你的repo網址>
   git branch -M main
   git push -u origin main
   ```
2. 去 https://render.com 用 GitHub 帳號登入 → **New +** → **Web Service** → 選剛剛那個 repo。
3. 設定：
   - Runtime: Python
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `waitress-serve --host=0.0.0.0 --port=$PORT app:app`
   - Instance Type: Free
4. **Environment** 分頁加五個變數（照你本機 `.env` 的值填，不要含 `GUILD_ID`）：`DISCORD_PUBLIC_KEY`、`DISCORD_BOT_TOKEN`、`DISCORD_APPLICATION_ID`、`COLLECT_SECRET`。
5. Deploy，等它跑完會給一個 `https://xxx.onrender.com` 網址。
6. 回 Developer Portal 把 Interactions Endpoint URL 換成 `https://xxx.onrender.com/interactions`，存檔。
7. `likewatcher.user.js` 的 `BACKEND_URL` 改成 `https://xxx.onrender.com`。
8. 本機 `.env` 把 `GUILD_ID` 那行刪掉（或整行拿掉不要留著），重跑一次 `python register_commands.py` 改回註冊全域指令，讓任何人裝了都能用（同步最多等 1 小時）。

免費方案閒置一段時間會休眠，有人打 `/抓圖` 時第一次可能要多等幾秒它醒過來，之後就正常。

**⚠️ Render 免費方案的檔案系統不會保留**：每次重新部署、甚至每次從休眠喚醒，都是全新的容器，`collected.json` 這個本機檔案會被清空。閒置一段時間就用一次的 bot，等於幾乎每次都在重蒐集。要讓收藏真的留得住，接下方的 Upstash（免費）。

### 讓收藏不會被清空：接 Upstash Redis（免費）

1. 去 https://upstash.com 註冊，**Create Database**（不要用首頁那個 72 小時就過期的臨時資料庫），選免費方案。
2. 建好後在資料庫頁面找到 **REST API** 區塊，複製 `UPSTASH_REDIS_REST_URL` 和 `UPSTASH_REDIS_REST_TOKEN` 兩個值。
3. 貼進 Render 的 Environment 分頁（新增這兩個變數），存檔重新部署。
4. 本機 `.env` 想順便測試的話也可以填一樣的值；不填的話本機照樣用本機檔案，互不影響。

設定好這兩個變數後，`app.py` 會自動改用 Upstash 存 `collected.json` 的內容，不再受 Render 重啟影響。

### 選用：按讚自動推播到指定 Discord 頻道

平常 `/抓圖` 是被動查詢（打指令才回覆），這個功能是主動推播：本機 Tampermonkey 選單開啟「自動推播到 Discord 頻道」開關（只影響那一台裝置，見 `likewatcher.user.js` 註解）之後，每次成功收藏新貼文，bot 會自己把它發到你指定的頻道。

這件事跟 User Install 是**兩回事**——User Install 只讓你能在私訊/群組打 `/抓圖`，但 bot 沒有真的加入任何伺服器，沒有頻道可以主動發言。要做到主動推播，得另外用一般的 bot 邀請連結把它加進伺服器：

1. 回 https://discord.com/developers/applications 選你的 App → **OAuth2 → URL Generator**。
2. **Scopes** 勾 `bot`；**Bot Permissions** 勾 `Send Messages`（要看得到頻道的話再加 `View Channel`）。
3. 複製頁面下方產生的網址，開啟它，選要加入的伺服器，授權。
4. Discord 打開**開發者模式**（設定 → 進階）才能右鍵頻道複製 ID：右鍵目標頻道 → **複製頻道 ID**。
5. 把這串 ID 填進 Render 的 Environment 分頁，新增 `TEXT_ANNOUNCE_CHANNEL_ID`（或 `MARUNA_ANNOUNCE_CHANNEL_ID`，兩個都設的話同一則會兩邊都發）變數，存檔重新部署（本機測試一樣填進 `.env`）。

兩個變數都不設的話，就算本機開關打開了，後端也不會推播（`/collect` 直接跳過這步），不影響原本 `/抓圖` 的查詢功能。

## 運作流程備忘

1. 你在 X 按讚 → `likewatcher.user.js` 讀畫面上這則貼文的文字/連結/媒體類型 → 比對 `hashtags.json` 有沒有對到 → 有的話 POST 到 `/collect`。
2. `/collect` 驗證 `COLLECT_SECRET`、比對 hashtag、去重後寫進 `collected.json`。
3. Discord 打 `/interactions` → `app.py` 驗簽。Autocomplete 打字時：從 `hashtags.json` 的角色名稱做子字串比對。
4. 送出 `/抓圖`：從 `collected.json` 挑該角色符合類型的一筆，把推文連結換成 `vxtwitter.com`（讓 Discord 正常展開圖片/影片預覽）直接回覆，全程本地查表，不打任何外部 API。
