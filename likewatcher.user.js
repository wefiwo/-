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
      return null; // 純文字推文，不是我們要的
    }

    // X 自動翻譯時，畫面上顯示的是譯文，hashtag 常常因此比對不到——先把「顯示原文」按掉抓字比對，
    // 比對完再切回「顯示翻譯」，不影響你平常想看翻譯內文的習慣。
    // ponytail: 用按鈕文字做多語系比對，X 改版/換語言介面的話這裡可能要跟著調整。
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
      if (!showOriginalBtn) {
        cb(article.querySelector('[data-testid="tweetText"]')?.innerText || "");
        return;
      }
      console.log("[抓圖收藏] 偵測到翻譯，先切回原文");
      showOriginalBtn.click();
      setTimeout(() => {
        const text = article.querySelector('[data-testid="tweetText"]')?.innerText || "";
        const showTranslationBtn = findButtonByPhrases(article, SHOW_TRANSLATION_PHRASES);
        if (showTranslationBtn) {
          console.log("[抓圖收藏] 比對完成，切回翻譯顯示");
          showTranslationBtn.click();
        }
        cb(text);
      }, 500);
    }

    document.addEventListener(
      "click",
      (ev) => {
        // data-testid="like" = 目前未按讚、這一下是要「按讚」的那顆按鈕
        const likeBtn = ev.target.closest('[data-testid="like"]');
        if (!likeBtn) return;

        const article = likeBtn.closest('article[data-testid="tweet"]');
        if (!article) return;

        const mediaType = detectMediaType(article);
        if (!mediaType) return;

        const link = article.querySelector('a[href*="/status/"] time')?.closest("a");
        if (!link) return;
        const m = link.href.match(/^https:\/\/(?:x|twitter)\.com\/([^/]+)\/status\/(\d+)/);
        if (!m) return;
        const [, author, id] = m;
        const url = `https://x.com/${author}/status/${id}`;

        readOriginalText(article, (text) => {
          loadHashtags((tags) => {
            const chars = matchedCharacters(text, tags);
            if (chars.length === 0) {
              console.log("[抓圖收藏] 沒對到任何角色關鍵字，略過", text);
              return;
            }
            submitCollect("[抓圖收藏]", { url, author, text, mediaType, chars });
          });
        });
      },
      true
    );
  } else {
    // ───────────────────────── Instagram ─────────────────────────
    // IG 沒有 X 那種穩定的 data-testid，改用網址規律（/p/、/reel/、/username/）去找貼文連結跟作者，
    // 比綁死特定 class 名稱穩（IG 的 class 是打包工具產生的亂碼，隨時會變）。
    // ponytail: 這段是照少量真實 DOM 樣本寫的，選擇器抓不到東西時看 console log 的訊息再調整。
    const LIKE_LABELS = ["讚", "Like", "like"];
    const RESERVED_PATHS = new Set(["p", "reel", "reels", "explore", "accounts", "stories", "direct", "tv", "about", "developer", ""]);
    // IG 貼文連結有兩種格式都會遇到：/p/{code}/、/reel/{code}/，或直接 /帳號名/{code}/（後者連作者都內建在網址裡）。
    const POST_LINK_RE = /^https:\/\/(?:www\.)?instagram\.com\/(?:(p|reel)\/([A-Za-z0-9_-]+)|([A-Za-z0-9_.]{1,30})\/([A-Za-z0-9_-]{5,30}))\/?(?:\?.*)?$/;

    function findLikeSvg(target) {
      const svg = target.closest("svg[aria-label]");
      if (!svg) return null;
      return LIKE_LABELS.includes(svg.getAttribute("aria-label")) ? svg : null;
    }

    // 真正的貼文代碼是打亂的 base64 風格字串，幾乎一定會出現大寫字母或數字；純小寫＋底線/連字號
    // 的通常是人寫的頁面路徑（/accounts/meta_verified/、/legal/privacy/ 之類），藉此濾掉。
    function looksLikeShortcode(s) {
      return /[0-9A-Z]/.test(s);
    }

    function findPostLink(root) {
      for (const a of root.querySelectorAll("a[href]")) {
        const m = a.href.match(POST_LINK_RE);
        if (!m) continue;
        if (m[1] || looksLikeShortcode(m[4])) return m;
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

    function extractAuthor(container) {
      for (const a of container.querySelectorAll('a[href^="/"]')) {
        const m = a.getAttribute("href").match(/^\/([A-Za-z0-9_.]{1,30})\/?$/);
        if (m && !RESERVED_PATHS.has(m[1].toLowerCase())) return m[1];
      }
      return null;
    }

    function extractCaption(container) {
      return container.querySelector('h1[dir="auto"]')?.innerText || "";
    }

    document.addEventListener(
      "click",
      (ev) => {
        const svg = findLikeSvg(ev.target);
        if (!svg) return;

        const container = findPostContainer(svg);
        if (!container) {
          console.log("[抓圖收藏][IG] 找不到貼文容器，略過（選擇器可能要調整）");
          return;
        }

        const m = findPostLink(container);
        let url, author;
        if (m[1]) {
          url = `https://www.instagram.com/${m[1]}/${m[2]}/`;
          author = extractAuthor(container);
        } else {
          url = `https://www.instagram.com/p/${m[4]}/`; // 統一存成正規的 /p/ 格式，跟帳號名脫鉤
          author = m[3];
        }
        const text = extractCaption(container);
        const mediaType = container.querySelector("video") ? "video" : "photo";

        console.log("[抓圖收藏][IG] 偵測到讚", { url, author, mediaType, textPreview: text.slice(0, 30) });

        if (!url || !author) {
          console.log("[抓圖收藏][IG] 抓不到網址或帳號，略過（選擇器可能要調整）");
          return;
        }

        loadHashtags((tags) => {
          const chars = matchedCharacters(text, tags);
          if (chars.length === 0) {
            console.log("[抓圖收藏][IG] 沒對到任何角色關鍵字，略過", text);
            return;
          }
          submitCollect("[抓圖收藏][IG]", { url, author, text, mediaType, chars });
        });
      },
      true
    );
  }
})();
