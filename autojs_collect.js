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
//
// v3.1 更新：v3 上線後實測抓到兩個問題，都是新架構自己的問題（不是猜座標
//   那類）：
//   (1) 腳本剛啟動時 likedSeen 是空的，畫面上任何本來就已經讚過的貼文，
//       第一輪輪詢會被誤判成「從未讚變已讚」直接觸發，明明沒點任何東西
//       卻跑出偵測。加上 isFirstPoll：第一輪只記錄目前狀態當基準值，不
//       觸發收集，之後的輪詢才開始真的比對「有沒有變化」。
//   (2) 同一則貼文被重複收集兩次：tweetIdentity() 抓不到 contentDescription
//       時會退回拼接 TextView 文字，但這個拼接結果裡混進了讚數/留言數/
//       瀏覽數這些統計數字——按讚這個動作本身就會讓讚數改變，於是「這則
//       貼文」下一輪算出來的身分字串就變了（因為數字不一樣了），系統認不
//       出是同一則、又重新觸發一次。加上 stripVolatileStats()，兩條身分
//       計算路徑（contentDescription 跟拼接文字）都先濾掉純數字片段
//       （可能帶千分位逗號/萬/K 這類單位）再拿去當身分，只留真正描述貼文
//       內容的文字。
//
// v3.2 更新：v3.1 上線後還是實測到 tweetIdentity() 持續算不出身分（同一行
//   診斷 log 短時間內連續印好幾次，「跳針」），加上同一則貼文仍會被重複
//   收集。追出來是 findTweetContainer() 用的 countAvatarsInside() 這個
//   「大頭貼數量」訊號，判斷門檻（w > 20px）太寬鬆——工具列裡留言/轉發/
//   讚/收藏/分享這些正方形小圖示也會被算進去，導致從讚按鈕往上爬的第一層
//   （工具列本身）就先觸發「這層不只一篇貼文」的誤判，容器直接停在最外層
//   還沒真正往上爬，窄到連內文都沒包進去——這其實是從 v2 就存在的舊 bug，
//   只是以前的後果只是內文抓得比較差、還能退回手動輸入補救，v3 拿容器算
//   身分之後，容器一旦窄到沒有文字，tweetIdentity() 就直接回傳 null、
//   永遠不會被追蹤，這才把問題暴露出來。門檻收緊到 80px，各種螢幕密度下
//   都遠大於一般工具列圖示，但仍在合理大頭貼尺寸範圍內。
//
// v3.3 更新：v3.2 那個門檻修正之後，findTweetContainer() 靠爬父節點層數
//   猜邊界這個做法本身還是有殘留風險——v2~v3.2 這幾輪的教訓是，不管拿
//   「讚按鈕數量」還是「大頭貼數量」當停止訊號，門檻/邏輯調得再準，終究
//   是在猜「爬幾層才對」，不是真的知道這則貼文的範圍在哪裡。改成用「兩則
//   貼文之間那條分隔線」的概念——但分隔線本身很可能是畫在畫布上、不是
//   真正的無障礙節點，直接找線本身不可靠，改用「大頭貼的垂直位置」當
//   替身：每則貼文開頭一定有自己的大頭貼，大頭貼跟大頭貼之間的垂直區間
//   就是這則貼文的真正範圍（findTweetBounds()）。extractCaption()/
//   detectMediaType()/tweetIdentity() 現在都改成「只看這個垂直範圍內」的
//   節點，不管容器爬到第幾層——findTweetContainer() 還留著，但只用來
//   取得容器節點的 contentDescription 當「加分項」，而且要跟 bounds 交叉
//   驗證吻合才會採用，不吻合就退回 bounds 過濾的做法，不會再單靠爬層數
//   決定邊界。
//
// v3.4 更新：findTweetBounds() 的下界原本是「往下找最近的一顆大頭貼（下
//   一則貼文的）」，但下一則貼文得先真的渲染出來才找得到，而且會把兩則
//   貼文之間的留白、甚至夾在中間的廣告貼文都算進來。改成更精確的做法：
//   讚按鈕本身就在讚/轉發那排工具列裡，Y 座標直接就有，不用另外找下一則
//   貼文——下界直接用讚按鈕自己的上緣，工具列那排（含工具列本身、下面的
//   統計列、以及再更下面的下一則貼文）一律不看，只看「大頭貼到工具列
//   之間」這一段。
//
// v3.5 更新：v3.4 把 bounds 下界收緊到工具列上緣之後，extractCaption()/
//   tweetIdentity() 裡「爬容器節點拿 contentDescription 當加分項、跟 bounds
//   交叉驗證」那段邏輯就變成陪襯了——容器爬出來的範圍幾乎必定比收緊後的
//   bounds 寬（通常整個包含工具列、統計列），交叉驗證的吻合檢查因此幾乎
//   永遠不會過，等於每 0.5 秒、每顆讚按鈕都白白爬一次容器樹卻沒用上結果。
//   整段拿掉，連同只有這兩個呼叫端在用的 findTweetContainer()/
//   countAvatarsInside() 一起刪除——現在完全靠 findTweetBounds() 決定範圍，
//   不再有任何「爬父節點層數猜邊界」的路徑殘留在程式碼裡。
//
// v3.6 更新：加上 processedUrls，保證同一篇貼文這次執行最多真正跑完一次
//   收集流程。tweetIdentity() 終究是從畫面內容猜出來的貼文身分，前面幾輪
//   反覆出現的「跳針」「重複收集」都是這個身分在某些邊界情況下算歪造成
//   的——不管再怎麼修，只要身分還是用猜的，就沒辦法 100% 排除這類情況再
//   發生。網址不一樣：是點分享、複製連結拿到的真實資料，不是猜的。改成
//   一抓到網址，先查這個網址這次執行有沒有處理過，處理過就直接跳過、
//   不再重跑後面的比對/手動輸入這些步驟——不管前面 likedSeen 的判斷準
//   不準，網址這一關保證同一篇貼文最多真正跑完一次。只存在記憶體裡、
//   跟著這次執行的生命週期，不用存到 storages——後端 /collect 本來就會
//   用網址去重，跨執行階段的資料重複早就有伺服器那邊擋著，這裡要防的是
//   同一次執行內白白把分享選單、手動輸入對話框又跑一次的浪費。
//
// v3.7 更新：實測抓到 findTweetBounds() 仍會把別篇貼文的內容當成目標貼文
//   （例如螢幕上同時看得到兩篇貼文，點了上面那篇「Suoming｜鎖暝」的讚，
//   結果抓到的卻是下面那篇的內容，導致比對/送出整個沒反應）。根因是 v3.4
//   留下的已知風險——那則貼文自己的大頭貼一旦被捲出螢幕外找不到，上界會
//   退回 0，等於「這則貼文的範圍」直接從螢幕最頂端算起，把螢幕上還看得到
//   的其他貼文（不管在目標貼文上面還是下面，只要 Y 座標算出來落在 0～這顆
//   讚按鈕之間）全部一起吃進去，抓內文/判斷身分自然抓到別篇去。
//   加兩道修正：
//   (1) 大頭貼比對門檻從「Y 中心 <= 讚按鈕 Y 中心」收緊成「Y 頂端 < 讚按鈕
//       自己的 Y 頂端」——嚴格小於、且比的是讚按鈕整排的頂端而不是中心點，
//       消除「大頭貼跟讚按鈕同高」這種邊界模糊地帶，把「大頭貼一定要在讚
//       那一排上面」這條規則直接寫死成寫死的比較條件，不是猜出來的門檻。
//   (2) 新增第二道獨立防線：findTweetBounds() 現在會拿到「這一輪畫面上
//       全部讚按鈕」的清單，用「往上找最近的另一顆讚按鈕，取它的下緣」
//       再收緊一次上界——螢幕由上而下線性排列，每則貼文只有一顆讚按鈕，
//       所以「上一顆讚按鈕的下緣」到「這一顆讚按鈕的頂端」之間，最多只夾
//       得下一則貼文的內容，這是版面順序保證的事實、不是猜測。就算這則
//       貼文自己的大頭貼真的被捲出螢幕外（規則 1 退回 0），這道防線也會
//       把上界重新收緊到「上一篇貼文結束的地方」，不會再往上多吃到別篇
//       貼文的內容——兩道規則各自算出一個候選上界，取比較靠近讚按鈕（比較
//       大）的那個生效。
//
// v3.8 更新：實測回報「滑好幾篇貼文、按了好幾個讚都完全沒反應，連 log
//   都是空的，但手動點一下『設定』浮動按鈕（跳出系統對話框）就瞬間恢復
//   正常」——滑動/點讚本身也是觸控卻沒用，只有「跳出新視窗」這個動作有效，
//   研判是 AutoJs6 底層查無障礙節點的機制，在畫面一直停留同一個視窗（X
//   App 內部單純捲動，沒有真正的視窗異動）太久沒收到視窗事件時會卡住
//   查不到東西。加上定期「保活戳一下」：每 KEEPALIVE_MS 借用主控台視窗
//   （console.show()/console.hide()）開一下立刻關掉，製造跟跳出設定對話框
//   類似的視窗異動事件，不用你手動點按鈕。這是照這次實測回報推出的
//   workaround，底層原因沒有進一步查證，效果要靠實機測試確認。
//
// v3.9 更新：實測抓到引用貼文（quote tweet）會一直跳針——螢幕截圖顯示，
//   引用卡片裡顯示被引用貼文自己的互動數字（❤️180），這個「讚」字說明
//   本身也會被 LIKE_BUTTON_PATTERN 比對到，混進 descMatches() 抓到的清單
//   裡，但它只是唯讀的統計顯示，不是真的能點的讚按鈕——這顆多出來的節點
//   讓 tweetIdentity() 在「真讚按鈕」跟「引用卡片的唯讀讚數」之間跳來跳去
//   算出不同身分，就是跳針的根因之一。加上 .clickable() 篩掉這種唯讀節點
//   （抽成共用的 findLikeButtons()，watchLikes()、collectFromShareFlow()
//   都改用它，不要各寫一次篩選邏輯）。
//   另外照使用者的要求，把觸發條件改嚴：改成「這則貼文的文字要先比對到
//   hashtags.json 裡任何角色的關鍵字，而且剛好是這次按讚才觸發」，不再是
//   只要按讚狀態有變化就一律觸發整套分享/複製連結/送出流程——隨手滑動時
//   按到的、跟收藏完全無關的一般貼文，以前會整套跑一次（跑不出結果就跳
//   手動輸入角色名稱的對話框），現在直接跳過，連 log 都不會印。跟
//   likewatcher.user.js 的 loadHashtags()/matchedCharacters() 同一套邏輯、
//   同一支後端 API（GET /hashtags）。這個關鍵字比對只影響「自動偵測」要
//   不要觸發，手動「抓」按鈕（collectFromShareFlow()）不受影響，仍然是
//   「不管有沒有比對到關鍵字，你人工按了就一定跑」，維持原本手動備援的
//   彈性。
//
// v3.10 更新：v3.9 那次跳針，使用者後續補了第二張加註截圖，把真正的成因
//   釐清了——不是引用卡片的唯讀讚數（那個是另一顆算不出身分、無傷大雅的
//   節點，v3.9 的 .clickable() 篩選對它仍然有效，留著），是 findTweetBounds()
//   本身選大頭貼的方向選反了。這則貼文（しらいとShira 引用 Cy 原推文附上
//   自己的作品，讚按鈕在畫面最下面）範圍內其實有兩顆大頭貼：這則貼文自己
//   的（在最上面，緊接在上一則貼文結束的地方）跟被引用貼文（Cy）那張嵌入
//   卡片自己的（比較靠近讚按鈕，因為嵌入卡片夾在「這則貼文自己的內容」跟
//   「這則貼文自己的讚按鈕」之間）。v3.7～v3.9 的規則 1 是「取離讚按鈕最近
//   的那顆大頭貼」，這剛好選到嵌入卡片的（錯的），把這則貼文自己的作者
//   名/內文整段排除在範圍外——使用者兩張截圖分別框出「黃色：我要的（這則
//   貼文自己的圖+讚按鈕）」跟「藍綠色：一直重複抓到的（嵌入卡片裡 Cy 的
//   內容）」，直接證實了這個方向錯誤。
//   改成「取範圍內離讚按鈕最遠（Y 最小、最上面）的那顆大頭貼」，範圍下限
//   維持用 v3.7 那道「上一顆讚按鈕的下緣」防線頂住——這則貼文自己的大頭貼
//   一定緊接在上一則貼文結束處之後、且一定畫在任何嵌入卡片的大頭貼之前
//   （由上而下渲染，外層一定先畫），取「最上面」才會選到正確的那顆，不會
//   再被嵌入卡片的大頭貼卡住。
//
// v3.11 更新：v3.10 上線後實測回報「完全用不了」，重新從頭檢查全部功能，
//   認為 v3.9 新加的兩個「沒有實機證據支持、失敗時會靜默擋住整個功能」的
//   假設最可疑，兩個都改成安全的失敗模式：
//   (1) findLikeButtons() 的 .clickable() 篩選拿掉——當初理由是濾掉引用
//       卡片裡唯讀的互動數字，但從沒證實「真正的讚按鈕節點本身一定是
//       clickable()」，萬一這個假設是錯的，會把所有真正的讚按鈕都濾掉，
//       跟「完全用不了」的症狀完全吻合。v3.10 已經用「範圍內取最上面的
//       大頭貼」從根本解決跳針的真正成因，不再需要這個篩選當防線。
//   (2) textMatchesAnyHashtag() 讀不到 hashtags 對照表（HASHTAGS_CACHE 是
//       null）時，v3.9 是回傳 false（當作沒比對到），代表 /hashtags 一旦
//       讀取失敗，自動偵測會整個靜默失效、沒有任何提示。改成讀不到就直接
//       放行（回傳 true），寧可暫時退回「每篇讚都觸發」這個已知能動的
//       行為，也不要讓一個新加的過濾條件在失敗時把整個功能悄悄關掉——
//       真的讀到對照表之後才會真的按關鍵字過濾，之後補上網路、下次輪詢
//       就會自動恢復，不用重開腳本。
//
// v3.12 更新：v3.11 上線後回報「其他功能正常，但還是需要點『設』才能正常
//   使用」——代表 v3.8 那個「保活戳一下」workaround 從一開始就沒有真的
//   生效。回頭檢討：console.show()/console.hide() 很可能只是切換一個
//   「腳本一開始就已經建立好」的疊加視窗的顯示/隱藏狀態，不是真的向系統
//   視窗管理員新增/移除一個視窗，沒有真的複製到「設定」跳出系統對話框
//   有效的那個機制（貨真價實的 WindowManager 層級新增）。改用
//   floaty.rawWindow() 開一個 1x1、移到螢幕外的空視窗，戳一下就關掉——
//   跟「抓/公告/設定」那三顆按鈕同一種機制，是真正的視窗新增/移除，理論
//   上才會產生對等的視窗異動訊號，且完全不會被看到。這仍然是實測推出的
//   workaround，效果要靠實機測試確認；如果這次還是沒用，代表連「視窗
//   新增/移除」本身都不是真正原因，要往別的方向查。
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

// 這一輪跑腳本期間，已經真正跑到「抓到網址」這一步的貼文網址——不管後面
// 是自動比對成功、手動輸入成功、手動取消、還是比對失敗，都算「這篇貼文
// 這次執行已經處理過了」，不要因為 likedSeen 誤判（內容身分算歪、跳針
// 之類）又重新跑一次整個分享/比對/手動輸入流程。網址是複製連結拿到的
// 真實資料，不是猜的，用它當最後一道防線，保證同一篇貼文這次執行最多
// 真正跑完一次收集流程。只在記憶體裡、跟著這次腳本執行的生命週期，不用
// 存到 storages——後端 /collect 本來就會用網址去重，跨執行階段的重複
// 早就有伺服器那邊擋著，這裡要防的是「同一次執行內，白白把分享選單、
// 手動輸入對話框又跑一次」這種浪費，不是資料庫裡真的多一筆。
var processedUrls = {};

var POLL_MS = 500; // 人眼幾乎感覺不到延遲；如果覺得吃電/頓，可以調高

// ---- 保活戳一下（v3.8 實測 workaround）----
// 實測回報：滑 X 動態頁面、連續按了好幾篇讚，watchLikes() 完全沒反應、
// 連一行 log 都沒印（不是排隊等 collectLock，是真的整輪偵測空轉——會印
// log 的地方，像「偵測到新的按讚」，是真的抓到讚按鈕狀態變化才會印，這裡
// 連這個都沒有，代表 descMatches()/className() 這類全域查詢那一輪根本沒
// 查到任何節點）；但只要手動點一下「設定」浮動按鈕（跳出系統對話框），
// 「瞬間」就恢復正常。滑動、點讚這些操作本身也是觸控，卻不會觸發恢復——
// 代表不是「螢幕太久沒被摸到、CPU 被系統降頻」這類單純的觸控喚醒問題，
// 真正有效的是「跳出一個新的系統視窗」這個動作本身（無障礙服務會收到
// 視窗異動的通知）。X App 內部單純捲動同一個頁面不會觸發這種視窗異動
// 事件，久了 AutoJs6 底層用來查節點的機制好像就會卡住、查不到東西，直到
// 真的有新視窗出現才會恢復。
//
// v3.8 當初改成每 KEEPALIVE_MS 借用主控台視窗（console.show()/console.hide()）
// 開一下立刻關掉，理論是「這個動作也是疊加視窗的出現/消失，效果應該跟
// 跳出設定對話框一樣」——但 v3.11 上線後實測回報「還是需要點設才能正常
// 使用」，代表這個理論站不住腳。回頭想，console.show()/console.hide() 很
// 可能只是切換一個「腳本一開始就已經建立好」的疊加視窗的顯示/隱藏狀態
// （View 的可見度），不是真的向系統視窗管理員（WindowManager）新增/移除
// 一個視窗——「設定」按鈕跳出的是貨真價實的系統 AlertDialog，一定會觸發
// WindowManager 層級的新增，這兩者不是同一件事，console 這招從一開始就
// 沒有真的複製到「設定」有效的那個機制。
//
// 改成用 floaty 開一個 1x1、完全移到螢幕外看不到的空視窗，戳一下就馬上
// 關掉（pokeKeepalive()）——這是跟「抓/公告/設定」那三顆按鈕同一種
// floaty.rawWindow() 機制，是真正的視窗新增/移除，理論上才會產生跟跳出
// 對話框一樣的視窗異動訊號，而且因為完全沒有內容、又移到螢幕外，不會被
// 看到、不會打斷你操作。
//
// 這仍然是照實測回報推出的 workaround，不是查到 AutoJs6 官方文件記載的
// 行為，真正的底層原因（無障礙節點查詢快取久了會卡住）沒有進一步查證。
// 如果這次還是要點「設定」才會恢復，代表連「視窗新增/移除」這個機制本身
// 都不是真正原因，要往別的方向查（例如直接在 pokeKeepalive() 前後加 log
// 比對，或者乾脆放棄自動戳、保留手動點「設定」當已知能用的備援）。
var KEEPALIVE_MS = 15000;
var lastKeepaliveAt = new Date().getTime();

function pokeKeepalive() {
  try {
    var poke = floaty.rawWindow(<frame w="1" h="1"/>);
    poke.setPosition(-200, -200);
    sleep(50);
    poke.close();
  } catch (e) {
    log("保活戳一下失敗：" + e);
  }
}

threads.start(function () {
  while (true) {
    sleep(POLL_MS);
    try {
      if (currentPackage() === "com.twitter.android") {
        watchLikes();
        var now = new Date().getTime();
        if (now - lastKeepaliveAt >= KEEPALIVE_MS) {
          lastKeepaliveAt = now;
          pokeKeepalive();
        }
      }
    } catch (e) {
      log("輪詢偵測出錯：" + e);
      toastLog("輪詢偵測出錯：" + e);
    }
  }
});

// 讚按鈕的文字/描述模式，全檔共用同一份，不要各處各寫一次猜測的文字。
var LIKE_BUTTON_PATTERN = /^(讚|Like|已按讚|取消讚|喜歡|已喜歡|取消喜歡|Liked|Unlike)$/;

// 找畫面上目前的讚按鈕——單純用文字/描述比對（LIKE_BUTTON_PATTERN），
// watchLikes()、collectFromShareFlow() 都改用這個共用函式，不要各寫一次。
//
// v3.9 曾經在這裡加過 .clickable() 篩選，理由是「引用卡片裡唯讀的互動
// 數字（❤️180）也會被 LIKE_BUTTON_PATTERN 比對到，篩掉非真正可點擊的
// 讚按鈕」——但這只是推測，沒有實機證據證明「真正的讚按鈕節點本身（不是
// 外層容器）一定是 clickable()」，v3.10 上線後實測回報「完全用不了」，
// 高度懷疑就是這個篩選條件剛好把真正的讚按鈕也濾掉了（Android 常見
// pattern：可點擊範圍在外層容器，內層節點本身不一定算 clickable）。
// 拿掉這個篩選——v3.10 已經改用「取範圍內最上面的大頭貼」從根本解決跳針
// 的真正成因，不再依賴這裡濾掉唯讀節點；而且唯讀的互動數字顯示本來就不
// 會帶「已按讚/取消讚」這類明確措辭（isLikedDesc() 認的是這個），單純
// 混進 buttons 清單頂多讓 tweetIdentity() 偶爾算不出身分、印一行無傷大雅
// 的診斷 log，不會真的誤觸發收集。用「拿掉一個沒證據支持、風險是讓核心
// 偵測整個失效」換「保留一個從未證實必要、頂多多印幾行 log」的權衡，值得。
function findLikeButtons() {
  return descMatches(LIKE_BUTTON_PATTERN).find();
}

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

function runCollectLocked(btn, allLikeButtons) {
  collectLock.lock();
  try {
    handleNewLike(btn, allLikeButtons);
  } finally {
    collectLock.unlock();
  }
}

// 讚數/轉推數/留言數/瀏覽數這些統計數字不能算進身分字串裡——按讚這個
// 動作本身就會讓讚數改變（例如 45→46），如果數字被算進身分，同一則貼文
// 光是「被按讚」這個動作，下一輪輪詢算出來的身分字串就會變成不同的字串
// （因為讚數變了），系統認不出「這是同一則貼文」，會當成一則全新貼文、
// 現在剛好是已讚狀態，又重新觸發一次——實測就是這樣重複收集同一則貼文
// 兩次的成因。用正則把「純數字（可能帶千分位逗號/小數點/萬/K 這類單位）」
// 的片段整個拿掉，只留下真正描述貼文內容的文字。用 \b 開頭確保不會誤傷
// 「C108」這種數字前面緊接著字母的識別碼（字母跟數字之間沒有單字邊界，
// 不會被這個正則命中）。
function stripVolatileStats(s) {
  return s.replace(/\b\d[\d,]*(\.\d+)?\s*(萬|万|K|k)?\b/g, "");
}

// ---- 關鍵字對照表：自動偵測要「先比對到關鍵字才觸發」用（見下面
// textMatchesAnyHashtag()）----
// 跟 likewatcher.user.js 的 loadHashtags()/matchedCharacters() 同一套邏輯、
// 同一支後端 API（GET /hashtags，跟 /collect 同一個 base，不用另外設定）——
// 不重新發明一套比對規則，維持跟 Discord /抓圖、瀏覽器版收集腳本三邊一致。
// X 不用像 FB 一定要帶 #（那是 likewatcher.user.js 特有的規則，這裡只做
// X），loose 比對：關鍵字只要以子字串形式出現在文字裡就算數。
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
loadHashtags(); // 開機先拉一次快取起來，watchLikes() 每次輪詢都要用，不要每次都重打一次 API

// 這段文字有沒有比對到 hashtags.json 裡任何一個角色的任何一個關鍵字——
// 只回傳有沒有比對到，不需要知道比對到哪個角色，那是後端 submitCollect()
// 自己重比對一次的事（這裡的比對結果只用來決定要不要觸發，不會影響最後
// 送出的角色判斷）。
//
// 讀不到對照表（HASHTAGS_CACHE 是 null，例如開機當下網路還沒連上、
// BACKEND_URL 格式跟預期的不一樣）不能直接當「沒比對到」处理——v3.9 是
// 這樣寫的，結果讀取一旦失敗，自動偵測就整個靜默失效、沒有任何提示，
// 使用者只會看到「完全用不了」，猜不到是這裡在擋。改成讀不到就直接放行
// （回傳 true，觸發整套流程，退回 v3.9 之前的行為：跑不出結果就跳手動
// 輸入角色對話框）——寧可暫時退回「每篇讚都觸發」這個已知能動的行為，
// 也不要讓一個新加的過濾條件在讀取失敗時把整個功能悄悄關掉。真的讀到
// 對照表之後，這關才會真的按關鍵字過濾。每次呼叫都會嘗試重新載入（見
// loadHashtags() 開頭的快取判斷），所以之後補上網路、下次輪詢就會自動
// 恢復用關鍵字過濾，不用重開腳本。
function textMatchesAnyHashtag(text) {
  var tags = loadHashtags();
  if (!tags) return true;
  // 中文輸入法常把 # 自動轉全形「＃」，跟 likewatcher.user.js 一樣先正規化掉。
  var lower = (text || "").replace(/＃/g, "#").toLowerCase();
  return Object.keys(tags).some(function (name) {
    if (name.indexOf("_") === 0) return false; // hashtags.json 用 _ 開頭的 key 當註解，不是角色
    var list = tags[name] || [];
    return list.some(function (h) { return lower.indexOf(String(h).toLowerCase()) !== -1; });
  });
}

// 這則貼文的「內容身分」，取代原本用螢幕座標當 likedSeen 的 key——螢幕
// 座標會被 RecyclerView 回收、不同貼文重複使用，內容不會。直接拿「這則
// 貼文垂直範圍內」（findTweetBounds()）的 TextView 拼接文字，過
// stripVolatileStats() 濾掉統計數字。
//
// 原本這裡會先試著爬容器節點拿 contentDescription 當「加分項」，但
// findTweetBounds() 的下界改成卡在工具列上緣之後（v3.4），容器爬出來的
// 範圍幾乎必定比這個更寬（通常整個包含工具列、統計列），交叉驗證的吻合
// 檢查因此幾乎永遠不會過——等於每 0.5 秒、每顆讚按鈕都白白爬一次容器樹
// 卻沒用上結果。拿掉這段純浪費效能的嘗試，直接用 bounds 過濾。理論上這則
// 貼文自己一定會有一些文字（至少作者名），真的完全抓不到才回傳 null，
// 呼叫端會直接跳過這顆按鈕、留到下一輪輪詢再試。
function tweetIdentity(btn, allLikeButtons) {
  var bounds = findTweetBounds(btn, allLikeButtons);
  var texts = className("android.widget.TextView").find()
    .filter(function (n) { return nodeInBounds(n, bounds); })
    .map(function (n) { return n.text(); })
    .filter(Boolean)
    .join("|");
  texts = stripVolatileStats(texts);
  return texts ? "t:" + texts : null;
}

// 主要偵測機制：每 POLL_MS 直接掃一次畫面上現有的讚按鈕，用 tweetIdentity()
// 記住的「上次看到的狀態」比對出誰的狀態從「未按」變「已按」——不靠猜觸控
// 座標對應哪顆按鈕，見檔案開頭 v3 更新的說明。
//
// isFirstPoll：腳本剛啟動時 likedSeen 是空的，這時畫面上任何「本來就已經
// 讚過」的貼文都會被誤判成「從未讚變已讚」直接觸發——實測就是這樣一開始
// 就跳出偵測，但根本沒點任何東西。第一輪輪詢改成只「記錄」目前看到的狀態
// 當基準值，不觸發任何收集，之後才開始真的比對「有沒有變化」。
var isFirstPoll = true;

function watchLikes() {
  var buttons = findLikeButtons();
  var currentIds = {};
  buttons.forEach(function (btn) {
    var id = tweetIdentity(btn, buttons);
    if (!id) {
      // 算不出身分代表這顆按鈕永遠不會被追蹤到——如果它剛好又是已讚狀態，
      // 就會變成「點了讚、但這顆按鈕從頭到尾沒被記錄過，也就永遠不會被
      // 判斷成『有變化』」，實測對應的症狀就是點了半天完全沒反應，連
      // 找不到分享按鈕之類的錯誤都不會有，因為根本沒進到後面那段邏輯。
      // 這種情況理論上不該發生（有讚按鈕的地方通常找得到夠長的內文），
      // 一旦真的發生就留一筆 log，不要繼續整個靜默下去。
      if (isLiked(btn, btn.desc())) {
        log("讚按鈕算不出內容身分（tweetIdentity 回傳 null），這顆會被跳過、永遠不會觸發收集，回報這行 log 給開發者");
      }
      return; // 這一輪算不出身分，跳過，下一輪再試
    }
    currentIds[id] = true;
    var wasLiked = !!likedSeen[id];
    var nowLiked = isLiked(btn, btn.desc());
    likedSeen[id] = nowLiked;
    if (!isFirstPoll && !wasLiked && nowLiked) {
      // 先比對這則貼文的文字有沒有對到 hashtags.json 裡任何角色的關鍵字，
      // 對不到就直接跳過，不觸發整套分享/複製連結/送出流程——之前是「只要
      // 按讚狀態有變化就一律觸發」，隨手滑動按到的引用貼文、跟收藏完全
      // 無關的一般貼文，也會整套跑一次（跑不出結果就跳手動輸入角色名稱
      // 的對話框，或者像引用貼文那樣邊界算不準、反覆判斷成「新的讚」，
      // 一直跳針洗 log）。likedSeen[id] 上面已經記過這輪是已讚狀態了，
      // 之後同一個 id 不會再被判斷成「有變化」，這裡跳過不會讓同一則貼文
      // 每輪都重新比對一次關鍵字。
      var bounds = findTweetBounds(btn, buttons);
      var quickText = extractCaption(bounds);
      if (!textMatchesAnyHashtag(quickText)) {
        return;
      }
      log("偵測到新的按讚，且對到關鍵字：" + id.slice(0, 40) + "…（checked=" + (typeof btn.checked === "function" ? btn.checked() : "n/a") + "）");
      // 收集流程丟到獨立執行緒跑，不要卡在這個 forEach 裡——不然這一輪
      // 偵測要等收集流程跑完（可能好幾秒、可能還在等你選類型/打角色）
      // 才能回到迴圈頂端繼續下一輪 POLL_MS，等於偵測被收集流程拖慢，
      // 重蹈 v2.2 的覆轍。
      threads.start(function () {
        try {
          runCollectLocked(btn, buttons);
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
  isFirstPoll = false;
}

function handleNewLike(likeBtn, allLikeButtons) {
  var shareBtn = findShareButtonNearLike(likeBtn);
  if (!shareBtn) {
    toastLog("按讚偵測到了，但找不到同排最右邊的分享按鈕，回報目前畫面 log");
    logVisibleDescs();
    return;
  }
  // likeBtn 一路傳進去當內文/媒體類型的錨點——分享鍵只用來點分享選單，
  // 不再拿它去爬容器（見 runShareFlow 開頭的說明）。allLikeButtons 一路
  // 傳進去給 findTweetBounds() 當第二道防線用（見 v3.7 更新說明）。
  runShareFlow(likeBtn, shareBtn, "剛剛按讚的貼文", allLikeButtons);
}

// 手動備用按鈕：畫面上隨便找一個讚按鈕，用同一套「同排最右邊」邏輯定位分享鍵
// （適合你人工點開單篇貼文詳細頁再按）。跟自動偵測路徑一樣，順手把畫面上
// 目前看得到的「全部」讚按鈕一起抓下來，給 findTweetBounds() 的第二道防線用
// ——手動這條路徑同樣可能發生螢幕上同時有兩篇貼文的情況，不應該少一層保護。
function collectFromShareFlow() {
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
  runShareFlow(likeBtn, shareBtn, "目前畫面的貼文", allLikeButtons);
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

// 判斷一顆 ImageView 是不是「大頭貼尺寸」——正方形、夠大，門檻要夠高
// 才不會把工具列裡留言/轉發/讚/收藏/分享這些正方形小圖示（通常 18~24dp，
// 換算成 px 也遠小於大頭貼常見的 40dp+）也算進去。給 findAvatarNodes()
// （下面「兩則貼文之間的範圍」用的地標）用。
function isAvatarSized(b) {
  var w = b.width(), h = b.height();
  return w > 80 && Math.abs(w - h) < 15;
}

// 兩則貼文之間那條分隔線，很可能是 RecyclerView 用 ItemDecoration 直接
// 畫在畫布上、不是真正的無障礙節點——無障礙服務讀不到畫布上直接畫的東西，
// 沒辦法直接去找那條線本身。改用「大頭貼」的垂直位置當替身：每則貼文
// 開頭一定有一顆自己的大頭貼，大頭貼跟大頭貼之間的垂直區間，實際上就是
// 「上下兩則貼文之間」的範圍，效果等同於用分隔線抓範圍，但用的是保證
// 找得到的真實節點。
function findAvatarNodes() {
  return className("android.widget.ImageView").find().filter(function (img) {
    return isAvatarSized(img.bounds());
  });
}

// 這則貼文的垂直範圍：起點是大頭貼，終點是讚/轉發那排工具列——不用去猜
// 「下一則貼文的大頭貼在哪」（原本的做法，得等下一則貼文真的有渲染出來
// 才找得到，而且會把兩則貼文之間的留白、甚至夾在中間的廣告也算進來）。
// 讚按鈕本身就在工具列那排裡，Y 座標直接就有，不用另外找：上界是讚按鈕
// 所在 Y 座標往上找最近的一顆大頭貼（這則貼文自己的），下界直接就是
// 讚按鈕自己的上緣——工具列那排（含工具列本身、下面的讚數/轉推數/瀏覽數
// 統計列、以及再更下面的下一則貼文）一律不看，只看「大頭貼到工具列之間」
// 這一段，也就是作者名、內文、hashtag、媒體縮圖這些東西。
//
// allLikeButtons（v3.7 新增）：這一輪輪詢當下，畫面上看得到的「全部」讚
// 按鈕（不只是這顆）——用來當第二道獨立防線，見下面規則 2 的說明跟檔案
// 開頭 v3.7 更新的完整理由。呼叫端沒有這份清單（例如舊路徑手動觸發）就傳
// undefined，這道防線自動跳過，退回只靠規則 1，不會整個炸掉。
function findTweetBounds(likeBtn, allLikeButtons) {
  var likeTop = likeBtn.bounds().top;

  // 下限（floor）：往上找最近的「另一顆讚按鈕」，取它的下緣。畫面由上而下
  // 線性排列，每則最外層貼文只有一顆讚按鈕，所以「上一顆讚按鈕的下緣」就是
  // 上一則貼文結束的地方——這則貼文的內容不可能比這個更早開始，這是版面
  // 順序保證的事實，不是猜測。找不到（沒有上一顆讚按鈕，例如這則貼文剛好
  // 是畫面上第一則）就用 0。
  var floor = 0;
  (allLikeButtons || []).forEach(function (otherBtn) {
    if (otherBtn === likeBtn) return;
    var otherBottom = otherBtn.bounds().bottom;
    if (otherBottom < likeTop && otherBottom > floor) floor = otherBottom;
  });

  // 這則貼文自己的大頭貼：在 [floor, likeTop) 這個範圍內，取「Y 最小、也就
  // 是最上面」的那一顆——不是最靠近讚按鈕的那一顆（v3.7～v3.9 是這樣選的，
  // 實測抓到反例才改過來）。實測抓到：引用貼文（quote tweet）在這個範圍內
  // 會出現兩顆大頭貼——這則貼文自己的（在最上面，緊接在上一則貼文的讚
  // 按鈕之後）跟被引用貼文那張嵌入卡片自己的（比較靠近這則貼文的讚按鈕，
  // 因為嵌入卡片本來就夾在「這則貼文自己的內容」跟「這則貼文自己的讚
  // 按鈕」之間）。取「最靠近讚按鈕」的那顆，會抓到嵌入卡片的大頭貼，把
  // 這則貼文自己的作者名/內文整段排除在範圍外——這是實測抓到的跳針
  // 成因：範圍被嵌入卡片的大頭貼卡住，變成只看得到「被引用貼文的內容」，
  // 完全看不到這則貼文自己的東西。改成取「最上面」的那一顆，才是這則
  // （最外層）貼文真正自己的大頭貼——嵌入卡片是這則貼文內容的一部分，
  // 一定畫在這則貼文自己的大頭貼之後（畫面由上而下渲染，外層一定先畫），
  // 不會比它更早出現。找不到大頭貼（這則貼文剛好在畫面最上面，大頭貼被
  // 捲出螢幕外）就退回 floor——floor 由上面的規則保證，不會比 0 更寬鬆，
  // 不會往上多吃到別篇貼文的內容。
  var top = -1;
  findAvatarNodes().forEach(function (img) {
    var ay = img.bounds().top;
    if (ay >= floor && ay < likeTop && (top === -1 || ay < top)) top = ay;
  });
  if (top === -1) top = floor;

  return { top: top, bottom: likeTop };
}

// 節點的垂直中心點有沒有落在這則貼文自己的範圍內——不管容器節點往上爬
// 爬到哪一層，直接用畫面上的實際位置篩選，真正做到「只看上下兩則貼文
// 之間的內容」。
function nodeInBounds(node, bounds) {
  var b = node.bounds();
  var centerY = (b.top + b.bottom) / 2;
  return centerY >= bounds.top && centerY < bounds.bottom;
}

// 內文抓取：只抓「這則貼文垂直範圍內」（findTweetBounds()）的 TextView
// 文字串起來——不管節點在容器樹裡爬到第幾層，直接用畫面上的實際位置
// 篩選，真正做到只看上下兩則貼文之間的內容，不會混進鄰篇。
//
// 原本這裡會先試著爬容器節點拿 contentDescription（比自己拼湊 TextView
// 準、也不會漏抓因捲動被裁切的內容），但跟 tweetIdentity() 一樣的理由
// （見那邊的說明）：findTweetBounds() 的下界卡在工具列上緣之後，容器爬
// 出來的範圍幾乎必定比這個寬，交叉驗證幾乎永遠不會過，拿掉這段純浪費
// 效能的嘗試。
function extractCaption(bounds) {
  return className("android.widget.TextView").find()
    .filter(function (n) { return nodeInBounds(n, bounds); })
    .map(function (n) { return n.text(); })
    .filter(Boolean)
    .join(" / ");
}

// 影片/照片自動判斷：媒體縮圖上，影片一定會疊一個時長徽章（"0:12" 這種
// 分:秒 格式的短文字）或 GIF 徽章，照片不會有——這是介面本來就要給人看的
// 資訊，比找 VideoView/ExoPlayer 這類自訂 View 的 class 名稱穩定（各版本
// X App 常常換播放器元件、class 名稱不保證一樣）。只在這則貼文自己的
// 垂直範圍內找，不會被鄰篇貼文的縮圖/徽章干擾。兩種徽章都沒有、但範圍
// 裡至少找得到一張圖就當照片；連圖都找不到（理論上不該發生，能走到這裡
// 代表已經偵測到讚，貼文應該都帶媒體）才回傳 null，讓呼叫端退回手動對話框。
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

// 共用：先抓內文/媒體類型 → 點分享 → 複製連結 → 讀剪貼簿 → 送出。
// 內文跟媒體類型特意搬到「點分享之前」抓——分享選單開了又關這段期間
// （點擊+動畫+複製連結，加起來將近 2 秒）畫面很容易重新佈局，事後才用
// 按鈕節點往上爬，抓到的常常已經是漂移過的內容，不如在按讚當下、畫面
// 還沒被分享選單打斷之前就先抓好。
// 主控台預設就是隱藏的（見檔案開頭 console.hide()），這裡不用特別處理顯示/
// 隱藏——想看過程 log 就長按浮動按鈕切換，不想看就讓它一直藏著。
function runShareFlow(likeBtn, shareBtn, hint, allLikeButtons) {
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

  // 網址是複製連結拿到的真實資料，不是猜的——不管前面的偵測/身分判斷有
  // 沒有誤觸發，只要這個網址這次執行已經處理過，直接在這裡擋下來，不要
  // 再把後面的比對/手動輸入對話框整套跑一次。這是保證「同一篇貼文最多
  // 真正收集一次」的最後一道防線，也是唯一真正可靠的一道——前面的
  // tweetIdentity() 終究是從畫面內容猜出來的，可能因為各種邊界情況（見
  // 檔案開頭 v3.3 之後的說明）誤判成不同貼文，網址不會。
  if (processedUrls[url]) {
    toastLog("這篇貼文這次執行已經處理過了，跳過");
    return;
  }
  processedUrls[url] = true;

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
