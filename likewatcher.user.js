// ==UserScript==
// @name         抓圖 Bot - X 按讚自動蒐集
// @namespace    ponytail
// @version      1.0
// @description  在 X 按讚符合角色 Hashtag 的推文時，自動送去自己的 Discord 機器人後端收藏
// @match        https://x.com/*
// @match        https://twitter.com/*
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

  function detectMediaType(article) {
    if (article.querySelector('[data-testid="videoPlayer"]')) return "video";
    if (article.querySelector('[data-testid="tweetPhoto"]')) return "photo";
    return null; // 純文字推文，不是我們要的
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
      const text = article.querySelector('[data-testid="tweetText"]')?.innerText || "";

      loadHashtags((tags) => {
        const chars = matchedCharacters(text, tags);
        if (chars.length === 0) {
          console.log("[抓圖收藏] 沒對到任何角色關鍵字，略過", text);
          return;
        }

        GM_xmlhttpRequest({
          method: "POST",
          url: BACKEND_URL + "/collect",
          headers: { "Content-Type": "application/json", "X-Collect-Secret": COLLECT_SECRET },
          data: JSON.stringify({ url, author, text, type: mediaType }),
          onload: (res) => console.log("[抓圖收藏]", chars, res.status, res.responseText),
          onerror: (e) => console.error("[抓圖收藏] 送出失敗", e),
        });
      });
    },
    true
  );
})();
