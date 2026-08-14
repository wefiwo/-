// ==UserScript==
// @name         抓圖 Bot - X/IG/FB 按讚自動蒐集
// @namespace    ponytail
// @version      4.5
// @description  在 X、Instagram 或 Facebook 按讚符合角色 Hashtag 的貼文時，自動送去自己的 Discord 機器人後端收藏；X 上轉推則彈出輸入框手動指定角色；Alt+Q/Alt+W 快捷鍵切換本機開關
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://www.instagram.com/*
// @match        https://instagram.com/*
// @match        https://www.facebook.com/*
// @match        https://facebook.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @connect      *
// @updateURL    https://raw.githubusercontent.com/wefiwo/-/main/likewatcher.user.js
// @downloadURL  https://raw.githubusercontent.com/wefiwo/-/main/likewatcher.user.js
// ==/UserScript==

(function () {
  "use strict";

  const BACKEND_URL = "https://twitterlian-dong-dcshou-tu-bot.onrender.com";

  // 密鑰存在 Tampermonkey 自己的儲存空間，不寫在腳本內容裡——這樣腳本才能安全自動更新，
  // 不會被新版覆蓋掉你本機設定的密鑰。第一次執行才會問一次，之後都記得住。
  function getSecret(cb) {
    const saved = GM_getValue("collectSecret", "");
    if (saved) return cb(saved);
    const entered = prompt("第一次設定：請貼上你的 COLLECT_SECRET（跟 .env 裡的一致）");
    if (entered) GM_setValue("collectSecret", entered.trim());
    cb(entered ? entered.trim() : "");
  }
  GM_registerMenuCommand("重新設定 COLLECT_SECRET", () => {
    const entered = prompt("輸入新的 COLLECT_SECRET：", GM_getValue("collectSecret", ""));
    if (entered) GM_setValue("collectSecret", entered.trim());
  });

  function showToast(text) {
    const el = document.createElement("div");
    el.textContent = text;
    el.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;background:#1d9bf0;"
      + "color:#fff;padding:8px 14px;border-radius:6px;font:14px sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3);";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }

  // 本機限定開關：狀態存在 Tampermonkey 自己的儲存空間，裝置各自獨立、不會跟著腳本更新同步給別人
  // （腳本會分享給別人，同一組 COLLECT_SECRET，但這個開關不會）。選單文字前面用 ✅/⬜ 顯示目前狀態，
  // 每次切換就重新註冊一次選單項目（Tampermonkey 沒有原生的開關 UI 可以用，這是最接近的做法）。
  // 回傳的判斷函式本身掛一個 .toggle 方法，讓下面的快捷鍵可以直接呼叫同一套切換邏輯。
  function registerToggleMenu(label, key) {
    let commandId;
    const isEnabled = () => GM_getValue(key, false);
    const toggle = () => {
      GM_setValue(key, !isEnabled());
      render();
      showToast(`${label}已${isEnabled() ? "開啟 ✅" : "關閉 ⬜"}`);
    };
    const render = () => {
      if (commandId !== undefined) GM_unregisterMenuCommand(commandId);
      commandId = GM_registerMenuCommand(`${isEnabled() ? "✅" : "⬜"} ${label}（僅本機裝置）`, toggle);
    };
    render();
    isEnabled.toggle = toggle;
    return isEnabled;
  }

  const retweetAddEnabled = registerToggleMenu("轉推手動收藏功能", "retweetAddEnabled");
  // announce 開了才會在 submitCollect 送出的請求裡多帶一個 announce 旗標，後端收到才會主動把這則
  // 貼文推播到指定的 Discord 頻道（要後端有設 ANNOUNCE_CHANNEL_ID 才有作用）。
  const announceEnabled = registerToggleMenu("自動推播到 Discord 頻道", "announceEnabled");

  // 快捷鍵：Alt+Q 切轉推手動收藏、Alt+W 切自動推播，不用開選單也能切換。輸入框/可編輯區域裡打字時
  // 不觸發，避免跟打字內容衝突。
  document.addEventListener("keydown", (ev) => {
    if (!ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    const el = document.activeElement;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
    const key = ev.key.toLowerCase();
    if (key === "q") { ev.preventDefault(); retweetAddEnabled.toggle(); }
    else if (key === "w") { ev.preventDefault(); announceEnabled.toggle(); }
  });

  let hashtagsCache = null; // 角色 → Hashtag 對照表，每次載入頁面拉一次就好

  function loadHashtags(cb) {
    if (hashtagsCache) return cb(hashtagsCache);
    GM_xmlhttpRequest({
      method: "GET",
      url: BACKEND_URL + "/hashtags",
      onload: (res) => {
        try {
          hashtagsCache = JSON.parse(res.responseText);
          cb(hashtagsCache);
        } catch (e) {
          console.error("[抓圖收藏] 解析 hashtags 失敗", e);
        }
      },
      onerror: (e) => console.error("[抓圖收藏] 連不到後端，backend 有在跑嗎？", e),
    });
  }

  // requireHash: FB 上關鍵字一定要帶 # 才算數（純文字提到角色名字太容易誤觸），跟後端 /collect
  // 的規則保持一致；X/IG 維持原本「文字裡出現就算」。這裡只影響要不要送出前的本地判斷跟 log，真正
  // 擋下來的是後端 /collect 自己重比對一次那關。
  function matchedCharacters(text, tags, requireHash) {
    const lower = text.toLowerCase();
    return Object.entries(tags)
      .filter(([name]) => !name.startsWith("_"))
      .filter(([, list]) => list.some((h) => {
        const keyword = requireHash ? "#" + h.replace(/^#/, "") : h;
        return lower.includes(keyword.toLowerCase());
      }))
      .map(([name]) => name);
  }

  function submitCollect(tag, { url, author, text, mediaType, chars }) {
    getSecret((secret) => {
      if (!secret) return console.error(tag + " 沒有設定 COLLECT_SECRET，取消送出");
      const announce = announceEnabled();
      // GM_xmlhttpRequest 是 Tampermonkey 自己背景執行緒送出去的，不會出現在網頁本身的 Network
      // 分頁裡——要確認實際送出的內容（尤其 announce 這個旗標），只能靠這行印在 Console 裡看。
      console.log(tag + " 送出:", { url, author, mediaType, announce });
      GM_xmlhttpRequest({
        method: "POST",
        url: BACKEND_URL + "/collect",
        headers: { "Content-Type": "application/json", "X-Collect-Secret": secret },
        data: JSON.stringify({ url, author, text, type: mediaType, announce }),
        onload: (res) => console.log(tag, chars, res.status, res.responseText),
        onerror: (e) => console.error(tag + " 送出失敗", e),
      });
    });
  }

  // 三個平台都要「從點擊處往上爬找一個包住貼文連結的容器」「一堆候選連結裡挑第一個連續重複出現的當
  // 作者」「在容器裡找文字符合某些詞組的按鈕」——抽出來共用，不必三份幾乎一樣的迴圈。
  function climbForContainer(el, findLink, isBest) {
    let node = el.parentElement;
    let fallback = null;
    for (let i = 0; i < 25 && node; i++, node = node.parentElement) {
      const m = findLink(node);
      if (!m) continue;
      if (isBest(m)) return node;
      if (!fallback) fallback = node; // 記住第一個堪用的當退路，繼續往上找有沒有更好的
    }
    return fallback;
  }

  function firstDuplicateAdjacent(candidates) {
    for (let i = 0; i < candidates.length - 1; i++) {
      if (candidates[i] === candidates[i + 1]) return candidates[i];
    }
    return candidates[0] || null;
  }

  function findButtonByText(container, phrases) {
    for (const el of container.querySelectorAll('[role="button"]')) {
      const t = el.innerText?.trim();
      if (t && phrases.some((p) => t === p || t.includes(p))) return el;
    }
    return null;
  }

  const isInstagram = /(^|\.)instagram\.com$/.test(location.hostname);
  const isFacebook = /(^|\.)facebook\.com$/.test(location.hostname);

  if (isFacebook) {
    // ───────────────────────── Facebook ─────────────────────────
    // ⚠️ 沒有實測過（FB 沒有真人登入帳號可以測），下面的選擇器是憑經驗猜的，很可能要照 IG 當初的
    // 除錯方式（開 Console 看有沒有印出「找不到」的訊息，貼過來調整）重新調整過才會穩定動作。
    // 網址只認得 app.py 那邊也接受的四種形狀（個人/粉專貼文、reel、單張照片、社團貼文），跟後端保持
    // 一致，免得抓到了卻被 /collect 退回。
    // 不只單純的讚——長按/點開表情選單直接點大心、哈等其他反應一樣算數。
    const REACTION_LABELS = ["讚", "Like", "大心", "Love", "哈", "Haha", "哇", "Wow", "難過", "Sad", "怒", "Angry", "關心", "Care"];
    const RESERVED_PATHS = new Set([
      "photo", "photos", "videos", "posts", "reel", "reels", "watch", "groups", "marketplace",
      "gaming", "live", "events", "pages", "people", "hashtag", "help", "settings", "profile.php",
      "permalink.php", "story.php", "stories", "login", "home.php", "messages", "notifications",
    ]);
    const POST_LINK_RE = /^https:\/\/(?:www\.|m\.)?facebook\.com\/(?:([A-Za-z0-9.]{5,50})\/(posts|videos)\/([A-Za-z0-9]+)|reel\/(\d+)|photo\/?\?fbid=(\d+)|groups\/([A-Za-z0-9_.]{1,50})\/(posts|permalink)\/([A-Za-z0-9]+))/;

    // 同一則貼文的縮圖（photo/?fbid=）常常比貼文本身的永久連結（帶帳號的 posts/videos）離讚按鈕更
    // 近，先找到的容器很容易只包到縮圖、包不到貼文標頭——優先選帶帳號的連結（m[1]），因為它同時給得
    // 出作者、也是唯一保證讀得到完整內文的形狀；沒有的話才退而求其次用 reel/photo/group 這些。
    function findPostLink(root) {
      let fallback = null;
      for (const a of root.querySelectorAll("a[href]")) {
        const m = a.href.match(POST_LINK_RE);
        if (!m) continue;
        if (m[1]) return m;
        if (!fallback) fallback = m;
      }
      return fallback;
    }

    function findPostContainer(el) {
      return climbForContainer(el, findPostLink, (m) => !!m[1]); // m[1] = 帶帳號的連結，找到就不用再往上爬
    }

    // 作者的頭像＋姓名連結通常連續出現兩次指向同一個人；跟 IG 用同一招分辨作者跟留言者/推薦帳號。
    // 社團裡的個人連結長得不一樣（/groups/{社團}/user/{id}/，不是平常的 /{帳號}/），兩種都認。
    function extractAuthor(container) {
      const candidates = [...container.querySelectorAll('a[href^="/"], a[href^="https://www.facebook.com/"]')]
        .map((a) => a.getAttribute("href")?.match(/^(?:https:\/\/(?:www\.)?facebook\.com)?\/(?:groups\/[A-Za-z0-9_.]{1,50}\/user\/([A-Za-z0-9.]{1,50})|([A-Za-z0-9.]{5,50}))(?:\/|\?|$)/))
        .filter((m) => m && !RESERVED_PATHS.has((m[1] || m[2]).toLowerCase()))
        .map((m) => m[1] || m[2]);
      return firstDuplicateAdjacent(candidates);
    }

    // 一開始學 IG 用「抓貼文自己網址的 og:description」讀內文，結果 FB 的 /photo/?fbid= 這種
    // 縮圖檢視頁的 og:description 根本不是完整貼文內文（是空的）——FB 的內文其實好好地顯示在畫面
    // 上（不像 IG Reels 那樣藏在讀不到的 shadow DOM 裡），直接讀 DOM 比較準也不用等網路。長內文會
    // 被截斷成「...查看更多」，跟 X 的「顯示原文」是同一招：先點開再讀。
    const SEE_MORE_PHRASES = ["查看更多", "顯示更多", "See more", "もっと見る", "더 보기"];

    function readCaption(container, cb) {
      const seeMoreBtn = findButtonByText(container, SEE_MORE_PHRASES);
      if (!seeMoreBtn) return cb(container.innerText || "");
      seeMoreBtn.click();
      setTimeout(() => cb(container.innerText || ""), 300);
    }

    document.addEventListener(
      "click",
      (ev) => {
        const svg = ev.target.closest("svg[aria-label]");
        const btn = ev.target.closest('[role="button"][aria-label]');
        const label = svg?.getAttribute("aria-label") || btn?.getAttribute("aria-label");
        if (!label) return;
        // 除錯用：先看看點到的東西 aria-label 到底是什麼字——REACTION_LABELS 這個猜測清單如果跟
        // FB 實際用的字不一樣，選對真正的反應按鈕之前這行印出來的內容就是唯一的線索。
        if (!REACTION_LABELS.includes(label)) return console.log("[抓圖收藏][FB] 點到帶 aria-label 的東西但不是讚/表情反應，略過：", label);

        const container = findPostContainer(ev.target);
        const m = container && findPostLink(container);
        if (!m) return console.log("[抓圖收藏][FB] 找不到貼文連結，略過（選擇器可能要調整，也可能是按到留言的讚）");

        let url, author;
        if (m[1]) {
          url = `https://www.facebook.com/${m[1]}/${m[2]}/${m[3]}`;
          author = m[1];
        } else if (m[4]) {
          url = `https://www.facebook.com/reel/${m[4]}`;
          author = extractAuthor(container);
        } else if (m[5]) {
          url = `https://www.facebook.com/photo/?fbid=${m[5]}`;
          author = extractAuthor(container);
        } else {
          url = `https://www.facebook.com/groups/${m[6]}/${m[7]}/${m[8]}`;
          author = extractAuthor(container);
        }
        if (!author) return console.log("[抓圖收藏][FB] 抓不到帳號，略過（選擇器可能要調整）");

        const mediaType = /\/(?:reel|videos)\//.test(url) || container.querySelector("video") ? "video" : "photo";
        readCaption(container, (text) => {
          console.log("[抓圖收藏][FB] 偵測到讚", { url, author, mediaType, textPreview: text.slice(0, 30) });
          loadHashtags((tags) => {
            const chars = matchedCharacters(text, tags, true); // FB 一定要帶 # 才算數
            if (chars.length === 0) return console.log("[抓圖收藏][FB] 沒對到任何角色關鍵字（要帶 #），略過", text);
            submitCollect("[抓圖收藏][FB]", { url, author, text, mediaType, chars });
          });
        });
      },
      true
    );
  } else if (!isInstagram) {
    // ───────────────────────── X / Twitter ─────────────────────────
    function detectMediaType(article) {
      if (article.querySelector('[data-testid="videoPlayer"]')) return "video";
      if (article.querySelector('[data-testid="tweetPhoto"]')) return "photo";
      return null;
    }

    function extractTweetLink(article) {
      const link = article.querySelector('a[href*="/status/"] time')?.closest("a");
      const m = link?.href?.match(/^https:\/\/(?:x|twitter)\.com\/([^/]+)\/status\/(\d+)/);
      return m ? { url: `https://x.com/${m[1]}/status/${m[2]}`, author: m[1] } : null;
    }

    // 自動翻譯時畫面顯示譯文、hashtag 比對不到——先切回原文抓字，比完再切回翻譯顯示。
    const SHOW_ORIGINAL_PHRASES = ["顯示原文", "显示原文", "Show original", "元のツイートを表示", "번역 전 표시", "원문 보기"];
    const SHOW_TRANSLATION_PHRASES = ["顯示翻譯", "显示翻译", "Show translation", "翻訳を表示", "번역 보기"];

    function readOriginalText(article, cb) {
      const showOriginalBtn = findButtonByText(article, SHOW_ORIGINAL_PHRASES);
      if (!showOriginalBtn) return cb(article.querySelector('[data-testid="tweetText"]')?.innerText || "");
      showOriginalBtn.click();
      setTimeout(() => {
        const text = article.querySelector('[data-testid="tweetText"]')?.innerText || "";
        findButtonByText(article, SHOW_TRANSLATION_PHRASES)?.click();
        cb(text);
      }, 500);
    }

    // 手動收藏：轉推當成「我確定要收藏這個」的手動觸發，跟讚那條自動判斷 hashtag 的路徑各自獨立、
    // 互不影響——貼文沒下 hashtag 或關鍵字沒登記過也能收，直接自己指定要進哪個角色的收藏。
    // 借用 /collect 既有的 hashtag 比對機制：把 text 組成每個角色「#第一個關鍵字」串起來一次送出
    // 去，後端自然就會各自比對成功、一次存進所有指定角色，不用另外開一支後端 API、也不用送好幾次。
    let pendingRetweetArticle = null;

    // 選角色用的小視窗：輸入時即時打後端 /autocomplete（跟 Discord /抓圖 用同一套 autocomplete_matches
    // 同音字比對，不用在前端另外重刻一份拼音邏輯），選到的角色變成標籤，可以一次選多個再一起送出。
    function fetchAutocomplete(query, cb) {
      if (!query) return cb([]);
      GM_xmlhttpRequest({
        method: "GET",
        url: BACKEND_URL + "/autocomplete?q=" + encodeURIComponent(query),
        onload: (res) => { try { cb(JSON.parse(res.responseText)); } catch (e) { cb([]); } },
        onerror: () => cb([]),
      });
    }

    function pickCharacters(tags, cb) {
      const overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.5);"
        + "display:flex;align-items:center;justify-content:center;font:14px sans-serif;";

      const box = document.createElement("div");
      box.style.cssText = "background:#15202b;color:#fff;padding:16px;border-radius:10px;width:320px;"
        + "box-shadow:0 4px 20px rgba(0,0,0,.4);";
      box.innerHTML = '<div style="margin-bottom:8px;font-weight:bold;">轉推收藏——選角色（可選多個，支援同音字）</div>';

      const chipRow = document.createElement("div");
      chipRow.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;min-height:24px;";

      const input = document.createElement("input");
      input.placeholder = "輸入角色名";
      input.style.cssText = "width:100%;box-sizing:border-box;padding:6px;border-radius:6px;"
        + "border:1px solid #38444d;background:#192734;color:#fff;outline:none;";

      const list = document.createElement("div");
      list.style.cssText = "max-height:160px;overflow-y:auto;margin-top:4px;";

      const btnRow = document.createElement("div");
      btnRow.style.cssText = "display:flex;justify-content:flex-end;gap:8px;margin-top:10px;";
      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = "取消";
      const okBtn = document.createElement("button");
      okBtn.textContent = "確定";
      [cancelBtn, okBtn].forEach((b) => {
        b.style.cssText = "padding:6px 14px;border-radius:16px;border:none;cursor:pointer;font:14px sans-serif;color:#fff;";
      });
      okBtn.style.background = "#1d9bf0";
      cancelBtn.style.background = "#38444d";
      btnRow.append(cancelBtn, okBtn);

      box.append(chipRow, input, list, btnRow);
      overlay.append(box);
      document.body.append(overlay);
      input.focus();

      const picked = [];
      let currentMatches = [];
      let highlightIndex = -1;

      function renderChips() {
        chipRow.innerHTML = "";
        picked.forEach((name) => {
          const chip = document.createElement("span");
          chip.textContent = name + " ✕";
          chip.style.cssText = "background:#1d9bf0;color:#fff;padding:2px 8px;border-radius:12px;cursor:pointer;";
          chip.onclick = () => { picked.splice(picked.indexOf(name), 1); renderChips(); };
          chipRow.appendChild(chip);
        });
      }

      function renderList() {
        list.innerHTML = "";
        currentMatches.forEach((name, i) => {
          const item = document.createElement("div");
          item.textContent = name;
          item.style.cssText = "padding:6px 8px;border-radius:6px;cursor:pointer;" + (i === highlightIndex ? "background:#1d9bf0;" : "");
          item.onclick = () => selectMatch(name);
          list.appendChild(item);
        });
      }

      function selectMatch(name) {
        if (!picked.includes(name)) picked.push(name);
        renderChips();
        input.value = "";
        currentMatches = [];
        highlightIndex = -1;
        renderList();
        input.focus();
      }

      let debounceTimer;
      input.addEventListener("input", () => {
        clearTimeout(debounceTimer);
        const q = input.value.trim();
        if (!q) { currentMatches = []; highlightIndex = -1; return renderList(); }
        debounceTimer = setTimeout(() => {
          fetchAutocomplete(q, (matches) => {
            currentMatches = matches;
            highlightIndex = matches.length ? 0 : -1;
            renderList();
          });
        }, 150);
      });

      input.addEventListener("keydown", (ev) => {
        if (ev.key === "ArrowDown") { ev.preventDefault(); highlightIndex = Math.min(highlightIndex + 1, currentMatches.length - 1); renderList(); }
        else if (ev.key === "ArrowUp") { ev.preventDefault(); highlightIndex = Math.max(highlightIndex - 1, 0); renderList(); }
        else if (ev.key === "Enter") {
          ev.preventDefault();
          if (highlightIndex >= 0 && currentMatches[highlightIndex]) selectMatch(currentMatches[highlightIndex]);
          else if (tags[input.value.trim()]) selectMatch(input.value.trim()); // 網路慢/沒跳出清單時的退路：打完整正確名字直接按 Enter 也算
        } else if (ev.key === "Escape") { ev.preventDefault(); cleanup(); cb(null); }
      });

      function cleanup() { overlay.remove(); }
      cancelBtn.onclick = () => { cleanup(); cb(null); };
      okBtn.onclick = () => { cleanup(); cb(picked); };
    }

    function promptManualAdd(article, tags) {
      const mediaType = detectMediaType(article);
      if (!mediaType) return alert("這則貼文沒偵測到圖片或影片，無法加入收藏。");

      const link = extractTweetLink(article);
      if (!link) return alert("抓不到這則貼文的連結，無法加入收藏（選擇器可能要調整）。");

      pickCharacters(tags, (names) => {
        if (!names || !names.length) return;
        const text = names.map((name) => `#${tags[name][0].replace(/^#/, "")}`).join(" ");
        submitCollect("[抓圖收藏][轉推]", { url: link.url, author: link.author, text, mediaType, chars: names });
      });
    }

    document.addEventListener(
      "click",
      (ev) => {
        if (retweetAddEnabled()) {
          const retweetBtn = ev.target.closest('[data-testid="retweet"]');
          if (retweetBtn) {
            pendingRetweetArticle = retweetBtn.closest('article[data-testid="tweet"]');
            return console.log("[抓圖收藏] 偵測到轉推按鈕，等確認轉推…");
          }
          const retweetConfirmBtn = ev.target.closest('[data-testid="retweetConfirm"]');
          if (retweetConfirmBtn) {
            const retweetArticle = pendingRetweetArticle;
            pendingRetweetArticle = null;
            if (!retweetArticle) return console.log("[抓圖收藏] 確認轉推了，但找不到是哪一則貼文（選擇器可能要調整）");
            return loadHashtags((tags) => promptManualAdd(retweetArticle, tags));
          }
        }

        const likeBtn = ev.target.closest('[data-testid="like"]'); // 未按讚狀態的按鈕
        if (!likeBtn) return;
        const article = likeBtn.closest('article[data-testid="tweet"]');
        if (!article) return;

        const mediaType = detectMediaType(article);
        if (!mediaType) return;

        const link = extractTweetLink(article);
        if (!link) return;

        readOriginalText(article, (text) => {
          loadHashtags((tags) => {
            const chars = matchedCharacters(text, tags);
            if (chars.length === 0) return console.log("[抓圖收藏] 沒對到任何角色關鍵字，略過", text);
            submitCollect("[抓圖收藏]", { url: link.url, author: link.author, text, mediaType, chars });
          });
        });
      },
      true
    );
  } else {
    // ───────────────────────── Instagram ─────────────────────────
    // IG 沒有穩定的 data-testid，靠網址規律（/p/、/reel/、/reels/、/帳號名/代碼/）找貼文，比綁 class 名穩。
    const LIKE_LABELS = ["讚", "Like", "like"];
    const RESERVED_PATHS = new Set(["p", "reel", "reels", "explore", "accounts", "stories", "direct", "tv", "about", "developer", ""]);
    const POST_LINK_RE = /^https:\/\/(?:www\.)?instagram\.com\/(?:(p|reel|reels)\/([A-Za-z0-9_-]+)|([A-Za-z0-9_.]{1,30})\/([A-Za-z0-9_-]{5,30}))\/?(?:\?.*)?$/;

    const looksLikeShortcode = (s) => /[0-9A-Z]/.test(s); // 真代碼幾乎必有大寫/數字；純小寫是頁尾導覽連結

    function isValidPostMatch(m) {
      if (!m) return false;
      return !!(m[1] || (looksLikeShortcode(m[4]) && !RESERVED_PATHS.has(m[3].toLowerCase())));
    }

    function findPostLink(root) {
      for (const a of root.querySelectorAll("a[href]")) {
        const m = a.href.match(POST_LINK_RE);
        if (isValidPostMatch(m)) return m;
      }
      return null;
    }

    function findPostContainer(el) {
      return climbForContainer(el, findPostLink, () => true); // findPostLink 自己已經篩過有效連結，找到就算數
    }

    // 作者的頭像＋帳號名連結會連續出現兩次指向同一網址；留言者/推薦帳號通常只出現一次，藉此分辨。
    function extractAuthor(container) {
      const candidates = [...container.querySelectorAll('a[href^="/"]')]
        .map((a) => a.getAttribute("href")?.match(/^\/([A-Za-z0-9_.]{1,30})(?:\/|$)/))
        .filter((m) => m && !RESERVED_PATHS.has(m[1].toLowerCase()))
        .map((m) => m[1]);
      return firstDuplicateAdjacent(candidates);
    }

    // Reels 滑動瀏覽時內文疊在影片上、藏在讀不到的 closed Shadow DOM 裡，<video> 標籤也一樣摸不到、
    // 用 DOM 判斷型態還可能誤抓到畫面上其他不相干的影片——改打貼文自己的網址，讀伺服器 HTML：
    // og:description 給內文+hashtag，og:url 的路徑（/p/ 還是 /reel/）給真正的媒體型態，都不受畫面影響。
    function fetchPostInfo(url, cb) {
      fetch(url, { credentials: "include" })
        .then((r) => r.text())
        .then((html) => {
          const descM = html.match(/<meta property="og:description" content="([^"]*)"/);
          const urlM = html.match(/<meta property="og:url" content="([^"]*)"/);
          const ta = document.createElement("textarea");
          ta.innerHTML = descM ? descM[1] : "";
          cb({ text: ta.value, mediaType: /\/reel\//.test(urlM?.[1] || "") ? "video" : "photo" });
        })
        .catch((e) => {
          console.error("[抓圖收藏][IG] 抓貼文資訊失敗", e);
          cb({ text: "", mediaType: "photo" });
        });
    }

    document.addEventListener(
      "click",
      (ev) => {
        const svg = ev.target.closest("svg[aria-label]");
        if (!svg || !LIKE_LABELS.includes(svg.getAttribute("aria-label"))) return;

        // 網址列本身就是貼文連結時直接信任它，比爬 DOM 準，也不會爬過頭誤抓頁尾連結。
        const urlMatch = location.href.match(POST_LINK_RE);
        const onPostPage = isValidPostMatch(urlMatch) ? urlMatch : null;
        const container = onPostPage ? document : findPostContainer(svg);
        const m = container && (onPostPage || findPostLink(container));
        if (!m) return console.log("[抓圖收藏][IG] 找不到貼文連結，略過（選擇器可能要調整）");

        let url, author;
        if (m[1]) {
          const type = m[1] === "reels" ? "reel" : m[1]; // 統一存單數，跟後端格式一致，兩種網址其實通用
          url = `https://www.instagram.com/${type}/${m[2]}/`;
          author = extractAuthor(container);
        } else {
          url = `https://www.instagram.com/p/${m[4]}/`;
          author = m[3];
        }
        if (!author) return console.log("[抓圖收藏][IG] 抓不到帳號，略過（選擇器可能要調整）");

        fetchPostInfo(url, ({ text, mediaType }) => {
          console.log("[抓圖收藏][IG] 偵測到讚", { url, author, mediaType, textPreview: text.slice(0, 30) });
          loadHashtags((tags) => {
            const chars = matchedCharacters(text, tags);
            if (chars.length === 0) return console.log("[抓圖收藏][IG] 沒對到任何角色關鍵字，略過", text);
            submitCollect("[抓圖收藏][IG]", { url, author, text, mediaType, chars });
          });
        });
      },
      true
    );
  }
})();
