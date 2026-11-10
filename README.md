# 喜餅上的那個 QR code

掃描 → 解開密碼鎖 → 開場字卡 → 十二張圖 → 過場 → 360° 影片（可以好幾段）→ 結尾卡。

純靜態網站，沒有任何建置步驟、沒有第三方函式庫。改完檔案 `git push`，網站就更新了。

---

## 檔案在哪

```
index.html                密碼鎖（QR code 指向這裡）
story.html                正片
assets/js/config.js       時間、開關、密碼鎖頁的文字與提示（公開）
assets/js/sealed.js       正片內容的加密版（自動產生，不要手改）
assets/js/unseal.js       用密碼解開 sealed.js
assets/js/lock.js         密碼滾輪
assets/js/story.js        正片流程
assets/js/pano.js         360° 播放器（自己寫的 WebGL，約 300 行）
assets/css/*.css          樣式
data/s/                   上線用的圖片（加密）與影片（亂數檔名），自動產生
data/audio/bgm.mp3        ← 背景音樂放這裡，可不放
tools/seal.js             加密工具
tools/serve.js            本機測試用的伺服器

── 以下只在你的電腦上，不會上傳 ──
private/secret.js         ★ 密碼和正片的所有內容（字卡、圖片清單、影片、字幕、結尾卡）
private/captions-draft.txt  字幕草稿
data/intro/001~012.jpg    十二張圖的原始檔
data/video/lake-1.mp4     影片原始檔，可以好幾段（見該資料夾的 README）
```

改時間、開關 → 動 `assets/js/config.js`。
改密碼、任何文案、圖片或影片 → 動 `private/secret.js`，**然後一定要跑**：

```bash
node tools/seal.js
```

它會重新加密，再把圖片和影片整理進 `data/s/`。沒跑的話網站上還是舊的內容。

> ⚠ **`private/` 只存在這台電腦上，請另外備份**（雲端硬碟之類）。
> 電腦壞了而沒有備份，網站上就只剩一堆解不開的密文。

---

## 上線之前一定要做的四件事

1. **設密碼** — `private/secret.js` 的 `password`。
2. **放影片** — 見 `data/video/README.md`（匯出設定與 ffmpeg 壓縮指令）。
3. **填結尾卡** — `private/secret.js` 的 `ending`：名字、日期、祝福留言表單連結。
4. **跑 `node tools/seal.js`**，然後才 commit / push。

---

## 部署到 GitHub Pages

```bash
git init
git add -A
git commit -m "喜餅 QR code 網頁"
git branch -M main
git remote add origin https://github.com/你的帳號/the-lock.git
git push -u origin main
```

推上去之後到 repo 的 **Settings → Pages**，Source 選 `Deploy from a branch`，
分支選 `main` / 根目錄 `/`，存檔。等一兩分鐘，網址是：

```
https://你的帳號.github.io/the-lock/
```

之後每次 `git push` 都會自動重新部署。

### QR code 印下去之前

QR 印在喜餅上就收不回來了，所以：

- **repo 名稱不能再改，帳號也不能刪** —— 網址是 `帳號.github.io/repo名/`，
  任何一段變了，QR 就死了
- QR 內容用 `https://你的帳號.github.io/the-lock/`（**結尾的斜線要留著**）
- 產生 QR 時容錯等級選 **H**，印在喜餅盒上有折痕或油漬也還掃得到
- 印刷尺寸至少 **2.5 公分見方**
- **先用三支不同手機掃過印刷樣張**再開印，別只在螢幕上測

---

## 自己在本機測試

```bash
node tools/serve.js
```

然後打開 <http://localhost:8080/>。

測試用的網址參數：

| 參數 | 作用 |
| --- | --- |
| `index.html?code=1234` | 預先填好滾輪的數字，省得每次手動轉 |
| `story.html?code=1234` | 用這組密碼直接進正片，跳過密碼鎖頁 |
| `story.html?dev=1` | 開放 console 除錯（`__pano.look()` 調角度）。在這台瀏覽器上解鎖過一次就能直接進 |

⚠ 解密用的是瀏覽器內建的 Web Crypto，它只在 `https://` 或 `localhost` 才能用。
用手機連電腦的區網 IP（`http://192.168.…`）測試的話，密碼鎖會顯示「這個瀏覽器打不開」，
這是正常的——上線到 GitHub Pages（https）就沒問題。

正片右下角有「跳過」，可以直接跳到影片那一段。

## 十二張圖的翻頁方式

預設是**輕觸畫面換下一張**，讀者自己控制節奏（滑鼠點、手指觸控、空白鍵、方向鍵都可以）。
每張圖停留一下之後，畫面下方會浮出「輕觸繼續」的小提示，最下緣有一條很細的進度線。

如果一直沒人動，時間到了還是會自己換 —— 這是保險，免得有人沒發現要點而卡在那裡。
在 `config.js` 的 `slides` 調整（每張的 `duration` 在 `private/secret.js`）：

| `advance` | 行為 |
| --- | --- |
| `'both'` | 點了立刻換，沒人點就等 `duration` 到自動換（**預設**） |
| `'tap'` | 只認手動，不點就一直停著 |
| `'auto'` | 只看時間，點畫面沒反應 |

每張圖的 `duration` 是「沒人點的時候最多停多久」。008、009 是整段獨白，預設留 15 秒。

## 影片可以放好幾段

`private/secret.js` 的 `video.clips` 是一個陣列，會照順序一支接一支自動播完，
段落之間有黑幕轉場（`video.clipGap` 調停留多久），畫面上緣會有像限時動態那樣的
分段進度條（`video.clipProgress` 可關）。

```js
clips: [
  {
    src: 'data/video/lake-1.mp4',
    startYaw: 0, startPitch: 0,      // 這一段一開始鏡頭朝哪（度）
    captions: [ { at: 1, dur: 4, text: '……', pos: 'bottom' } ],
  },
  {
    src: 'data/video/lake-2.mp4',
    startYaw: 90, startPitch: 0,
    captions: [ { at: 0.5, dur: 3, text: '……', pos: 'bottom' } ],
  },
],
```

每段的 `captions.at` 是**這支影片自己的秒數**，換到下一段會歸零重算，不是整體累加時間。
`dragHint`（拖曳提示）只在第一段出現一次，後面幾段不會重複提醒——使用者學過一次就夠了。

每段檔案獨立壓縮、獨立控制在 100MB 以下即可，見 `data/video/README.md` 的實測數字。

---

## 一些已經處理掉的坑

- **手機不讓影片自動出聲** — 開場那一下「輕觸開始」會順手解鎖影片與音訊；
  萬一還是被擋，會自動改成靜音播放並跳出一顆「輕觸開啟聲音」。
- **iOS 不能把影片 `display:none`** — 會停止解碼，所以全景模式下的 `<video>`
  是縮成 2px 藏著，不是隱藏。
- **網址列吃掉高度** — 用 JS 算實際高度寫進 `--vh`，不靠 `100vh`。
- **圖片有燒進去的字** — 用 `contain` 不裁切，背後補一層模糊放大的同一張圖填滿畫面。
- **沒有 WebGL 的裝置** — 360° 播放器會自動退回一般平面播放，不會白畫面。
- **影片還沒放進 repo** — 流程不會卡住，會直接跳到結尾卡。

## 密碼的安全性

目標是：**把網址貼給 AI，AI 也拿不到密碼或正片內容。**

- 網站上沒有密碼，也沒有密碼的雜湊。正片的文字、圖片清單、影片位置都用密碼加密
  （PBKDF2 + AES-GCM），密碼對不對就看解不解得開。
- 每試一次密碼都要跑一百萬輪 PBKDF2（`private/secret.js` 的 `iterations`）。
  輸入正確的人多等不到一秒；想把一萬種組合全試一遍，就得算上好一陣子。
- 十二張圖加密後才放上去（repo 是公開的，誰都能在 github.com 上瀏覽檔案）。
- 影片**沒有加密**，只換成亂數檔名——加密的影片得整支下載完才能播，手機撐不住。
  有心人在 GitHub 上翻得到影片檔，但裡面沒有密碼，也沒有結尾卡的文字。
- 以前的「挑戰模式」（告訴你猜對幾個）已經拿掉：它必須把密碼放在瀏覽器裡比對，
  等於把答案直接送給 AI。

**擋不住的部分**：

- 提示按鈕（`lock.hints`）目前是空的，刻意的。提示是公開的（解鎖前就要顯示），
  每多一條，要試的組合就少一截；想加回去之前先想清楚這一點。
- 有人把喜餅卡片拍照給 AI、請它陪著推理線索——這是正常解題，任何做法都擋不住。

沒有「直接放行」的按鈕。猜錯 `lock.helpAfter` 次之後會出現求救表單的連結。
