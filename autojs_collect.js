// 抓圖BOT：原生 App 版收集腳本（Auto.js / AutoJs6 用）
// ============================================================
// 這個腳本跟 likewatcher.user.js 做同一件事（按讚就自動把貼文送進 /collect），
// 但是用「無障礙服務背景監看畫面」取代「讀網頁 DOM + 監聽 click 事件」，讓
// X 的原生 App（不是瀏覽器版網站）也能做到「按讚就收集」。
//
// 前置需求：
//   1. Google Play 或 GitHub 裝「AutoJs6」（Auto.js 的維護分支，開源）。
//   2. 把這個檔案存到手機，在 AutoJs6 裡開啟並執行。
//   3. 執行時會跳出「開啟無障礙服務」的授權要求，去設定裡把 AutoJs6
//      的無障礙服務打開（這就是能背景監看畫面的必要授權，md 檔提過的
//      那個「可讀取螢幕所有內容」警告是這步驟本身，不是這支腳本額外要的）。
//
// 運作方式：背景每 700ms 掃一次目前螢幕上的讚按鈕狀態，跟上一次掃到的
// 狀態比對——如果某個讚按鈕從「未按」變成「已按」，就當作剛剛按讚，自動
// 觸發：找同一排的分享按鈕 → 點分享 → 點複製連結 → 讀剪貼簿拿網址 → 選
// photo/video → 把抓到的畫面文字直接送給後端比對 hashtags.json（跟
// likewatcher.user.js 同一套邏輯，後端自己判斷角色）。比對到角色就全自動
// 結束；比對不到才跳出對話框讓你手動補打角色名稱重送一次。
//
// 已知限制／這是「先射箭再畫靶」的第一版，跟以前調 IG/FB 網頁版是同一套
// 流程——先讓你實際操作、把 log() 印出來的內容回報，再照實際文字調整：
//   - 讚按鈕的文字/描述（「讚」「已按讚」之類）、分享選單裡「複製連結」的
//     文字，都是用常見繁中/英文猜的，不保證跟你 X App 顯示的字一樣。
//   - 分享按鈕改成「讚按鈕同一排工具列（留言/轉發/讚/收藏/分享）裡最右邊
//     那顆可點擊元件」來定位，不再用文字比對找分享按鈕——實測發現用「分享」
//     這個字去找，畫面上不只一處符合，會抓錯，改抓位置比較準。
//   - 內文（caption）目前是把整個畫面看得到的文字全部串起來，很粗糙。
//   - 只做 X。IG/FB 原生 App 畫面結構、選單文字都不同，等 X 這條路先
//     跑通、抓到實際除錯方法後再比照擴充。
//   - 在快速滑動的時間軸上同時有好幾個讚按鈕在畫面上時，用「按鈕在螢幕
//     上的座標」當識別依據，滑動換頁後座標重複使用可能誤判，目前沒有
//     更精準的做法（原生 App 沒有 URL 這種穩定 ID 可以拿來認貼文）。
// ============================================================

// 注意：不要在檔案開頭加 "ui";——加了會讓這支腳本自己佔用一個空白 Activity，
// 之後點 AutoJs6 App 圖示會點到那個空白畫面而不是 AutoJs6 真正的主介面，
// 而且這支腳本用不到 ui 佈局模式（浮動視窗/對話框都不需要它）。

// ---- 設定：改成你自己的值 ----
var BACKEND_URL = "https://BoboboboB.pythonanywhere.com/collect";
var COLLECT_SECRET = "填入你 .env 裡 COLLECT_SECRET 的值";
var POLL_MS = 700;

// 主控台預設隱藏，不會擋畫面——長按下面那顆懸浮按鈕可以隨時切換顯示/隱藏，
// 平常靠 toastLog() 的小提示就夠了，隱不隱藏都不影響腳本邏輯（log 照樣有記錄）。
console.hide();

auto.waitFor(); // 沒開無障礙服務會先跳出授權畫面，開完才會繼續往下跑

// 手動按鈕當備用觸發：自動偵測失敗時，人工點目前畫面上「最後一個看到的貼文」。
// 縮小、初始放右下角附近，不擋在讚/分享那排正中間。
// 用 left|top 當基準座標系（setPosition 的 x/y 就是螢幕絕對座標，拖曳算距離比較單純）。
var window = floaty.window(
  <frame gravity="left|top">
    <button id="collect" text="抓" w="36" h="36" textSize="10sp" style="Widget.AppCompat.Button.Colored"/>
  </frame>
);
window.setPosition(device.width - 60, device.height - 220);

// 自己接管觸控事件，同時支援三種手勢：
//   按住不放拖曳 → 移動按鈕位置
//   短按放開（沒移動）→ 觸發手動收集
//   長按不放（沒移動、超過 LONG_PRESS_MS）→ 切換主控台顯示/隱藏
// 一旦自己接管 setOnTouchListener，button 原生的 click/長按事件就不會再觸發了，
// 三種行為都要在這裡自己判斷。
var DRAG_THRESHOLD = 15; // px，超過這個位移量才算拖曳，不然手抖一下就誤觸拖曳
var LONG_PRESS_MS = 500;
var consoleVisible = false;
var touchStartX, touchStartY, winStartX, winStartY, touchStartTime, dragged;

window.collect.setOnTouchListener(function (view, event) {
  switch (event.getAction()) {
    case event.ACTION_DOWN:
      touchStartX = event.getRawX();
      touchStartY = event.getRawY();
      winStartX = window.getX();
      winStartY = window.getY();
      touchStartTime = new Date().getTime();
      dragged = false;
      return true;
    case event.ACTION_MOVE:
      var dx = event.getRawX() - touchStartX;
      var dy = event.getRawY() - touchStartY;
      if (dragged || Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        dragged = true;
        window.setPosition(winStartX + dx, winStartY + dy);
      }
      return true;
    case event.ACTION_UP:
      if (dragged) {
        return true; // 拖完放開，不當成點擊
      }
      if (new Date().getTime() - touchStartTime >= LONG_PRESS_MS) {
        if (consoleVisible) { console.hide(); } else { console.show(); }
        consoleVisible = !consoleVisible;
      } else {
        threads.start(function () { collectFromShareFlow(); });
      }
      return true;
  }
  return false;
});

// ---- 背景自動偵測按讚 ----
var likedSeen = {}; // key: 按鈕座標, value: 上次看到的 desc 文字

threads.start(function () {
  while (true) {
    try {
      if (currentPackage() === "com.twitter.android") {
        watchLikes();
      }
    } catch (e) {
      log("watchLikes 發生錯誤：" + e);
    }
    sleep(POLL_MS);
  }
});

function isLikedDesc(desc) {
  return /已按讚|取消讚|已喜歡|取消喜歡|Liked|Unlike/.test(desc || "");
}

function watchLikes() {
  var buttons = descMatches(/^(讚|Like|已按讚|取消讚|喜歡|已喜歡|取消喜歡|Liked|Unlike)$/).find();
  buttons.forEach(function (btn) {
    var key = btn.bounds().toShortString();
    var state = btn.desc();
    var wasLiked = isLikedDesc(likedSeen[key]);
    var nowLiked = isLikedDesc(state);
    likedSeen[key] = state;
    if (!wasLiked && nowLiked) {
      log("偵測到新的按讚，座標 " + key);
      handleNewLike(btn);
    }
  });
}

function handleNewLike(likeBtn) {
  var shareBtn = findShareButtonNearLike(likeBtn);
  if (!shareBtn) {
    toastLog("按讚偵測到了，但找不到同排最右邊的分享按鈕，回報目前畫面 log");
    logVisibleDescs();
    return;
  }
  runShareFlow(shareBtn, "剛剛按讚的貼文");
}

// 手動備用按鈕：畫面上隨便找一個讚按鈕，用同一套「同排最右邊」邏輯定位分享鍵
// （適合你人工點開單篇貼文詳細頁再按）。
function collectFromShareFlow() {
  var likeBtn = descMatches(/^(讚|Like|已按讚|取消讚|喜歡|已喜歡|取消喜歡|Liked|Unlike)$/).findOne(2000);
  if (!likeBtn) {
    toastLog("畫面上找不到讚按鈕，回報目前畫面 log");
    logVisibleDescs();
    return;
  }
  var shareBtn = findShareButtonNearLike(likeBtn);
  if (!shareBtn) {
    toastLog("找不到同排最右邊的分享按鈕，回報目前畫面 log");
    logVisibleDescs();
    return;
  }
  runShareFlow(shareBtn, "目前畫面的貼文");
}

// 分享按鈕不是靠文字找（畫面上不只一個地方帶有「分享」相關文字，之前抓錯過），
// 改成：讚按鈕跟分享按鈕擠在同一排工具列（留言/轉發/讚/收藏/分享），往上找
// 幾層父層，找到那一排之後，直接取「最右邊」那個可點擊的元件當分享鍵。
function findShareButtonNearLike(likeBtn) {
  var node = likeBtn.parent();
  for (var hops = 0; hops < 4 && node; hops++) {
    var children = (node.children() || []).filter(function (c) { return c.clickable(); });
    if (children.length > 1) {
      return children[children.length - 1];
    }
    node = node.parent();
  }
  return null;
}

// 共用：點分享 → 複製連結 → 讀剪貼簿 → 跳出確認對話框 → 送出。
// 主控台預設就是隱藏的（見檔案開頭 console.hide()），這裡不用特別處理顯示/
// 隱藏——想看過程 log 就長按浮動按鈕切換，不想看就讓它一直藏著。
function runShareFlow(shareBtn, hint) {
  shareBtn.click();
  sleep(1000);

  var copyLink = textContains("複製連結").findOne(3000) || textContains("Copy link").findOne(3000)
    || descContains("複製連結").findOne(3000) || descContains("Copy link").findOne(3000);
  if (!copyLink) {
    toastLog("分享選單裡找不到「複製連結」，回報目前畫面 log");
    logVisibleDescs();
    return; // 不自動按返回——之前這裡呼叫 back() 會把 X 整個導覽堆疊退出 App，不是只關分享選單
  }
  // 找到的常常是文字標籤本身、不是真正可點擊的那層（點了沒反應，剪貼簿不會更新）
  // ——往上找到第一個 clickable() 的節點再點。
  clickNodeOrClickableAncestor(copyLink);
  sleep(800); // 給複製動作跟選單關閉一點時間，之前 500ms 讀到的是舊剪貼簿內容

  var url = getClip();
  log("抓到網址：" + url);
  if (!url || url.indexOf("http") !== 0) {
    toastLog("剪貼簿內容看起來不是網址：" + url);
    return;
  }

  var caption = className("android.widget.TextView").find()
    .map(function (n) { return n.text(); })
    .filter(Boolean).join(" / ");
  log("畫面文字（抓內文用，供你對照調整）：\n" + caption);

  var typeIndex = dialogs.select("類型", ["photo", "video"]);
  if (typeIndex === -1) { toastLog("已取消"); return; }
  var mediaType = typeIndex === 0 ? "photo" : "video";

  // 先把抓到的畫面文字整包當 text 送出，跟瀏覽器版 likewatcher.user.js 一樣，
  // 交給後端自己比對 hashtags.json——比對得到的話全自動，不用手動打角色。
  var result = submitCollect(url, mediaType, caption);
  if (result.addedTo.length > 0) {
    toastLog("自動比對成功，已加入：" + result.addedTo.join("、"));
    return;
  }

  // 畫面文字沒比對到任何角色，才手動補打一次。
  toastLog("畫面文字沒比對到角色，手動輸入");
  var character = dialogs.rawInput("角色名稱（" + hint + "）", "");
  if (!character) { toastLog("已取消"); return; }
  var result2 = submitCollect(url, mediaType, "#" + character);
  if (result2.addedTo.length > 0) {
    toastLog("已加入：" + result2.addedTo.join("、"));
  } else {
    toastLog("還是沒比對到，狀態碼 " + result2.statusCode + "，回報 log 對一下 hashtags.json 裡的名字");
  }
}

// 送出 /collect，回傳狀態碼跟後端實際比對到的角色清單（added_to）。
function submitCollect(url, mediaType, text) {
  var res = http.postJson(BACKEND_URL, {
    url: url,
    type: mediaType,
    text: text,
  }, {
    headers: { "X-Collect-Secret": COLLECT_SECRET },
  });
  var bodyText = res.body.string();
  log(res.statusCode + " " + bodyText);
  var addedTo = [];
  try {
    addedTo = JSON.parse(bodyText).added_to || [];
  } catch (e) {
    log("回應不是合法 JSON：" + e);
  }
  return { statusCode: res.statusCode, addedTo: addedTo };
}

// 有些選單項目找到的是文字標籤節點本身，不可點擊，要往上找第一個
// clickable() 的父層來點，不然點了沒反應。
function clickNodeOrClickableAncestor(node) {
  var n = node;
  for (var hops = 0; hops < 5 && n; hops++) {
    if (n.clickable()) {
      n.click();
      return true;
    }
    n = n.parent();
  }
  node.click(); // 保底：都沒找到 clickable 的話至少試著點原本那個節點
  return false;
}

function logVisibleDescs() {
  var descs = className("android.view.View").find()
    .map(function (n) { return n.desc(); }).filter(Boolean);
  var texts = className("android.widget.TextView").find()
    .map(function (n) { return n.text(); }).filter(Boolean);
  log("目前畫面上的 desc：\n" + descs.join("\n"));
  log("目前畫面上的文字：\n" + texts.join("\n"));
}
