// 抓圖BOT：原生 App 版收集腳本（Auto.js / AutoJs6 用）
// ============================================================
// 這個腳本讓 X 的原生 App（不是瀏覽器版網站）也能把貼文送進 /collect，
// 用「無障礙服務讀畫面結構」取代「讀網頁 DOM」，因為原生 App 沒有 DOM
// 可以讀、也沒有 click 事件可以監聽。
//
// v4.0 重寫（架構整個改掉，捨棄自動偵測按讚）：v2～v3.16 一路想做的是
// 「按讚就自動偵測、自動收集」，全靠無障礙服務去猜「這則貼文的範圍在
// 畫面上是哪一塊」——這條路一輪一輪修過引用貼文、嵌入卡片、多圖輪播、
// 無障礙查詢卡死要戳一下才會恢復……每次以為修好了，換一種貼文版面就
// 又抓錯，treadmill 一直跑不完（完整過程留在 git 歷史裡，這裡不重複）。
// 改成完全手動觸發：不再背景輪詢、不再猜「有沒有按讚」，你自己按讚/
// 轉推之後，自己按浮動按鈕告訴腳本「就是現在畫面上這篇」。少掉的是
// 「不用手動點」這個自動化程度，換到的是「不會再抓到鄰篇貼文的內容」
// ——手動觸發的當下，你的注意力就在這篇貼文上，範圍判斷不需要再猜
// 「有沒有滑走」「分享選單開著算不算」這類跟時間有關的邊界情況，跟
// 貼文版面本身有關的邊界情況（引用貼文/大頭貼歸屬）依然可能踩到，但
// 至少不會無聲無息地抓錯又寫進收藏庫。
//
// 三顆浮動按鈕：
//   「抓」：手動收集目前畫面上看得到的貼文。抓網址 → 送後端比對
//          hashtags.json → 比對到角色就直接寫入收藏庫；比對不到才跳出
//          角色清單讓你點選（不是要你用打字猜關鍵字，用列表選）。
//   「D」：切換「這次收集完要不要順便推播到 Discord」，跟「抓」「轉」
//          共用同一個開關，不用兩套。
//   「轉」：你自己在 X 裡按完轉推之後，手動點這顆——一樣是抓網址 →
//          比對 hashtags.json，比對不到一樣跳角色清單。獨立於「抓」，
//          用來處理「這篇貼文的文字沒有你要的角色關鍵字，但你還是想
//          歸類到某個角色底下」的情況（例如你轉推是因為畫面內容而不是
//          因為它自己的文字），跟「抓」共用同一套底層流程，差別只在
//          呼叫時機/提示文字。
//
// 前置需求：
//   1. Google Play 或 GitHub 裝「AutoJs6」（Auto.js 的維護分支，開源）。
//   2. 把這個檔案存到手機，在 AutoJs6 裡開啟並執行。
//   3. 執行時會跳出「開啟無障礙服務」的授權要求，去設定裡把 AutoJs6
//      的無障礙服務打開（這就是能背景讀取畫面結構的必要授權）。
//
// 已知限制：
//   - 只做 X。IG/FB 原生 App 畫面結構、選單文字都不同，沒有比照擴充。
//   - 讚按鈕同排工具列的位置抓分享鍵、貼文範圍判斷（找大頭貼當地標）
//     這幾段邏輯，是從 v2～v3.16 一路實測校準出來的，保留下來繼續用
//     （細節見 findTweetBounds()/findShareButtonNearLike() 內的註解），
//     只是現在只在你手動點按鈕的當下才跑一次，不再背景持續輪詢。
//   - 引用貼文（quote tweet）、多圖輪播這類版面，範圍判斷仍然可能抓
//     錯——手動觸發降低了「抓錯又沒人發現」的機率（你按下去當下就會
//     看到 toast 結果），但沒有從根本解決這類版面本身的歧義。
//
// v4.1 更新：v4.0 上線後實測回報「螢幕隨便點一下就消失了」——追出來不是
//   點擊造成的，是拿掉背景輪詢迴圈時漏了它順便有的另一個作用：AutoJs6
//   只要腳本還有至少一條執行緒活著就會判定「還在執行中」，主執行緒跑完
//   檔案最後一行就會被當成「腳本執行完畢」整個收掉，連同浮動視窗一起
//   消失。加一個純粹睡著的無窮迴圈當保活執行緒補回來，不做任何輪詢/
//   偵測工作，見下面「保持腳本存活」那段的說明。
// ============================================================

// 注意：不要在檔案開頭加 "ui";——加了會讓這支腳本自己佔用一個空白 Activity，
// 之後點 AutoJs6 App 圖示會點到那個空白畫面而不是 AutoJs6 真正的主介面，
// 而且這支腳本用不到 ui 佈局模式（浮動視窗/對話框都不需要它）。

// ---- 設定：後端網址/密鑰 ----
// 存在本機（storages，AutoJs6 版的 GM_setValue/GM_getValue），不寫死在
// 腳本內容裡。第一次執行才會跳輸入框問一次，之後都記得住、重開腳本也
// 不會忘；拿新版檔案整份覆蓋也不會連帶洗掉。畫面上「設定」用不到了
// （已隨其他非必要按鈕一起捨棄），要改設定改叫 reconfigureBackendUrl()/
// reconfigureSecret() 的地方變成長按「抓」時的選單（見下面）。
var settings = storages.create("autojs_collect");

function getBackendUrl() {
  var saved = settings.get("backendUrl", "");
  if (saved) return saved;
  var entered = dialogs.rawInput("第一次設定：請貼上完整的 /collect 網址（例如 https://xxx.pythonanywhere.com/collect）", "");
  log("getBackendUrl() 輸入框回傳：" + JSON.stringify(entered));
  var url = entered ? entered.trim().replace(/\/+$/, "") : "";
  if (url) settings.put("backendUrl", url);
  return url;
}

function getSecret() {
  var saved = settings.get("collectSecret", "");
  if (saved) return saved;
  var entered = dialogs.rawInput("第一次設定：請貼上你的 COLLECT_SECRET（跟 .env 裡的一致）", "");
  log("getSecret() 輸入框回傳長度：" + (entered ? entered.length : 0));
  var secret = entered ? entered.trim() : "";
  if (secret) settings.put("collectSecret", secret);
  return secret;
}

var BACKEND_URL = getBackendUrl();
var COLLECT_SECRET = getSecret();

function reconfigureBackendUrl() {
  var entered = dialogs.rawInput("重新設定後端網址（含 /collect）：", settings.get("backendUrl", ""));
  if (!entered) return;
  BACKEND_URL = entered.trim().replace(/\/+$/, "");
  settings.put("backendUrl", BACKEND_URL);
  toastLog("後端網址已更新");
}

function reconfigureSecret() {
  var entered = dialogs.rawInput("重新設定 COLLECT_SECRET：", settings.get("collectSecret", ""));
  if (!entered) return;
  COLLECT_SECRET = entered.trim();
  settings.put("collectSecret", COLLECT_SECRET);
  toastLog("COLLECT_SECRET 已更新");
}

// 收集/轉推成功要不要順便推播到 Discord——「D」按鈕切換，狀態存在本機，
// 重開腳本也記得。預設關閉：主要動作是「寫入收藏庫」，推播是附加的。
var ANNOUNCE_ENABLED = settings.get("announceEnabled", false);

// 主控台預設隱藏，不會擋畫面——長按「抓」可以隨時切換顯示/隱藏，平常靠
// toastLog() 的小提示就夠了。
console.hide();

auto.waitFor(); // 沒開無障礙服務會先跳出授權畫面，開完才會繼續往下跑

// ---- 保持腳本存活 ----
// v3.x 一直有一個背景輪詢的 while(true) 迴圈（每 0.5 秒檢查有沒有按讚），
// v4.0 把它整個拿掉了，因為不再需要背景輪詢——但這個迴圈除了做輪詢，
// 還順便讓 AutoJs6 判定「這支腳本還在執行中」：只要至少有一條執行緒還
// 活著，AutoJs6 就不會把腳本收掉。拿掉迴圈之後主執行緒跑完檔案最後一行
// 就沒事做了，AutoJs6 判定「腳本執行完畢」，把整支腳本——連同浮動視窗、
// 三顆按鈕的點擊監聽器——一起回收掉，浮動按鈕看起來就是「莫名其妙消失」
// （實測回報：任務清單顯示「執行中任務 [1]」，幾秒內自己變成 [0]，過程
// 中沒有使用者額外操作）。加一個純粹睡著、什麼事都不做的無窮迴圈當保活
// 執行緒，只是要讓腳本不會被判斷成「已經跑完了」，不做任何輪詢/偵測。
threads.start(function () {
  while (true) {
    sleep(1000);
  }
});

// ---- 三顆浮動按鈕：抓 / D / 轉 ----
// 縮小、初始放右下角附近，不擋在讚/分享那排正中間。
var window = floaty.window(
  <vertical gravity="left|top">
    <button id="collect" text="抓" w="36" h="36" textSize="10sp" style="Widget.AppCompat.Button.Colored"/>
    <button id="discord" text="D" w="36" h="36" textSize="10sp"/>
    <button id="retweet" text="轉" w="36" h="36" textSize="10sp"/>
  </vertical>
);
window.setPosition(device.width * 0.82, device.height * 0.75);

function updateDiscordButtonText() {
  window.discord.setText(ANNOUNCE_ENABLED ? "D\n開" : "D\n關");
}
updateDiscordButtonText();
window.discord.click(function () {
  ANNOUNCE_ENABLED = !ANNOUNCE_ENABLED;
  settings.put("announceEnabled", ANNOUNCE_ENABLED);
  updateDiscordButtonText();
  toastLog("收集/轉推成功時通知 Discord：" + (ANNOUNCE_ENABLED ? "開" : "關"));
});

// 「轉」：短按觸發轉推收集流程（你已經在 X 裡按完轉推，這裡告訴腳本
// 「就是現在畫面上這篇」）。不用自己處理拖曳——拖曳統一由「抓」的
// touch listener 負責移動整個浮動視窗。
window.retweet.click(function () {
  threads.start(function () {
    try {
      runLocked(function () { runManualCollectFlow("剛剛轉推的貼文"); });
    } catch (e) {
      log("轉推收集流程發生錯誤：" + e);
      toastLog("轉推收集流程出錯：" + e);
    }
  });
});

// 「抓」自己接管觸控事件，同時支援三種手勢（也是整個浮動視窗的拖曳
// 手把）：
//   按住不放拖曳 → 移動整組按鈕位置
//   短按放開（沒移動）→ 觸發「收集目前畫面上這篇」
//   長按不放（沒移動、超過 LONG_PRESS_MS）→ 跳出選單：切換主控台顯示/
//     隱藏，或重新設定後端網址/COLLECT_SECRET（原本「設定」按鈕的功能，
//     併到這裡，不用另外佔一顆按鈕）
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
        threads.start(function () {
          try {
            var idx = dialogs.select("長按選單", ["切換主控台顯示/隱藏", "重新設定後端網址", "重新設定 COLLECT_SECRET"]);
            if (idx === 0) {
              if (consoleVisible) { console.hide(); } else { console.show(); }
              consoleVisible = !consoleVisible;
            } else if (idx === 1) {
              reconfigureBackendUrl();
            } else if (idx === 2) {
              reconfigureSecret();
            }
          } catch (e) {
            log("長按選單發生錯誤：" + e);
            toastLog("長按選單出錯：" + e);
          }
        });
      } else {
        threads.start(function () {
          try {
            runLocked(function () { runManualCollectFlow("剛剛按讚的貼文"); });
          } catch (e) {
            log("收集流程發生錯誤：" + e);
            toastLog("收集流程出錯：" + e);
          }
        });
      }
      return true;
  }
  return false;
});

// 「抓」「轉」共用同一把鎖——這段要操作畫面（點分享/開分享選單/複製
// 連結），兩個按鈕幾乎不會真的同時按到，但萬一手滑連點，這把鎖讓它們
// 排隊、一次只有一個真的在操作畫面，避免兩個分享選單互相干擾。
var collectLock = threads.lock();

function runLocked(fn) {
  collectLock.lock();
  try {
    fn();
  } finally {
    collectLock.unlock();
  }
}

// 讚按鈕的文字/描述模式，用來在畫面上定位「現在看的是哪篇貼文」——不是
// 拿來判斷有沒有按讚（沒有背景輪詢了，不需要判斷狀態變化），純粹當一個
// 「這排工具列在哪裡」的錨點，找它同排最右邊的分享鍵、往上找大頭貼算
// 範圍都靠它定位。
var LIKE_BUTTON_PATTERN = /^(讚|Like|已按讚|取消讚|喜歡|已喜歡|取消喜歡|Liked|Unlike)$/;

function findLikeButtons() {
  return descMatches(LIKE_BUTTON_PATTERN).find();
}

// ---- 貼文範圍判斷：找大頭貼當「這則貼文從哪裡開始」的地標 ----
// 判斷一顆 ImageView 是不是「大頭貼尺寸」——正方形、夠大，門檻要夠高
// 才不會把工具列裡留言/轉發/讚/收藏/分享這些正方形小圖示（通常 18~24dp）
// 也算進去。
function isAvatarSized(b) {
  var w = b.width(), h = b.height();
  return w > 80 && Math.abs(w - h) < 15;
}

function findAvatarNodes() {
  return className("android.widget.ImageView").find().filter(function (img) {
    return isAvatarSized(img.bounds());
  });
}

// 這則貼文的垂直範圍：起點是大頭貼，終點是讚/轉發那排工具列。
//
// 下限（floor）：往上找最近的「另一顆讚按鈕」，取它的下緣——畫面由上而下
// 線性排列，每則最外層貼文只有一顆讚按鈕，所以「上一顆讚按鈕的下緣」就是
// 上一則貼文結束的地方，這則貼文的內容不可能比這個更早開始。找不到就用 0。
//
// 這則貼文自己的大頭貼：在 [floor, likeTop) 這個範圍內，取「Y 最小、也就
// 是最上面」的那一顆，不是最靠近讚按鈕的那一顆——引用貼文（quote tweet）
// 在這個範圍內可能出現兩顆大頭貼：這則貼文自己的（在最上面，緊接在上一則
// 貼文結束的地方）跟被引用貼文那張嵌入卡片自己的（比較靠近這則貼文的讚
// 按鈕）。取「最上面」的那一顆才是這則貼文真正自己的大頭貼——嵌入卡片
// 一定畫在它之後（由上而下渲染，外層一定先畫）。找不到大頭貼（這則貼文
// 剛好在畫面最上面，大頭貼被捲出螢幕外）就退回 floor。
function findTweetBounds(likeBtn, allLikeButtons) {
  var likeTop = likeBtn.bounds().top;

  var floor = 0;
  (allLikeButtons || []).forEach(function (otherBtn) {
    if (otherBtn === likeBtn) return;
    var otherBottom = otherBtn.bounds().bottom;
    if (otherBottom < likeTop && otherBottom > floor) floor = otherBottom;
  });

  var top = -1;
  findAvatarNodes().forEach(function (img) {
    var ay = img.bounds().top;
    if (ay >= floor && ay < likeTop && (top === -1 || ay < top)) top = ay;
  });
  if (top === -1) top = floor;

  return { top: top, bottom: likeTop };
}

// 節點的垂直中心點有沒有落在這則貼文自己的範圍內。
function nodeInBounds(node, bounds) {
  var b = node.bounds();
  var centerY = (b.top + b.bottom) / 2;
  return centerY >= bounds.top && centerY < bounds.bottom;
}

// 內文抓取：只抓「這則貼文垂直範圍內」的 TextView 文字串起來。
function extractCaption(bounds) {
  return className("android.widget.TextView").find()
    .filter(function (n) { return nodeInBounds(n, bounds); })
    .map(function (n) { return n.text(); })
    .filter(Boolean)
    .join(" / ");
}

// 影片/照片自動判斷：媒體縮圖上，影片一定會疊一個時長徽章（"0:12" 這種
// 分:秒 格式的短文字）或 GIF 徽章，照片不會有。只在這則貼文自己的垂直
// 範圍內找，兩種徽章都沒有、但範圍裡至少找得到一張圖就當照片；連圖都
// 找不到才回傳 null，讓呼叫端退回手動對話框。
function detectMediaType(bounds) {
  var texts = className("android.widget.TextView").find()
    .filter(function (n) { return nodeInBounds(n, bounds); })
    .map(function (n) { return n.text(); });
  if (texts.some(function (t) { return /^\d{1,2}:\d{2}$/.test(t) || /^GIF$/i.test(t); })) {
    return "video";
  }
  var descs = className("android.view.View").find()
    .filter(function (n) { return nodeInBounds(n, bounds); })
    .map(function (n) { return n.desc(); }).filter(Boolean);
  if (descs.some(function (d) { return /播放|^Play$|Video|影片/i.test(d); })) {
    return "video";
  }
  var hasImage = className("android.widget.ImageView").find()
    .filter(function (n) { return nodeInBounds(n, bounds); }).length > 0;
  if (hasImage) {
    return "photo";
  }
  return null;
}

// 分享按鈕不是靠文字找（畫面上不只一個地方帶有「分享」相關文字，容易抓
// 錯），改成：讚按鈕跟分享按鈕擠在同一排工具列（留言/轉發/讚/收藏/分享），
// 往上找幾層父層，找到那一排之後，直接取「最右邊」那個可點擊的元件當
// 分享鍵。
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

// ---- 手動觸發：「抓」「轉」共用的入口 ----
// 畫面上隨便找一個讚按鈕當「現在看的是哪篇貼文」的錨點（適合你人工點開
// 單篇貼文詳細頁、或滑到想要那篇再按）。
function runManualCollectFlow(hint) {
  var allLikeButtons = findLikeButtons();
  var likeBtn = allLikeButtons[0];
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
  runShareFlow(likeBtn, shareBtn, hint, allLikeButtons);
}

// 共用：先抓內文/媒體類型 → 點分享 → 複製連結 → 讀剪貼簿 → 送出。
// 內文跟媒體類型特意搬到「點分享之前」抓——分享選單開了又關這段期間
// 畫面很容易重新佈局，事後才用按鈕節點往上爬，抓到的常常已經是漂移過
// 的內容，不如當下先抓好。
function runShareFlow(likeBtn, shareBtn, hint, allLikeButtons) {
  if (!BACKEND_URL || !COLLECT_SECRET) {
    toastLog("尚未設定後端網址/密鑰，長按「抓」補上再試");
    return;
  }

  var bounds = findTweetBounds(likeBtn, allLikeButtons);
  var caption = extractCaption(bounds);
  log("畫面文字（抓內文用，供你對照調整）：\n" + caption);
  var mediaType = detectMediaType(bounds);
  log("媒體類型自動判斷：" + (mediaType || "判斷不出來，等一下跳對話框讓你選"));

  shareBtn.click();
  sleep(1000);

  var copyLink = textContains("複製連結").findOne(3000) || textContains("Copy link").findOne(3000)
    || descContains("複製連結").findOne(3000) || descContains("Copy link").findOne(3000);
  if (!copyLink) {
    toastLog("分享選單裡找不到「複製連結」，回報目前畫面 log");
    logVisibleDescs();
    return; // 不自動按返回——之前這裡呼叫 back() 會把 X 整個導覽堆疊退出 App，不是只關分享選單
  }
  clickNodeOrClickableAncestor(copyLink);
  sleep(800); // 給複製動作跟選單關閉一點時間

  var url = getClip();
  log("抓到網址：" + url);
  if (!url || url.indexOf("http") !== 0) {
    toastLog("剪貼簿內容看起來不是網址：" + url);
    return;
  }

  if (processedUrls[url]) {
    toastLog("這篇貼文這次執行已經處理過了，跳過");
    return;
  }
  processedUrls[url] = true;

  if (!mediaType) {
    var typeIndex = dialogs.select("類型（自動判斷不出來，手動選一下）", ["photo", "video"]);
    if (typeIndex === -1) { toastLog("已取消"); return; }
    mediaType = typeIndex === 0 ? "photo" : "video";
  }

  // 先把抓到的畫面文字整包當 text 送出，交給後端自己比對 hashtags.json——
  // 比對得到的話全自動，不用手動打角色。
  var result = submitCollect(url, mediaType, caption);
  if (result.addedTo.length > 0) {
    toastLog("自動比對成功，已加入：" + result.addedTo.join("、"));
    return;
  }

  // 畫面文字沒比對到任何角色，跳出角色清單讓你直接點選——不是要你憑空
  // 打對關鍵字，是給清單挑。
  toastLog("畫面文字沒比對到角色，選一個");
  var character = pickCharacterFromList(hint);
  if (!character) { toastLog("已取消"); return; }
  var result2 = submitCollect(url, mediaType, "#" + character);
  if (result2.addedTo.length > 0) {
    toastLog("已加入：" + result2.addedTo.join("、"));
  } else {
    toastLog("還是沒比對到，狀態碼 " + result2.statusCode + "，回報 log 對一下 hashtags.json 裡的名字");
  }
}

// 這一輪跑腳本期間，已經真正跑到「抓到網址」這一步的貼文網址——不管後面
// 是自動比對成功、手動選單成功、手動取消、還是比對失敗，都算「這篇貼文
// 這次執行已經處理過了」，避免手滑連點同一篇貼文的「抓」/「轉」，把分享
// 選單、角色清單又跑一次。只在記憶體裡，跟著這次腳本執行的生命週期，
// 不用存到 storages——後端 /collect 本來就會用網址去重。
var processedUrls = {};

// ---- 角色清單：/hashtags 拉全部角色名稱，一定要能「用點的」----
// 跟舊版「打字→查→選」不同的地方：舊版查不到候選字時會直接拿你打的字
// 硬送出去（打錯字/hashtags.json 裡沒有這個角色都不會有任何提示），這裡
// 保證最後一定是從清單裡點出來的——查不到同音字候選就退回本地子字串篩選，
// 篩選完還是空的就直接顯示全部角色清單，不會有「盲送」這回事。
var HASHTAGS_CACHE = null;

function loadHashtags() {
  if (HASHTAGS_CACHE) return HASHTAGS_CACHE;
  if (!BACKEND_URL) return null;
  try {
    var hashtagsUrl = BACKEND_URL.replace(/\/collect$/, "/hashtags");
    var res = http.get(hashtagsUrl);
    HASHTAGS_CACHE = JSON.parse(res.body.string());
    log("已載入 hashtags 對照表，共 " + Object.keys(HASHTAGS_CACHE).length + " 個角色");
  } catch (e) {
    log("讀取 /hashtags 失敗：" + e);
    HASHTAGS_CACHE = null;
  }
  return HASHTAGS_CACHE;
}
loadHashtags(); // 開機先拉一次快取起來，角色清單要用，不要每次點選都重打一次 API

// 打同音字/部分字（可留空看全部）→ 先打 /autocomplete 拿同音字候選 →
// 查不到才退回本地子字串篩選 → 篩選完還是空的就直接列出全部角色 →
// 一定跳 dialogs.select() 讓你點，不會有「查不到就拿你打的字硬送」這種
// 沒清單可點的情況。
function pickCharacterFromList(hint) {
  var tags = loadHashtags();
  var allNames = tags
    ? Object.keys(tags).filter(function (n) { return n.indexOf("_") !== 0; })
    : [];

  if (allNames.length === 0) {
    // hashtags 對照表讀不到（開機當下網路沒接上之類）——沒有清單可以列，
    // 只能退回純打字當最後手段。
    toastLog("讀不到角色對照表，只能先用打字（回報這行給開發者）");
    var typed = dialogs.rawInput("角色名稱（" + hint + "）", "");
    return typed || null;
  }

  var query = dialogs.rawInput("角色名稱（" + hint + "，可打同音字搜尋，留空看全部）", "");
  var candidates = allNames;
  if (query) {
    var matches = [];
    try {
      var autocompleteUrl = BACKEND_URL.replace(/\/collect$/, "/autocomplete") + "?q=" + encodeURIComponent(query);
      var res = http.get(autocompleteUrl);
      matches = JSON.parse(res.body.string());
    } catch (e) {
      log("查詢 /autocomplete 失敗：" + e);
    }
    if (matches.length === 0) {
      // 同音字比對查不到，退回本地子字串篩選（大小寫不分）。
      var lowerQuery = query.toLowerCase();
      matches = allNames.filter(function (n) { return n.toLowerCase().indexOf(lowerQuery) !== -1; });
    }
    if (matches.length > 0) candidates = matches;
    // matches 還是空的話，candidates 維持 allNames——讓你從完整清單裡找，
    // 不會因為打錯字就卡住沒得選。
  }

  var idx = dialogs.select("選角色" + (candidates === allNames ? "（全部）" : ""), candidates);
  return idx === -1 ? null : candidates[idx];
}

// 送出 /collect，回傳狀態碼跟後端實際比對到的角色清單（added_to）。
function submitCollect(url, mediaType, text) {
  var res = http.postJson(BACKEND_URL, {
    url: url,
    type: mediaType,
    text: text,
    announce: ANNOUNCE_ENABLED,
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
