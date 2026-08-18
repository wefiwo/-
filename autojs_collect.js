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
// 觸發：找同一排的分享按鈕 → 點分享 → 點複製連結 → 讀剪貼簿拿網址 → 跳出
// 對話框讓你打角色名稱/選類型 → 送到 /collect。
//
// 已知限制／這是「先射箭再畫靶」的第一版，跟以前調 IG/FB 網頁版是同一套
// 流程——先讓你實際操作、把 log() 印出來的內容回報，再照實際文字調整：
//   - 讚按鈕的文字/描述（「讚」「已按讚」之類）、分享選單裡「複製連結」的
//     文字，都是用常見繁中/英文猜的，不保證跟你 X App 顯示的字一樣。
//   - 「分享按鈕跟讚按鈕在同一排」這個畫面結構也是猜的。
//   - 內文（caption）目前是把整個畫面看得到的文字全部串起來，很粗糙。
//   - 只做 X。IG/FB 原生 App 畫面結構、選單文字都不同，等 X 這條路先
//     跑通、抓到實際除錯方法後再比照擴充。
//   - 在快速滑動的時間軸上同時有好幾個讚按鈕在畫面上時，用「按鈕在螢幕
//     上的座標」當識別依據，滑動換頁後座標重複使用可能誤判，目前沒有
//     更精準的做法（原生 App 沒有 URL 這種穩定 ID 可以拿來認貼文）。
// ============================================================

"ui";

// ---- 設定：改成你自己的值 ----
var BACKEND_URL = "https://BoboboboB.pythonanywhere.com/collect";
var COLLECT_SECRET = "填入你 .env 裡 COLLECT_SECRET 的值";
var POLL_MS = 700;

auto.waitFor(); // 沒開無障礙服務會先跳出授權畫面，開完才會繼續往下跑

// 手動按鈕當備用觸發：自動偵測失敗時，人工點目前畫面上「最後一個看到的貼文」。
var window = floaty.window(
  <frame gravity="right|center_vertical">
    <button id="collect" text="抓" w="70" h="70" style="Widget.AppCompat.Button.Colored"/>
  </frame>
);
window.setPosition(-10, 400);
window.collect.click(function () {
  threads.start(function () { collectFromShareFlow(); });
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
  return /已按讚|取消讚|Liked|Unlike/.test(desc || "");
}

function watchLikes() {
  var buttons = descMatches(/^(讚|Like|已按讚|取消讚|Liked|Unlike)$/).find();
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
  // 分享按鈕通常跟讚按鈕擠在同一排工具列（同一個父層容器）裡，往上找
  // 幾層父層，在裡面找分享按鈕。抓不到就是這個結構猜錯，回報 log。
  var shareBtn = null;
  var node = likeBtn.parent();
  for (var hops = 0; hops < 4 && node && !shareBtn; hops++) {
    shareBtn = node.findOne(descMatches(/^(分享|Share)$/));
    node = node.parent();
  }
  if (!shareBtn) {
    toastLog("按讚偵測到了，但找不到同排的分享按鈕，回報目前畫面 log");
    logVisibleDescs();
    return;
  }
  runShareFlow(shareBtn, "剛剛按讚的貼文");
}

// 手動備用按鈕：畫面上隨便找一個分享按鈕（適合你人工點開單篇貼文詳細頁再按）。
function collectFromShareFlow() {
  var shareBtn = descContains("分享").findOne(2000) || descContains("Share").findOne(2000);
  if (!shareBtn) {
    toastLog("找不到分享按鈕，回報目前畫面 log");
    logVisibleDescs();
    return;
  }
  runShareFlow(shareBtn, "目前畫面的貼文");
}

// 共用：點分享 → 複製連結 → 讀剪貼簿 → 跳出確認對話框 → 送出。
function runShareFlow(shareBtn, hint) {
  shareBtn.click();
  sleep(1000);

  var copyLink = textContains("複製連結").findOne(3000) || textContains("Copy link").findOne(3000)
    || descContains("複製連結").findOne(3000) || descContains("Copy link").findOne(3000);
  if (!copyLink) {
    toastLog("分享選單裡找不到「複製連結」，回報目前畫面 log");
    logVisibleDescs();
    back();
    return;
  }
  copyLink.click();
  sleep(500);

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

  var character = dialogs.rawInput("角色名稱（" + hint + "）", "");
  if (!character) { toastLog("已取消"); return; }
  var typeIndex = dialogs.select("類型", ["photo", "video"]);
  if (typeIndex === -1) { toastLog("已取消"); return; }
  var mediaType = typeIndex === 0 ? "photo" : "video";

  var res = http.postJson(BACKEND_URL, {
    url: url,
    type: mediaType,
    text: "#" + character,
  }, {
    headers: { "X-Collect-Secret": COLLECT_SECRET },
  });
  toastLog("送出結果，狀態碼：" + res.statusCode);
  log(res.statusCode + " " + res.body.string());
}

function logVisibleDescs() {
  var descs = className("android.view.View").find()
    .map(function (n) { return n.desc(); }).filter(Boolean);
  var texts = className("android.widget.TextView").find()
    .map(function (n) { return n.text(); }).filter(Boolean);
  log("目前畫面上的 desc：\n" + descs.join("\n"));
  log("目前畫面上的文字：\n" + texts.join("\n"));
}
