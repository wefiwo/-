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
// 運作方式（v3 重寫，見下面 v3 更新說明理由）：每 0.5 秒掃描一次目前畫面上
// 看得到的讚按鈕，看誰的狀態從「未按」變「已按」——不靠猜你手指點在螢幕
// 哪個座標。偵測到新的讚，自動觸發：先抓這篇貼文卡片範圍內的內文（避免
// 混到鄰篇）跟自動判斷 photo/video 類型 → 找同一排的分享按鈕 → 點分享 →
// 點複製連結 → 讀剪貼簿拿網址 → 把抓到的內文送給後端比對 hashtags.json
// （跟 likewatcher.user.js 同一套邏輯，後端自己判斷角色）。內文比對到
// 角色、媒體類型也判斷得出來的話就全自動結束；媒體類型判斷不出來才跳
// 對話框讓你手動選一次，內文沒比對到角色才跳對話框讓你手動補打角色名稱
// 重送一次，兩者互不相關、各自只在真的需要時才問。
//
// 已知限制／這是「先射箭再畫靶」的第一版，跟以前調 IG/FB 網頁版是同一套
// 流程——先讓你實際操作、把 log() 印出來的內容回報，再照實際文字調整：
//   - 讚按鈕的文字/描述（「讚」「已按讚」之類）、分享選單裡「複製連結」的
//     文字，都是用常見繁中/英文猜的，不保證跟你 X App 顯示的字一樣。
//   - 分享按鈕改成「讚按鈕同一排工具列（留言/轉發/讚/收藏/分享）裡最右邊
//     那顆可點擊元件」來定位，不再用文字比對找分享按鈕——實測發現用「分享」
//     這個字去找，畫面上不只一處符合，會抓錯，改抓位置比較準。
//   - 只做 X。IG/FB 原生 App 畫面結構、選單文字都不同，等 X 這條路先
//     跑通、抓到實際除錯方法後再比照擴充。
//
// v2 更新（照第一版實測錄影抓到的三個具體問題重寫，見各函式內註解）：
//   - 內文/媒體類型「點分享之前」就先抓好，不再等分享選單開了又關之後
//     才用舊的按鈕節點往上爬——這段期間畫面重新佈局，事後抓到的常常是
//     已經漂移過的內容（見下一條）。
//   - 容器邊界判斷實測會一次跨過不只一篇貼文：錄影裡看到同一次抓到的
//     「畫面文字」把三篇不同貼文的統計數字/作者名混在一起（剛好那次因為
//     目標貼文自己的 hashtag 還在混進來的文字裡，比對照樣成功，純粹運氣
//     好，換一篇可能就比對到鄰篇貼文的角色去）。改成「讚按鈕數量」和
//     「大頭貼數量」兩個訊號任一個先觸發就停止爬升，且爬升上限收緊，
//     同時內文優先直接讀容器節點自己的 contentDescription（X 為了螢幕
//     報讀本來就會在貼文卡片整體放一段完整描述，範圍天生就卡在單篇貼文，
//     比自己東拼西湊 TextView 準；讀不到才退回原本的「把容器內所有
//     TextView 文字串起來」）。
//   - 「類型」對話框原本每次都強制跳出，即使自動比對角色成功也要先手動
//     選 photo/video 才會送出，等於整條路徑其實從沒真正全自動過。改成
//     先看貼文有沒有時長徽章（"0:12" 這種 分:秒 格式短文字，或 GIF
//     徽章）判斷是不是影片，兩者都沒有但有圖才判斷是照片；真的兩者都
//     判斷不出來（理論上不該發生）才退回手動對話框當備援。
//   - `likedSeen` 原本純用按鈕螢幕座標當 key——但 RecyclerView 列表項目
//     本來就會回收、座標重複使用是常態，滑動幾下就可能讓「上一篇滑走的
//     貼文的已讚狀態」被誤當成「這篇貼文本來就已經按過」（或反過來，
//     漏判新讚）。改成每次全畫面輪詢時，用「這一輪畫面上實際還看得到的
//     按鈕」修剪掉已經不在畫面上的舊紀錄，把座標碰撞的時間窗縮小到單一
//     輪詢間隔內，不會整個 session 累積下去。
//   - 這一輪修改是照錄影裡實際觀察到的現象重寫的，不是靠新一輪的節點
//     結構 dump 精準定位——contentDescription 抓法、時長徽章判斷法能不能
//     完全對上你這版 X App 的實際畫面結構，還是要靠你實際跑一輪、把
//     log() 內容回報回來才能確認，抓不準的地方之後再照實測結果回頭調。
//
// v2.1 更新：BACKEND_URL/COLLECT_SECRET 改成存在本機、不寫死在檔案內容裡
//   （見下面 getBackendUrl()/getSecret() 的說明）——起因是拿新版腳本整份
//   覆蓋舊檔案這個操作本身完全沒問題，但這兩個值原本是寫死在腳本內容裡的
//   佔位字串，整份覆蓋會連同這兩個已經設定好的真實值一起蓋掉，變成要手動
//   搬回去才能用。「設定」按鈕加完當下點了沒反應，是浮動視窗 UI 執行緒裡
//   不能直接開阻塞對話框，補上 threads.start() 修掉。
//
// v2.2 更新：watchLikes() 原本用同一把鎖包住「檢查」跟「收集流程（點分享/
//   複製連結/可能跳對話框/打 API）」兩段，後者動輒好幾秒起跳，等於處理
//   上一個讚的時候，後面所有讚（就算是完全不同篇貼文）的偵測都會被卡住
//   等鎖——實測就是「第一次很順、之後常常要等快 10 秒才有反應」的成因。
//   拆成兩把鎖：watchLock 只保護「讀/改 likedSeen」這段極短的檢查動作，
//   收集流程改用另一把 collectLock，兩者職責分開，偵測不再被收集流程
//   拖慢。這個教訓在 v3 換了架構之後仍然適用，見 v3 說明。
//
// v2.3～v2.4（已被 v3 取代，留著紀錄走過的彎路）：這兩版想解決的都是同一件
//   事——「觸控座標 → 猜是哪顆讚按鈕」這個對應關係不可靠：v2.3 是螢幕座標
//   被不同貼文重複使用，讓真正的新讚判斷不出「有變化」、整個靜默；v2.4 是
//   放寬容錯半徑到 150px 想解決「精確落點對不準」，結果反而讓容錯直接抓到
//   隔壁貼文的讚按鈕，把內文/網址整個抓錯——比原本的「沒反應」更糟，因為
//   沒反應只是漏收集，抓錯是把錯的角色資料寫進收藏庫。兩版換來換去都在
//   「太緊會漏、太鬆會抓錯」之間打轉，因為問題出在「用觸控螢幕座標去猜
//   按鈕」這個做法本身有先天缺陷，不是半徑數字調得夠不夠準的問題。
//
// v3 更新（架構重寫，不再猜觸控座標）：改成定期直接掃描畫面上現有的讚
//   按鈕，看誰的 checked()/desc() 狀態從「未按」變「已按」——不靠任何
//   「這個觸控點對應哪顆按鈕」的猜測，直接問按鈕本身「你現在的狀態是
//   什麼」，天生不會有座標對不準或猜錯鄰篇的問題。輪詢頻率從原本當
//   「安全網」用的 3 秒收緊到 0.5 秒，人眼幾乎感覺不到延遲，也不再需要
//   events.onTouch()/觀察觸控這整條路線（整段拿掉）。
//   likedSeen 的 key 也一併換掉：不再用螢幕座標（會被不同貼文重複使用），
//   改用「這則貼文自己的內容」（tweetIdentity()，靠 findTweetContainer()
//   抓到的 contentDescription，抓不到才退回拼接文字）當身分——同一則貼文
//   不管捲到畫面上哪個位置，內容都一樣、算出來的身分也一樣；不同貼文
//   內容不同，天生不會撞 key，從根本上避開 v2.3/v2.4 那整類問題，不需要
//   再猜任何容錯半徑。
//   收集流程延續 v2.2 的教訓，改成每偵測到一個新讚就丟到獨立執行緒跑
//   （不再是「先收集完 forEach 裡的所有新讚才回到迴圈頂端」），這樣就算
//   某次收集卡住（等對話框、等後端回應），也不會拖累下一輪 0.5 秒的偵測；
//   collectLock 還是保留，讓實際操作畫面（點分享/開分享選單）這段互相
//   序列化，避免兩個讚同時搶著點分享按鈕互相干擾。v2.2 那把 watchLock
//   拿掉了：它原本是為了不讓觸控事件跟備援輪詢兩條獨立執行緒同時搶著讀寫
//   likedSeen，但 v3 已經沒有觸控事件那條路線，全部偵測都在同一個輪詢
//   迴圈的同一條執行緒裡循序做，不會有並行讀寫的問題，留著那把鎖反而是
//   保護一個已經不存在的競爭情境。
// ============================================================

// 注意：不要在檔案開頭加 "ui";——加了會讓這支腳本自己佔用一個空白 Activity，
// 之後點 AutoJs6 App 圖示會點到那個空白畫面而不是 AutoJs6 真正的主介面，
// 而且這支腳本用不到 ui 佈局模式（浮動視窗/對話框都不需要它）。

// ---- 設定：後端網址/密鑰 ----
// 跟 likewatcher.user.js 的 getBackendUrl()/getSecret() 同一招：存在本機
// （storages，AutoJs6 版的 GM_setValue/GM_getValue），不寫死在腳本內容裡。
// 第一次執行才會跳輸入框問一次，之後都記得住、重開腳本也不會忘；不管之後
// 拿新版檔案整份覆蓋幾次，都不會連帶把這兩個值蓋掉——換版本只要直接丟新
// 檔案上去執行就好，不用再手動把舊值搬回來。畫面上「設定」那顆懸浮按鈕
// 可以隨時重新設定（例如密鑰要換、後端網址搬家）。
var settings = storages.create("autojs_collect");

function getBackendUrl() {
  var saved = settings.get("backendUrl", "");
  if (saved) return saved;
  var entered = dialogs.rawInput("第一次設定：請貼上完整的 /collect 網址（例如 https://xxx.pythonanywhere.com/collect）", "");
  // 診斷用：萬一以後又發生「明明填了卻沒存住」，這行能直接看出輸入框
  // 當初實際收到的是什麼（null/取消、空字串、還是真的有值）。網址本身
  // 不是敏感資訊，直接印全文沒關係。
  log("getBackendUrl() 輸入框回傳：" + JSON.stringify(entered));
  var url = entered ? entered.trim().replace(/\/+$/, "") : "";
  if (url) settings.put("backendUrl", url);
  return url;
}

function getSecret() {
  var saved = settings.get("collectSecret", "");
  if (saved) return saved;
  var entered = dialogs.rawInput("第一次設定：請貼上你的 COLLECT_SECRET（跟 .env 裡的一致）", "");
  // 密鑰不能整串印出來，只記長度——0 代表輸入框回傳空的/被取消，
  // 有長度但後面還是讀不到值就代表 settings.put/get 本身有問題。
  log("getSecret() 輸入框回傳長度：" + (entered ? entered.length : 0));
  var secret = entered ? entered.trim() : "";
  if (secret) settings.put("collectSecret", secret);
  return secret;
}

var BACKEND_URL = getBackendUrl();
var COLLECT_SECRET = getSecret();

// 「設定」按鈕呼叫這兩個函式重新輸入，預填目前的值方便對照/微調，不用
// 每次都整串重打。用 var 宣告的 BACKEND_URL/COLLECT_SECRET 在整份腳本
// 同一個作用域，這裡直接重新賦值，其他函式（submitCollect 等）下次呼叫
// 就會讀到新值，不用重開腳本。
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

// 開了之後，收集成功會順便通知到 .env 裡設定的 Discord 頻道（後端既有的
// post_announcement 功能，跟 likewatcher.user.js 的公告開關是同一套邏輯）。
// 不用改程式碼，畫面上「公告」那顆懸浮按鈕點一下就能切換，狀態存在本機
// （storages），重開腳本也記得。預設關閉。
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
    <button id="config" text="設定" w="36" h="36" textSize="9sp"/>
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

// 「設定」按鈕：重新設定後端網址/密鑰用，跟 likewatcher.user.js 選單裡的
// 「重新設定後端網址」「重新設定 COLLECT_SECRET」是同一件事，AutoJs6 沒有
// 瀏覽器分頁那種選單列可以掛，改成浮動按鈕 + 選單對話框達成一樣的效果。
// 浮動視窗的 click 回呼本身跑在 UI 執行緒上，直接在裡面呼叫會阻塞等待的
// dialogs.select()/dialogs.rawInput() 很容易讓對話框跳出來又立刻消失、
// 完全沒反應（實測就是這樣）——跟下面「抓」按鈕同一個道理，都要包一層
// threads.start() 丟到背景執行緒才能正常顯示、等待輸入。
window.config.click(function () {
  threads.start(function () {
    try {
      var idx = dialogs.select("重新設定", ["後端網址（含 /collect）", "COLLECT_SECRET"]);
      if (idx === 0) reconfigureBackendUrl();
      else if (idx === 1) reconfigureSecret();
    } catch (e) {
      log("重新設定發生錯誤：" + e);
      toastLog("重新設定出錯：" + e);
    }
  });
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

// ---- 自動偵測按讚：定期直接掃描讚按鈕狀態，不猜觸控座標 ----
// 不再監聽 events.onTouch()——原本靠「觸控點座標」去猜是哪顆按鈕，這個
// 對應關係在 RecyclerView 列表（座標被不同貼文重複使用）跟緊湊版面
// （容錯半徑一放寬就跨到隔壁貼文）這兩種情況下都不可靠，見檔案開頭 v3
// 更新的說明。改成每 POLL_MS 直接問畫面上每一顆讚按鈕「你現在的狀態是
// 什麼」，用內容身分（tweetIdentity()）記住「上次看到的狀態」，跟座標
// 完全無關。
var likedSeen = {}; // key: 貼文內容身分（tweetIdentity()），value: 上次看到是不是已按讚（boolean）

var POLL_MS = 500; // 人眼幾乎感覺不到延遲；如果覺得吃電/頓，可以調高
threads.start(function () {
  while (true) {
    sleep(POLL_MS);
    try {
      if (currentPackage() === "com.twitter.android") {
        watchLikes();
      }
    } catch (e) {
      log("輪詢偵測出錯：" + e);
      toastLog("輪詢偵測出錯：" + e);
    }
  }
});

// 讚按鈕的文字/描述模式，全檔共用同一份，不要各處各寫一次猜測的文字。
var LIKE_BUTTON_PATTERN = /^(讚|Like|已按讚|取消讚|喜歡|已喜歡|取消喜歡|Liked|Unlike)$/;

function isLikedDesc(desc) {
  return /已按讚|取消讚|已喜歡|取消喜歡|Liked|Unlike/.test(desc || "");
}

// 判斷「已按讚」優先看 checked() 這個狀態旗標（無障礙服務裡對應網頁版空心/
// 實心愛心切換的語意屬性，不受文字翻譯影響），旗標讀不到時才退回文字比對
// 當備援——這也是之前「讚」vs「喜歡」翻譯不一致會漏判的根本解法。
function isLiked(btn, desc) {
  var checkedState = false;
  try {
    if (typeof btn.checked === "function") {
      checkedState = btn.checked();
    }
  } catch (e) {
    // 有些節點沒有 checked 這個屬性，忽略即可，靠下面的文字比對
  }
  // 兩個都檢查、任一個判斷是「已按讚」就算數——之前只信 checked()、
  // checked() 存在但永遠回傳 false 的話會蓋掉本來就有效的文字比對，
  // 導致整個偵測完全沒反應（實測就是這樣壞掉的）。
  return checkedState || isLikedDesc(desc);
}

// 收集流程（操作畫面：點分享/開分享選單/複製連結）用的鎖——這段要序列化，
// 不然兩個讚同時各自點分享按鈕，畫面會互相干擾。watchLikes() 每偵測到一個
// 新讚，就丟到自己的獨立執行緒去跑收集流程（見下面），多個執行緒可能同時
// 想進來跑收集，這把鎖讓它們排隊、一次只有一個真的在操作畫面；沒在等這把
// 鎖的下一輪輪詢（watchLikes() 本身）完全不受影響，繼續每 POLL_MS 檢查一次，
// 不會被卡住的收集流程拖慢（沿用 v2.2 學到的教訓：偵測跟收集是兩件事，
// 一個慢不能拖累另一個快）。
var collectLock = threads.lock();

function runCollectLocked(btn) {
  collectLock.lock();
  try {
    handleNewLike(btn);
  } finally {
    collectLock.unlock();
  }
}

// 這則貼文的「內容身分」，取代原本用螢幕座標當 likedSeen 的 key——螢幕
// 座標會被 RecyclerView 回收、不同貼文重複使用，內容不會。優先用容器節點
// 自己的 contentDescription（findTweetContainer()/extractCaption() 已經
// 在用的同一份東西，這裡再呼叫一次省得另外傳遞，多一點點運算量換來身分
// 跟座標完全無關，值得）；抓不到才退回拼接文字，一樣是內容而不是座標，
// 只是不像 contentDescription 那麼精確。真的完全抓不到內容（理論上不該
// 發生）就回傳 null，呼叫端會直接跳過這顆按鈕、留到下一輪輪詢再試，不會
// 因為算不出身分就誤觸發或誤判。
function tweetIdentity(btn) {
  var container = findTweetContainer(btn);
  if (!container) return null;
  var desc = container.desc();
  if (desc && desc.length > 5) return "d:" + desc;
  var texts = container.find(className("android.widget.TextView"))
    .map(function (n) { return n.text(); })
    .filter(Boolean)
    .join("|");
  return texts ? "t:" + texts : null;
}

// 主要偵測機制：每 POLL_MS 直接掃一次畫面上現有的讚按鈕，用 tweetIdentity()
// 記住的「上次看到的狀態」比對出誰的狀態從「未按」變「已按」——不靠猜觸控
// 座標對應哪顆按鈕，見檔案開頭 v3 更新的說明。
function watchLikes() {
  var buttons = descMatches(LIKE_BUTTON_PATTERN).find();
  var currentIds = {};
  buttons.forEach(function (btn) {
    var id = tweetIdentity(btn);
    if (!id) return; // 這一輪算不出身分，跳過，下一輪再試
    currentIds[id] = true;
    var wasLiked = !!likedSeen[id];
    var nowLiked = isLiked(btn, btn.desc());
    likedSeen[id] = nowLiked;
    if (!wasLiked && nowLiked) {
      log("偵測到新的按讚：" + id.slice(0, 40) + "…（checked=" + (typeof btn.checked === "function" ? btn.checked() : "n/a") + "）");
      // 收集流程丟到獨立執行緒跑，不要卡在這個 forEach 裡——不然這一輪
      // 偵測要等收集流程跑完（可能好幾秒、可能還在等你選類型/打角色）
      // 才能回到迴圈頂端繼續下一輪 POLL_MS，等於偵測被收集流程拖慢，
      // 重蹈 v2.2 的覆轍。
      threads.start(function () {
        try {
          runCollectLocked(btn);
        } catch (e) {
          log("收集流程發生錯誤：" + e);
          toastLog("收集流程出錯：" + e);
        }
      });
    }
  });
  // 這一輪畫面上已經看不到的貼文，把牠的舊紀錄清掉——內容身分本來就不會
  // 跨貼文碰撞，這裡純粹是避免 likedSeen 隨著捲動無限長大，不是為了修正
  // 座標碰撞（那個問題在新設計下已經不存在了）。
  Object.keys(likedSeen).forEach(function (id) {
    if (!currentIds[id]) delete likedSeen[id];
  });
}

function handleNewLike(likeBtn) {
  var shareBtn = findShareButtonNearLike(likeBtn);
  if (!shareBtn) {
    toastLog("按讚偵測到了，但找不到同排最右邊的分享按鈕，回報目前畫面 log");
    logVisibleDescs();
    return;
  }
  // likeBtn 一路傳進去當內文/媒體類型的錨點——分享鍵只用來點分享選單，
  // 不再拿它去爬容器（見 runShareFlow 開頭的說明）。
  runShareFlow(likeBtn, shareBtn, "剛剛按讚的貼文");
}

// 手動備用按鈕：畫面上隨便找一個讚按鈕，用同一套「同排最右邊」邏輯定位分享鍵
// （適合你人工點開單篇貼文詳細頁再按）。
function collectFromShareFlow() {
  var likeBtn = descMatches(LIKE_BUTTON_PATTERN).findOne(2000);
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
  runShareFlow(likeBtn, shareBtn, "目前畫面的貼文");
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
// 混進來，導致比對到錯的角色。原本只看「這層範圍內出現不只一個讚按鈕」
// 一個訊號，實測會一次爬過頭、跨進兩三篇貼文都沒觸發（X 的畫面結構每爬
// 一層父層涵蓋的範圍常常不是線性放大，可能一口氣就跳過中間該停的那層）。
// 改成「讚按鈕數量」跟「大頭貼數量」兩個訊號任一個先偵測到「這層不只一篇
// 貼文」就停，且把爬升上限從 10 收緊到 6——就算兩個訊號都沒觸發，最壞情況
// 混進來的內容範圍也比較小。
function countAvatarsInside(node) {
  var images = node.find(className("android.widget.ImageView"));
  var count = 0;
  images.forEach(function (img) {
    var b = img.bounds();
    var w = b.width(), h = b.height();
    // 大頭貼是正方形小圖示，用長寬幾乎相等 + 大小合理來篩，排除版面裡
    // 其他細長條/超小的裝飾用 ImageView。
    if (w > 20 && Math.abs(w - h) < 10) {
      count++;
    }
  });
  return count;
}

function findTweetContainer(likeBtn) {
  var node = likeBtn.parent();
  var candidate = node;
  for (var hops = 0; hops < 6 && node; hops++) {
    var likeButtonsInside = node.find(descMatches(LIKE_BUTTON_PATTERN));
    if (likeButtonsInside.length > 1 || countAvatarsInside(node) > 1) {
      break; // 這層已經跨到不只一篇貼文，用上一層（candidate）就好
    }
    candidate = node;
    node = node.parent();
  }
  return candidate;
}

// 內文抓取：優先看容器節點自己有沒有現成的 contentDescription——X 為了
// 螢幕報讀，通常會在貼文卡片整體那層節點放一段完整描述（作者、內文、
// 統計數字全部串好），範圍天生就卡在單篇貼文，比自己爬子節點拼湊準得多，
// 也不會漏抓因捲動被裁切、需要另外展開的內容。讀不到（沒設定/太短，
// 太短代表可能抓到的是別的無關節點而不是整篇卡片）才退回舊做法：把容器
// 內所有 TextView 文字串起來——這個退路仍然可能混進邊界誤判的內容，只是
// findTweetContainer 已經盡量把邊界收緊了。
function extractCaption(container) {
  if (!container) return "";
  var ownDesc = container.desc();
  if (ownDesc && ownDesc.length > 15) {
    return ownDesc;
  }
  return container.find(className("android.widget.TextView"))
    .map(function (n) { return n.text(); })
    .filter(Boolean)
    .join(" / ");
}

// 影片/照片自動判斷：媒體縮圖上，影片一定會疊一個時長徽章（"0:12" 這種
// 分:秒 格式的短文字）或 GIF 徽章，照片不會有——這是介面本來就要給人看的
// 資訊，比找 VideoView/ExoPlayer 這類自訂 View 的 class 名稱穩定（各版本
// X App 常常換播放器元件、class 名稱不保證一樣）。兩種徽章都沒有、但容器
// 裡至少找得到一張圖就當照片；連圖都找不到（理論上不該發生，能走到這裡
// 代表已經偵測到讚，貼文應該都帶媒體）才回傳 null，讓呼叫端退回手動對話框。
function detectMediaType(container) {
  if (!container) return null;
  var texts = container.find(className("android.widget.TextView")).map(function (n) { return n.text(); });
  if (texts.some(function (t) { return /^\d{1,2}:\d{2}$/.test(t) || /^GIF$/i.test(t); })) {
    return "video";
  }
  var descs = container.find(className("android.view.View")).map(function (n) { return n.desc(); }).filter(Boolean);
  if (descs.some(function (d) { return /播放|^Play$|Video|影片/i.test(d); })) {
    return "video";
  }
  if (container.find(className("android.widget.ImageView")).length > 0) {
    return "photo";
  }
  return null;
}

// 共用：先抓內文/媒體類型 → 點分享 → 複製連結 → 讀剪貼簿 → 送出。
// 內文跟媒體類型特意搬到「點分享之前」抓——分享選單開了又關這段期間
// （點擊+動畫+複製連結，加起來將近 2 秒）畫面很容易重新佈局，事後才用
// 按鈕節點往上爬，抓到的常常已經是漂移過的內容，不如在按讚當下、畫面
// 還沒被分享選單打斷之前就先抓好。
// 主控台預設就是隱藏的（見檔案開頭 console.hide()），這裡不用特別處理顯示/
// 隱藏——想看過程 log 就長按浮動按鈕切換，不想看就讓它一直藏著。
function runShareFlow(likeBtn, shareBtn, hint) {
  // BACKEND_URL/COLLECT_SECRET 沒設定好的話（第一次執行的輸入框被取消、
  // 或送出時是空字串——這兩種情況都不會存進 storages，見 getBackendUrl()/
  // getSecret()），不要先把整段點分享/複製連結/跳對話框都跑完才在最後
  // submitCollect() 打 http.postJson 時才炸掉——實測炸出來的是
  // "Invalid URL host: \"\"" 這種看不懂在講什麼的例外。一開始就先擋掉，
  // 不執行任何畫面操作。
  if (!BACKEND_URL || !COLLECT_SECRET) {
    toastLog("尚未設定後端網址/密鑰，點「設定」按鈕填一下再試");
    return;
  }

  var container = findTweetContainer(likeBtn);
  var caption = extractCaption(container);
  log("畫面文字（抓內文用，供你對照調整）：\n" + caption);
  var mediaType = detectMediaType(container);
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

  // 自動判斷不出媒體類型，才在這裡才跳對話框當備援——不是每次都問。
  if (!mediaType) {
    var typeIndex = dialogs.select("類型（自動判斷不出來，手動選一下）", ["photo", "video"]);
    if (typeIndex === -1) { toastLog("已取消"); return; }
    mediaType = typeIndex === 0 ? "photo" : "video";
  }

  // 先把抓到的畫面文字整包當 text 送出，跟瀏覽器版 likewatcher.user.js 一樣，
  // 交給後端自己比對 hashtags.json——比對得到的話全自動，不用手動打角色。
  var result = submitCollect(url, mediaType, caption);
  if (result.addedTo.length > 0) {
    toastLog("自動比對成功，已加入：" + result.addedTo.join("、"));
    return;
  }

  // 畫面文字沒比對到任何角色，才手動補打一次。
  toastLog("畫面文字沒比對到角色，手動輸入");
  var character = pickCharacterViaAutocomplete(hint);
  if (!character) { toastLog("已取消"); return; }
  var result2 = submitCollect(url, mediaType, "#" + character);
  if (result2.addedTo.length > 0) {
    toastLog("已加入：" + result2.addedTo.join("、"));
  } else {
    toastLog("還是沒比對到，狀態碼 " + result2.statusCode + "，回報 log 對一下 hashtags.json 裡的名字");
  }
}

// 打同音字/部分字 → 打 /autocomplete 拿候選角色清單 → 多筆就跳選單點選。
// 跟 Discord /抓圖 指令的自動完成是同一支後端 API（GET /autocomplete?q=），
// 不用自己重寫拼音/注音比對邏輯。做不成邊打字邊即時更新（AutoJs6 的輸入
// 對話框沒有那種即時 callback），改成「打完 → 查 → 選」兩步驟，結果一樣
// 是選單點選，只是不是每個字都即時反應。
function pickCharacterViaAutocomplete(hint) {
  var query = dialogs.rawInput("角色名稱（" + hint + "，可打同音字）", "");
  if (!query) return null;

  var matches = [];
  try {
    var autocompleteUrl = BACKEND_URL.replace(/\/collect$/, "/autocomplete") + "?q=" + encodeURIComponent(query);
    var res = http.get(autocompleteUrl);
    matches = JSON.parse(res.body.string());
  } catch (e) {
    log("查詢 /autocomplete 失敗：" + e);
  }

  if (matches.length === 0) {
    toastLog("沒查到符合的角色候選，直接用你打的字");
    return query;
  }
  if (matches.length === 1) {
    return matches[0];
  }
  var idx = dialogs.select("選角色", matches);
  return idx === -1 ? null : matches[idx];
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
