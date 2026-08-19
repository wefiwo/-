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
// 運作方式：用 events.onTouch() 監聽真正的觸控動作（事件觸發，不是固定
// 秒數輪詢）——你點螢幕的當下，才去檢查那個點附近有沒有剛好是讚按鈕、
// 狀態是不是從「未按」變「已按」。是的話自動觸發：找同一排的分享按鈕 →
// 點分享 → 點複製連結 → 讀剪貼簿拿網址 → 選 photo/video → 把抓到的畫面
// 文字（只抓這篇貼文卡片範圍內，避免混到鄰篇）送給後端比對 hashtags.json
// （跟 likewatcher.user.js 同一套邏輯，後端自己判斷角色）。比對到角色就
// 全自動結束；比對不到才跳出對話框讓你手動補打角色名稱重送一次。另外留
// 一個 8 秒一次的低頻全畫面備援輪詢，防觸控事件萬一漏接。
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
// 開了之後，收集成功會順便通知到 .env 裡設定的 Discord 頻道（後端既有的
// post_announcement 功能，跟 likewatcher.user.js 的公告開關是同一套邏輯）。
// 不用改程式碼，畫面上「公告」那顆懸浮按鈕點一下就能切換，狀態存在本機
// （storages），重開腳本也記得。預設關閉。
var settings = storages.create("autojs_collect");
var ANNOUNCE_ENABLED = settings.get("announceEnabled", false);

// 主控台預設隱藏，不會擋畫面——長按下面那顆懸浮按鈕可以隨時切換顯示/隱藏，
// 平常靠 toastLog() 的小提示就夠了，隱不隱藏都不影響腳本邏輯（log 照樣有記錄）。
console.hide();

auto.waitFor(); // 沒開無障礙服務會先跳出授權畫面，開完才會繼續往下跑

// 手動按鈕當備用觸發：自動偵測失敗時，人工點目前畫面上「最後一個看到的貼文」。
// 縮小、初始放右下角附近，不擋在讚/分享那排正中間。
// 用 left|top 當基準座標系（setPosition 的 x/y 就是螢幕絕對座標，拖曳算距離比較單純）。
var window = floaty.window(
  <vertical gravity="left|top">
    <button id="collect" text="抓" w="36" h="36" textSize="10sp" style="Widget.AppCompat.Button.Colored"/>
    <button id="announce" text="公告" w="36" h="36" textSize="9sp"/>
  </vertical>
);
// 用螢幕比例定位，不用「device.width - 固定像素」——按鈕大小是 dp、
// device.width 是實際像素，兩種單位沒對齊，之前算出來的位置把按鈕推到
// 螢幕外面去了（幾乎點不到）。比例算法不管螢幕密度多少都不會跑出邊界。
window.setPosition(device.width * 0.82, device.height * 0.75);

// 「公告」按鈕：單純點擊切換 ANNOUNCE_ENABLED，不用像「抓」那樣處理拖曳/
// 長按——拖曳「抓」的時候會整個懸浮視窗一起移動，兩顆按鈕位置一直是相對的，
// 不用個別處理。文字直接顯示目前開/關狀態，點了立刻更新 + 存到本機。
function updateAnnounceButtonText() {
  window.announce.setText(ANNOUNCE_ENABLED ? "公告\n開" : "公告\n關");
}
updateAnnounceButtonText();
window.announce.click(function () {
  ANNOUNCE_ENABLED = !ANNOUNCE_ENABLED;
  settings.put("announceEnabled", ANNOUNCE_ENABLED);
  updateAnnounceButtonText();
  toastLog("收集成功時通知 Discord：" + (ANNOUNCE_ENABLED ? "開" : "關"));
});

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
        threads.start(function () {
          try {
            collectFromShareFlow();
          } catch (e) {
            log("collectFromShareFlow 發生錯誤：" + e);
            toastLog("收集流程出錯：" + e);
          }
        });
      }
      return true;
  }
  return false;
});

// ---- 自動偵測按讚：改成「有人點螢幕才檢查」，不是固定秒數全螢幕掃描 ----
// events.onTouch() 是事件觸發（真的有觸控動作才會呼叫），不是輪詢——
// 點下去之後只檢查「那個點附近」有沒有剛好是讚按鈕，不用每隔 X 秒把整個
// 畫面所有讚按鈕都掃一遍。額外留一個很低頻率（8 秒一次）的全畫面備援輪詢，
// 純粹防呆用（例如觸控事件萬一漏接、或用其他方式間接觸發按讚的情況），
// 平常主要靠觸控事件觸發，備援輪詢間隔拉得夠長不會造成卡頓感。
var likedSeen = {}; // key: 按鈕座標, value: 上次看到是不是已按讚（boolean）

// 備援輪詢一定要先啟動、且不能被下面的觸控事件設定拖累——如果
// events.observeTouch()/onTouch() 呼叫本身就丟例外（設定階段失敗，不在
// 我們自己包的 try/catch 範圍內），會讓腳本從那一行以下全部停止執行，
// 這個輪詢執行緒如果寫在後面就永遠不會啟動。所以先讓它獨立跑起來。
var FALLBACK_POLL_MS = 8000;
threads.start(function () {
  while (true) {
    sleep(FALLBACK_POLL_MS);
    try {
      if (currentPackage() === "com.twitter.android") {
        watchLikes(null);
      }
    } catch (e) {
      log("備援輪詢出錯：" + e);
      toastLog("備援輪詢出錯：" + e);
    }
  }
});

// 觸控事件設定本身包一層 try/catch——這個 API 能不能穩定運作還沒把握，
// 設定失敗就跳提示、直接退回純靠上面那個備援輪詢運作，不要讓失敗拖垮
// 整支腳本。
try {
  events.observeTouch();
  events.onTouch(function (point) {
    threads.start(function () {
      try {
        if (currentPackage() === "com.twitter.android") {
          sleep(200); // 給畫面一點時間反應按讚動畫/狀態更新，太快讀到舊狀態
          watchLikes(point);
        }
      } catch (e) {
        log("觸控偵測出錯：" + e);
        toastLog("觸控偵測出錯：" + e);
      }
    });
  });
} catch (e) {
  log("觸控事件監聽設定失敗，改用純輪詢：" + e);
  toastLog("觸控事件監聽設定失敗，改用純輪詢：" + e);
}

function isLikedDesc(desc) {
  return /已按讚|取消讚|已喜歡|取消喜歡|Liked|Unlike/.test(desc || "");
}

// 判斷「已按讚」優先看 checked() 這個狀態旗標（無障礙服務裡對應網頁版空心/
// 實心愛心切換的語意屬性，不受文字翻譯影響），旗標讀不到時才退回文字比對
// 當備援——這也是之前「讚」vs「喜歡」翻譯不一致會漏判的根本解法。
function isLiked(btn, desc) {
  try {
    if (typeof btn.checked === "function") {
      return btn.checked();
    }
  } catch (e) {
    // 有些節點沒有 checked 這個屬性，例外就退回文字比對
  }
  return isLikedDesc(desc);
}

// point 有給的話（觸控事件觸發時）只處理「觸控點落在按鈕範圍內」的那顆，
// 不用檢查畫面上其他讚按鈕；point 是 null 時（備援輪詢）維持全部檢查。
function watchLikes(point) {
  var buttons = descMatches(/^(讚|Like|已按讚|取消讚|喜歡|已喜歡|取消喜歡|Liked|Unlike)$/).find();
  buttons.forEach(function (btn) {
    if (point && !boundsContainsPoint(btn.bounds(), point)) {
      return;
    }
    var key = btn.bounds().toShortString();
    var desc = btn.desc();
    var wasLiked = !!likedSeen[key];
    var nowLiked = isLiked(btn, desc);
    likedSeen[key] = nowLiked;
    if (!wasLiked && nowLiked) {
      log("偵測到新的按讚，座標 " + key + "（checked=" + (typeof btn.checked === "function" ? btn.checked() : "n/a") + "）");
      handleNewLike(btn);
    }
  });
}

// 不確定 Rect 物件是否有現成的 contains() 方法可用，自己手動比較邊界比較保險。
function boundsContainsPoint(b, point) {
  return point.x >= b.left && point.x <= b.right && point.y >= b.top && point.y <= b.bottom;
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

// 滑動時螢幕上常同時有兩篇貼文，抓內文如果掃整個畫面會把鄰篇的 hashtag 也
// 混進來，導致比對到錯的角色。從按鈕往上找貼文卡片本身：一直往上爬，
// 只要那層的高度還沒逼近整個螢幕高度，就當作還在同一張卡片內，繼續往上找
// 更完整的範圍；一旦某層高度已經接近整個螢幕（代表爬到整個列表容器、
// 已經涵蓋不只一篇貼文了），就停在「上一層」，不要用這層。
function findTweetContainer(anchorBtn) {
  var node = anchorBtn.parent();
  var candidate = node;
  for (var hops = 0; hops < 10 && node; hops++) {
    if (node.bounds().height > device.height * 0.75) {
      break;
    }
    candidate = node;
    node = node.parent();
  }
  return candidate;
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

  var container = findTweetContainer(shareBtn);
  var caption = (container ? container.find(className("android.widget.TextView")) : className("android.widget.TextView").find())
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
