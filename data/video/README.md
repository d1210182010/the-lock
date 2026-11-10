# 影片放這裡

網頁支援一支接一支自動播放好幾段影片。每段剪好、壓好之後放進這個資料夾，
命名成 `lake-1.mp4`、`lake-2.mp4`……，再到 `private/secret.js` 的 `video.clips`
把每一段的檔名和字幕填進去，最後跑一次 `node tools/seal.js`（見主 README）。

## 從 Insta360 匯出

用 Insta360 Studio 開啟原始檔 → 匯出時：

- 匯出格式選 **360°（等距長方投影 / equirectangular）**，**不要**用「重新取景 / Reframe」輸出成平面影片
- 尺寸選 **3840 × 1920**（2:1 的比例很重要，不是 16:9）
- 編碼 **H.264**（不要用 H.265/HEVC，部分 Android 瀏覽器解不動）
- 長度建議 **30 ～ 60 秒**

## 再壓一次，塞進 100MB 以內

GitHub 單一檔案上限 100MB，而且 GitHub Pages 不支援 Git LFS。
原始檔通常是 HEVC（H.265），**Chrome 和 Firefox 播不出來**，所以一定要轉成 H.264。

```bash
ffmpeg -y -ss 起點秒數 -t 長度秒數 -i 原始檔.mp4 \
  -c:v libx264 -preset slow -crf 32 -profile:v high -level 5.1 \
  -vf "scale=3840:1920:in_range=full:out_range=tv,format=yuv420p" -color_range tv \
  -movflags +faststart -c:a aac -b:a 128k \
  data/video/lake-1.mp4
```

`-ss` 是起點、`-t` 是長度（都是秒）。例如剪 1:35～2:35：`-ss 95 -t 60`。

### CRF 是什麼

CRF（Constant Rate Factor）是「畫質要維持多好」的旋鈕，不是直接設定檔案大小。
數字愈小畫質愈好、檔案愈大；數字愈大畫質愈差、檔案愈小。範圍 0～51，
我們這裡用 30～32 已經算壓得蠻兇。它是逐畫面自動調位元率的，所以**同樣的 CRF，
內容愈複雜（愈多晃動、愈多細節）檔案就愈大**——不能只看設定值精準預測大小，
下面的實測數字只能當參考範圍。

### 實測數字（本專案素材）

30 秒／60 秒是常見的段落長度，用本專案兩段實際素材測出的範圍：

| 段落內容 | 3840×1920 CRF 32，每 60 秒 |
| --- | --- |
| 較平靜的畫面 | 約 64 MB |
| 動態較多的畫面 | 約 77 MB |

30 秒的段落大約是這個數字的一半，**35～45 MB** 是合理預期，多放幾段完全沒問題
（GitHub 單檔上限 100MB，這樣的段落離門檻還很遠）。

其他解析度／CRF 組合的比較：

| 設定 | 每 60 秒 | 視野內橫向解析度 |
| --- | --- | --- |
| 3840×1920 CRF 26 | 148 MB | ~853px |
| 3840×1920 CRF 30 | 85～102 MB | ~853px |
| **3840×1920 CRF 32** | **64～77 MB** | **~853px** |
| 3840×1920 CRF 34 | 46 MB | ~853px |
| 2880×1440 CRF 26 | 89 MB | ~640px |
| 2560×1280 CRF 26 | 73～89 MB | ~569px |

### 兩個容易踩錯的地方

**不要縮解析度，要調 CRF。** `3840 CRF32`（64MB）比 `2880 CRF26`（89MB）**又小又清楚**。
360 影片一次只看到球面的約五分之一，角解析度直接決定清晰度，
丟掉像素的代價遠大於調高 CRF。維持 3840 寬，用 CRF 控大小。

**降 fps 沒有用。** 30fps → 24fps 在同樣 CRF 下只省 5%，不值得犧牲流暢度。

### 調整方向

- 還是太大 → `-crf` 調高（34、36），或**把片段剪短**（最有效）
- 畫質不夠 → `-crf` 調低（30、28），但檔案會長得很快
- `-movflags +faststart` 一定要留著，影片才能邊下載邊播
- `in_range=full:out_range=tv` 也要留著，Insta360 匯出的是 full range，
  不轉換的話瀏覽器裡的顏色會偏掉

壓完檢查大小和編碼：

```bash
ffprobe -v error -show_entries format=duration,size,bit_rate -show_entries stream=codec_name,width,height data/video/lake-1.mp4
```

## 檔案不會進版控

`.gitignore` 忽略 `data/video/` 底下所有影片，這裡的檔案永遠不會被推上去。
真正上線的是 `node tools/seal.js` 複製到 `data/s/` 的亂數檔名副本，
跑完 seal 之後正常 `git add -A` 就會一起加進去，不需要 `-f`。
