// ==UserScript==
// @name         抓圖 Bot - X/IG/FB 按讚自動蒐集
// @namespace    ponytail
// @version      3.1
// @description  在 X、Instagram 或 Facebook 按讚符合角色 Hashtag 的貼文時，自動送去自己的 Discord 機器人後端收藏
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
      GM_xmlhttpRequest({
        method: "POST",
        url: BACKEND_URL + "/collect",
        headers: { "Content-Type": "application/json", "X-Collect-Secret": secret },
        data: JSON.stringify({ url, author, text, type: mediaType }),
        onload: (res) => console.log(tag, chars, res.status, res.responseText),
        onerror: (e) => console.error(tag + " 送出失敗", e),
      });
    });
  }

  const isInstagram = /(^|\.)instagram\.com$/.test(location.hostname);
  const isFacebook = /(^|\.)facebook\.com$/.test(location.hostname);

  if (isFacebook) {
    // ───────────────────────── Facebook ─────────────────────────
    // ⚠️ 沒有實測過（FB 沒有真人登入帳號可以測），下面的選擇器是憑經驗猜的，很可能要照 IG 當初的
    // 除錯方式（開 Console 看有沒有印出「找不到」的訊息，貼過來調整）重新調整過才會穩定動作。
    // 網址只認得 app.py 那邊也接受的四種形狀（個人/粉專貼文、reel、單張照片、社團貼文），跟後端保持
    // 一致，免得抓到了卻被 /collect 退回。
    const LIKE_LABELS = ["讚", "Like"];
    const RESERVED_PATHS = new Set([
      "photo", "photos", "videos", "posts", "reel", "reels", "watch", "groups", "marketplace",
      "gaming", "live", "events", "pages", "people", "hashtag", "help", "settings", "profile.php",
      "permalink.php", "story.php", "login", "home.php", "messages", "notifications",
    ]);
    const POST_LINK_RE = /^https:\/\/(?:www\.|m\.)?facebook\.com\/(?:([A-Za-z0-9.]{5,50})\/(posts|videos)\/([A-Za-z0-9]+)|reel\/(\d+)|photo\/?\?fbid=(\d+)|groups\/([A-Za-z0-9_.]{1,50})\/(posts|permalink)\/([A-Za-z0-9]+))/;

    function findPostLink(root) {
      for (const a of root.querySelectorAll("a[href]")) {
        const m = a.href.match(POST_LINK_RE);
        if (m) return m;
      }
      return null;
    }

    function findPostContainer(el) {
      let node = el.parentElement;
      for (let i = 0; i < 25 && node; i++, node = node.parentElement) {
        if (findPostLink(node)) return node;
      }
      return null;
    }

    // 作者的頭像＋姓名連結通常連續出現兩次指向同一個人；跟 IG 用同一招分辨作者跟留言者/推薦帳號。
    // 社團裡的個人連結長得不一樣（/groups/{社團}/user/{id}/，不是平常的 /{帳號}/），兩種都認。
    function extractAuthor(container) {
      const candidates = [...container.querySelectorAll('a[href^="/"], a[href^="https://www.facebook.com/"]')]
        .map((a) => a.getAttribute("href")?.match(/^(?:https:\/\/(?:www\.)?facebook\.com)?\/(?:groups\/[A-Za-z0-9_.]{1,50}\/user\/([A-Za-z0-9.]{1,50})|([A-Za-z0-9.]{5,50}))(?:\/|\?|$)/))
        .filter((m) => m && !RESERVED_PATHS.has((m[1] || m[2]).toLowerCase()))
        .map((m) => m[1] || m[2]);
      for (let i = 0; i < candidates.length - 1; i++) {
        if (candidates[i] === candidates[i + 1]) return candidates[i];
      }
      return candidates[0] || null;
    }

    function fetchPostInfo(url, container, cb) {
      fetch(url, { credentials: "include" })
        .then((r) => r.text())
        .then((html) => {
          const descM = html.match(/<meta property="og:description" content="([^"]*)"/);
          const ta = document.createElement("textarea");
          ta.innerHTML = descM ? descM[1] : "";
          const mediaType = /\/(?:reel|videos)\//.test(url) ? "video" : container.querySelector("video") ? "video" : "photo";
          cb({ text: ta.value, mediaType });
        })
        .catch((e) => {
          console.error("[抓圖收藏][FB] 抓貼文資訊失敗", e);
          cb({ text: "", mediaType: "photo" });
        });
    }

    document.addEventListener(
      "click",
      (ev) => {
        const svg = ev.target.closest("svg[aria-label]");
        const btn = ev.target.closest('[role="button"][aria-label]');
        const label = svg?.getAttribute("aria-label") || btn?.getAttribute("aria-label");
        if (!label || !LIKE_LABELS.includes(label)) return;

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

        fetchPostInfo(url, container, ({ text, mediaType }) => {
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

    // 自動翻譯時畫面顯示譯文、hashtag 比對不到——先切回原文抓字，比完再切回翻譯顯示。
    const SHOW_ORIGINAL_PHRASES = ["顯示原文", "显示原文", "Show original", "元のツイートを表示", "번역 전 표시", "원문 보기"];
    const SHOW_TRANSLATION_PHRASES = ["顯示翻譯", "显示翻译", "Show translation", "翻訳を表示", "번역 보기"];

    function findButtonByPhrases(article, phrases) {
      for (const el of article.querySelectorAll('[role="button"]')) {
        const t = el.innerText?.trim();
        if (t && phrases.some((p) => t === p || t.includes(p))) return el;
      }
      return null;
    }

    function readOriginalText(article, cb) {
      const showOriginalBtn = findButtonByPhrases(article, SHOW_ORIGINAL_PHRASES);
      if (!showOriginalBtn) return cb(article.querySelector('[data-testid="tweetText"]')?.innerText || "");
      showOriginalBtn.click();
      setTimeout(() => {
        const text = article.querySelector('[data-testid="tweetText"]')?.innerText || "";
        findButtonByPhrases(article, SHOW_TRANSLATION_PHRASES)?.click();
        cb(text);
      }, 500);
    }

    document.addEventListener(
      "click",
      (ev) => {
        const likeBtn = ev.target.closest('[data-testid="like"]'); // 未按讚狀態的按鈕
        if (!likeBtn) return;
        const article = likeBtn.closest('article[data-testid="tweet"]');
        if (!article) return;

        const mediaType = detectMediaType(article);
        if (!mediaType) return;

        const link = article.querySelector('a[href*="/status/"] time')?.closest("a");
        const m = link?.href?.match(/^https:\/\/(?:x|twitter)\.com\/([^/]+)\/status\/(\d+)/);
        if (!m) return;
        const [, author, id] = m;
        const url = `https://x.com/${author}/status/${id}`;

        readOriginalText(article, (text) => {
          loadHashtags((tags) => {
            const chars = matchedCharacters(text, tags);
            if (chars.length === 0) return console.log("[抓圖收藏] 沒對到任何角色關鍵字，略過", text);
            submitCollect("[抓圖收藏]", { url, author, text, mediaType, chars });
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
      let node = el.parentElement;
      for (let i = 0; i < 25 && node; i++, node = node.parentElement) {
        if (findPostLink(node)) return node;
      }
      return null;
    }

    // 作者的頭像＋帳號名連結會連續出現兩次指向同一網址；留言者/推薦帳號通常只出現一次，藉此分辨。
    function extractAuthor(container) {
      const candidates = [...container.querySelectorAll('a[href^="/"]')]
        .map((a) => a.getAttribute("href")?.match(/^\/([A-Za-z0-9_.]{1,30})(?:\/|$)/))
        .filter((m) => m && !RESERVED_PATHS.has(m[1].toLowerCase()))
        .map((m) => m[1]);
      for (let i = 0; i < candidates.length - 1; i++) {
        if (candidates[i] === candidates[i + 1]) return candidates[i];
      }
      return candidates[0] || null;
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
