// ==UserScript==
// @name         抓圖 Bot - X/IG 按讚自動蒐集
// @namespace    ponytail
// @version      2.0
// @description  在 X 或 Instagram 按讚符合角色 Hashtag 的貼文時，自動送去自己的 Discord 機器人後端收藏
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://www.instagram.com/*
// @match        https://instagram.com/*
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function () {
  "use strict";

  // ── 改這兩個 ──────────────────────────────────────────────────
  const BACKEND_URL = "https://twitterlian-dong-dcshou-tu-bot.onrender.com";
  const COLLECT_SECRET = "貼你 .env 裡的 COLLECT_SECRET"; // 只填在 Tampermonkey 裡實際安裝的那份，這個檔案（會進 git）留空白
  // ────────────────────────────────────────────────────────────

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

  function matchedCharacters(text, tags) {
    const lower = text.toLowerCase();
    return Object.entries(tags)
      .filter(([name]) => !name.startsWith("_"))
      .filter(([, list]) => list.some((h) => lower.includes(h.toLowerCase())))
      .map(([name]) => name);
  }

  function submitCollect(tag, { url, author, text, mediaType, chars }) {
    GM_xmlhttpRequest({
      method: "POST",
      url: BACKEND_URL + "/collect",
      headers: { "Content-Type": "application/json", "X-Collect-Secret": COLLECT_SECRET },
      data: JSON.stringify({ url, author, text, type: mediaType }),
      onload: (res) => console.log(tag, chars, res.status, res.responseText),
      onerror: (e) => console.error(tag + " 送出失敗", e),
    });
  }

  const isInstagram = /(^|\.)instagram\.com$/.test(location.hostname);

  if (!isInstagram) {
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

    // Reels 滑動瀏覽時內文疊在影片上、藏在讀不到的 closed Shadow DOM 裡——改打貼文自己的網址，
    // 讀伺服器 HTML 的 og:description 標籤，內文+ hashtag 都在裡面，不受畫面渲染狀態影響。
    function fetchCaption(url, cb) {
      fetch(url, { credentials: "include" })
        .then((r) => r.text())
        .then((html) => {
          const m = html.match(/<meta property="og:description" content="([^"]*)"/);
          if (!m) return cb("");
          const ta = document.createElement("textarea");
          ta.innerHTML = m[1];
          cb(ta.value);
        })
        .catch((e) => {
          console.error("[抓圖收藏][IG] 抓內文失敗", e);
          cb("");
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

        let url, author, isReel;
        if (m[1]) {
          const type = m[1] === "reels" ? "reel" : m[1]; // 統一存單數，跟後端格式一致，兩種網址其實通用
          url = `https://www.instagram.com/${type}/${m[2]}/`;
          author = extractAuthor(container);
          isReel = type === "reel";
        } else {
          url = `https://www.instagram.com/p/${m[4]}/`;
          author = m[3];
        }
        if (!author) return console.log("[抓圖收藏][IG] 抓不到帳號，略過（選擇器可能要調整）");
        const mediaType = isReel || container.querySelector("video") ? "video" : "photo"; // Reel 必是影片

        fetchCaption(url, (text) => {
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
