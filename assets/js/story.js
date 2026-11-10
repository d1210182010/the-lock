/* 正片流程控制：載入 → 字卡 → 十二張圖 → 過場 → 影片 → 結尾 */
(function () {
  'use strict';

  var C = window.CONFIG;
  var $ = function (id) { return document.getElementById(id); };
  var qs = new URLSearchParams(location.search);

  /* ── 用密碼解開正片內容，解不開（沒解過謎的人）就請回去解 ──
   * 密碼從密碼鎖那頁存的 localStorage 拿；無痕模式存不了的話，會跟著網址帶過來。
   * 解開的內容（字卡文字、圖片清單、影片、結尾卡）合併進 CONFIG 的同名區塊。 */
  async function unlock() {
    var code = qs.get('code');
    if (!code) {
      try { code = localStorage.getItem('married:code'); } catch (e) { code = null; }
    }
    var content = null;
    if (code) {
      try { content = await window.unseal(code); } catch (e) { content = null; }
    }
    if (!content) { location.replace('index.html'); return false; }
    Object.keys(content).forEach(function (k) {
      C[k] = Object.assign(C[k] || {}, content[k]);
    });
    return true;
  }

  /* ── 行動瀏覽器高度 ── */
  function fixVh() {
    document.documentElement.style.setProperty('--vh', window.innerHeight * 0.01 + 'px');
  }
  fixVh();
  window.addEventListener('resize', fixVh);
  window.addEventListener('orientationchange', function () { setTimeout(fixVh, 250); });

  /* ── 可被「跳過」中斷的計時器 ── */
  function Skip() {}
  var skipRequested = false;
  var timers = new Set();

  function sleep(ms) {
    return new Promise(function (resolve) {
      if (skipRequested) return resolve();
      var entry = { resolve: resolve, t: 0 };
      entry.t = setTimeout(function () { timers.delete(entry); resolve(); }, ms);
      timers.add(entry);
    });
  }
  /* 等「輕觸下一張」的人也要被跳過叫醒 */
  var advanceWaiters = new Set();

  function fireSkip() {
    skipRequested = true;
    timers.forEach(function (e) { clearTimeout(e.t); e.resolve(); });
    timers.clear();
    advanceWaiters.forEach(function (release) { release(); });
    advanceWaiters.clear();
  }
  function guard() { if (skipRequested) throw new Skip(); }

  /* ── 場景切換 ── */
  var scenes = ['gate', 'cards', 'slides', 'videoScene', 'ending'];
  function showScene(id) {
    scenes.forEach(function (s) { $(s).classList.toggle('on', s === id); });
  }

  var skipBtn = $('skip');
  skipBtn.textContent = C.misc.skipLabel;
  skipBtn.addEventListener('click', fireSkip);
  function showSkip(on) { skipBtn.classList.toggle('on', !!on); }

  /* ═══════════════════════════ 1. 載入與開始 ═══════════════════════════ */

  var loadingEl = $('loading');
  var barEl = $('loadbar').querySelector('i');
  var startBtn = $('start');

  loadingEl.textContent = C.misc.loadingText;
  startBtn.textContent = C.misc.startPrompt;

  var images = [];
  function preloadImages() {
    var items = C.slides.items;
    var loaded = 0;
    return Promise.all(items.map(function (item) {
      /* 加密過的圖先下載、解開，換成 blob: 網址，後面播放時就跟一般圖片一樣用 */
      var ready = item.sealed
        ? window.unsealFile(item.src, item.mime).then(function (url) { item.src = url; },
            function (e) { console.warn('圖片解不開：' + item.src, e); })
        : Promise.resolve();
      return ready.then(function () {
        return new Promise(function (resolve) {
          var img = new Image();
          img.onload = img.onerror = function () {
            loaded++;
            barEl.style.right = (100 - (loaded / items.length) * 100) + '%';
            resolve();
          };
          img.src = item.src;
          images.push(img);
        });
      });
    }));
  }

  var bgm = null;
  function makeBgm() {
    if (!C.audio.enabled || !C.audio.src) return null;
    var a = new Audio();
    a.src = C.audio.src;
    /* 隱藏彩蛋開著的話，這首絕對不能循環——彩蛋是靠「這首歌自然播完一次」
       當開關，設成循環那個時機就永遠不會發生。 */
    var eggOn = C.easterEgg && C.easterEgg.enabled && C.easterEgg.src;
    a.loop = eggOn ? false : (C.audio.loop !== false);
    a.volume = C.audio.volume;
    a.preload = 'auto';
    a.addEventListener('error', function () { bgm = null; });
    return a;
  }

  var vid = $('vid');
  var pano = null;
  var usePano = C.video.mode === 'pano';

  function waitForTap() {
    return new Promise(function (resolve) {
      startBtn.classList.add('ready');
      loadingEl.textContent = '';
      startBtn.addEventListener('click', function once() {
        startBtn.removeEventListener('click', once);
        startBtn.classList.remove('ready');

        /* 影片從現在就開始整段下載（見 downloadClip）。開場字卡加十二張圖有兩三分鐘，
           一般網路足夠在輪到影片之前把第一段抓完，播放時就不會卡。 */
        downloadAhead();

        /* 影片有聲音的話，趁這一下觸控把它「解鎖」，之後沒有手勢也播得出聲音
           （iOS 特別吃這套）。影片靜音（預設）就不需要——靜音影片本來就能自動播。 */
        var firstClip = playableClips()[0];
        if (firstClip && !C.video.muted) {
          vid.preload = 'auto';
          vid.src = firstClip.src;
          vid.load();
          var p = vid.play();
          if (p && p.catch) {
            p.then(function () { vid.pause(); vid.currentTime = 0; })
             .catch(function () { /* 之後會用靜音模式補救 */ });
          }
        }

        /* 音樂只在全景影片播放時出現，這裡不真的播出來——
           只是趁使用者這一下觸控「解鎖」，讓後面影片開始時能不靠新的手勢直接播放
           （跟上面影片的解鎖手法一樣：play() 再立刻 pause() 拉回原點）。 */
        bgm = makeBgm();
        if (bgm) {
          var bp = bgm.play();
          if (bp && bp.catch) {
            bp.then(function () { bgm.pause(); bgm.currentTime = 0; })
              .catch(function () { /* 之後影片開始播放時，會再靠按鈕補救 */ });
          } else {
            bgm.pause();
            bgm.currentTime = 0;
          }
        }
        resolve();
      });
    });
  }

  /* ═══════════════════════════ 2. 字卡 ═══════════════════════════ */

  var cardLine = $('card-line');

  /* 字卡永遠不換行（CSS 設了 white-space: nowrap），
   * 太長的句子改成一路縮小字級，直到塞得進畫面寬度為止。 */
  function fitCardLine(text) {
    cardLine.style.fontSize = '';                // 先歸零，回到 CSS 預設的 clamp() 大小
    cardLine.style.whiteSpace = '';               // 先歸零，回到 CSS 預設的 nowrap
    cardLine.textContent = text;
    var maxWidth = window.innerWidth * 0.84;      // #cards 左右各留 8vw 的內距
    var size = parseFloat(getComputedStyle(cardLine).fontSize);
    var floor = 13;                               // 再縮下去會看不清楚
    while (cardLine.scrollWidth > maxWidth && size > floor) {
      size -= 1;
      cardLine.style.fontSize = size + 'px';
    }
    /* 縮到底了還是塞不下（極端情況），寧可正常換行，也不要讓文字衝出畫面 */
    if (cardLine.scrollWidth > maxWidth) cardLine.style.whiteSpace = 'normal';
  }

  async function playCards(cfg) {
    if (!cfg || !cfg.lines || !cfg.lines.length) return;
    showScene('cards');
    await sleep(600);
    guard();

    for (var i = 0; i < cfg.lines.length; i++) {
      cardLine.style.transition =
        'opacity ' + cfg.fadeIn + 'ms ease, filter ' + cfg.fadeIn + 'ms ease, transform ' + cfg.fadeIn + 'ms ease';
      fitCardLine(cfg.lines[i]);
      /* 強制重繪，確保 transition 會跑 */
      void cardLine.offsetWidth;
      cardLine.classList.add('in');

      await sleep(cfg.fadeIn + cfg.hold);
      guard();

      cardLine.style.transition =
        'opacity ' + cfg.fadeOut + 'ms ease, filter ' + cfg.fadeOut + 'ms ease, transform ' + cfg.fadeOut + 'ms ease';
      cardLine.classList.remove('in');

      await sleep(cfg.fadeOut + cfg.gap);
      guard();
    }
  }

  /* ═══════════════════════════ 3. 十二張圖 ═══════════════════════════ */

  var layers = [$('layerA'), $('layerB')];
  var slidesEl = $('slides');
  var tapHint = $('tap-hint');
  var progressEl = $('slide-progress');
  var progressBar = progressEl.querySelector('i');
  var zTop = 1;

  /* 等使用者輕觸畫面（或按空白鍵 / 方向鍵）換下一張。
   * mode 'both' 的話，時間到了也會自己換。 */
  function waitForAdvance(ms) {
    var mode = C.slides.advance || 'both';
    var manual = mode === 'tap' || mode === 'both';
    var auto = mode === 'auto' || mode === 'both';

    return new Promise(function (resolve) {
      if (skipRequested) return resolve();

      var settled = false;
      var armTimer = 0, autoTimer = 0, hintTimer = 0;

      function release() {
        if (settled) return;
        settled = true;
        clearTimeout(armTimer);
        clearTimeout(autoTimer);
        clearTimeout(hintTimer);
        slidesEl.removeEventListener('click', onTap);
        document.removeEventListener('keydown', onKey);
        advanceWaiters.delete(release);
        tapHint.classList.remove('in');
        resolve();
      }

      function onTap() { release(); }
      function onKey(e) {
        if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          release();
        }
      }

      advanceWaiters.add(release);

      if (manual) {
        /* 很短的緩衝，避免換頁瞬間的殘留點擊被算進來 */
        armTimer = setTimeout(function () {
          slidesEl.addEventListener('click', onTap);
          document.addEventListener('keydown', onKey);
        }, 150);

        if (C.slides.tapHint) {
          hintTimer = setTimeout(function () {
            tapHint.textContent = C.slides.tapHint;
            tapHint.classList.add('in');
          }, C.slides.tapHintDelay || 1600);
        }
      }

      if (auto) autoTimer = setTimeout(release, ms);
    });
  }

  /* 每一層各自記著自己的「淡出後關掉」計時器。
   * 手動翻頁可能在交叉淡入還沒結束時就換下一張，這時候這一層會被重新拿去畫新的圖，
   * 舊的關燈計時器如果沒取消，就會在幾百毫秒後把剛畫上去的新圖關掉（畫面變全黑）。 */
  var offTimers = {};

  function scheduleOff(layer, delay) {
    clearTimeout(offTimers[layer.id]);
    offTimers[layer.id] = setTimeout(function () { layer.classList.remove('on'); }, delay);
  }

  function paint(layer, item) {
    clearTimeout(offTimers[layer.id]);
    var url = 'url("' + item.src.replace(/"/g, '\\"') + '")';
    layer.querySelector('.bg').style.backgroundImage = url;
    var fg = layer.querySelector('.fg');
    fg.style.backgroundImage = url;

    layer.classList.remove('kb');
    fg.style.animationDuration = '';
    if (C.slides.kenBurns) {
      void fg.offsetWidth;                                  // 重置動畫
      fg.style.animationDuration = (item.duration + C.slides.crossfade * 2) + 'ms';
      layer.classList.add('kb');
    }
    layer.style.zIndex = ++zTop;
  }

  async function playSlides() {
    var items = C.slides.items;
    var fade = C.slides.crossfade;

    layers.forEach(function (l) {
      l.style.transitionDuration = fade + 'ms';
      l.querySelector('.bg').style.transitionDuration = fade + 'ms';
    });

    showScene('slides');
    if (C.slides.progressBar) progressEl.classList.add('in');
    await sleep(200);
    guard();

    var prev = null;
    for (var i = 0; i < items.length; i++) {
      var cur = layers[i % 2];
      paint(cur, items[i]);
      cur.classList.add('on');
      progressBar.style.width = ((i + 1) / items.length * 100) + '%';

      /* 交叉淡出：新的在上面淡入，舊的等淡完再關掉 */
      if (prev) scheduleOff(prev, fade);

      await waitForAdvance(items[i].duration);
      guard();
      prev = cur;
    }

    if (prev) prev.classList.remove('on');
    progressEl.classList.remove('in');
    await sleep(fade);
  }

  /* ═══════════════════════════ 4. 影片（一段接一段） ═══════════════════════════ */

  var videoScene = $('videoScene');
  var capWrap = $('captions');
  var capEl = $('caption');
  var dragHint = $('drag-hint');
  var gyroBtn = $('gyro-btn');
  var canvas = $('pano');
  var curtainEl = $('curtain');
  var clipProgressEl = $('clip-progress');
  var everDragged = false;   // 使用者只要拖曳過一次，之後每一段都不再提醒

  function addSoundButton() {
    if ($('sound-btn')) return;
    var b = document.createElement('button');
    b.className = 'pill-btn';
    b.id = 'sound-btn';
    b.textContent = '🔇  輕觸開啟聲音';
    videoScene.appendChild(b);
    b.addEventListener('click', function () {
      vid.muted = false;
      vid.volume = C.video.volume;
      b.remove();
    });
  }

  function addMusicButton() {
    if (!bgm || $('music-btn')) return;
    var b = document.createElement('button');
    b.className = 'pill-btn';
    b.id = 'music-btn';
    b.textContent = '🔇  輕觸開啟音樂';
    videoScene.appendChild(b);
    b.addEventListener('click', function () {
      if (bgm) bgm.play().catch(function () { /* 放棄，安靜播完就好 */ });
      b.remove();
    });
  }

  /* 音樂只在全景影片播放的時候出現——這裡才是真正開始播放的地方。
   * 「輕觸開始」那一下已經預先解鎖過，正常情況下這裡能直接播出聲音；
   * 萬一瀏覽器還是擋下來（沒有新的使用者手勢），就跳出按鈕讓人自己點開。 */
  function startBgm() {
    if (!bgm) return;
    bgm.currentTime = 0;
    var p = bgm.play();
    if (p && p.catch) p.catch(function () { addMusicButton(); });
    if (qs.has('dev')) window.__bgm = bgm;   // 除錯用，console 可查播放狀態
    armEasterEgg();
  }

  /* ═══════════════════════════ 隱藏彩蛋（會嚇人） ═══════════════════════════
   * 條件：bgm.mp3 自然播完一次「而且」畫面已經在結尾卡上，兩個都成立之後
   * 再等 easterEgg.delayMs，才會觸發。用兩個獨立的 flag 各自到位再匯合，
   * 是因為萬一影片卡頓、bgm 先天然播完但使用者根本還沒看到結尾卡，
   * 不該提早觸發——要等真的到了結尾卡才開始倒數。 */

  var eggState = { bgmEnded: false, atEnding: false, armed: false };

  function maybeArmEgg() {
    var cfg = C.easterEgg;
    if (eggState.armed || !cfg || !cfg.enabled || !cfg.src) return;
    if (!eggState.bgmEnded || !eggState.atEnding) return;
    eggState.armed = true;
    setTimeout(triggerEasterEgg, cfg.delayMs);
  }

  function armEasterEgg() {
    var cfg = C.easterEgg;
    if (!bgm || !cfg || !cfg.enabled || !cfg.src) return;
    bgm.addEventListener('ended', function onBgmEnded() {
      bgm.removeEventListener('ended', onBgmEnded);
      eggState.bgmEnded = true;
      maybeArmEgg();
    });
  }

  /* 亂碼字元庫——挑一些看起來像編碼壞掉、又帶點不祥感的符號跟字 */
  var EGG_GLYPHS = '锟斤拷烫哉煒衞髅魍魉厲鬼靈骸屍腐爛崩壊蝕黒闇淵絶望恐怖▓▒░×※〄◆■●∴∵Ξ☠♱†‡';

  /* 每個目標元素各自記住「原始文字」和「哪些字已經腐化」——
   * 腐化只會往前推進、不會復原，讀起來才像正在腐爛擴散，而不是隨機閃爍。
   * 已經腐化的字仍然每次都換一個新符號，維持一點「還在蠕動」的生命感。 */
  function makeDecayer(el) {
    var orig = Array.from(el.textContent);
    var order = [];
    for (var i = 0; i < orig.length; i++) { if (!/\s/.test(orig[i])) order.push(i); }
    for (var k = order.length - 1; k > 0; k--) {           // 洗牌，決定腐化順序
      var j = Math.floor(Math.random() * (k + 1));
      var tmp = order[k]; order[k] = order[j]; order[j] = tmp;
    }
    var decayedUpTo = 0;
    return {
      setProgress: function (p) { decayedUpTo = Math.round(order.length * p); },
      render: function () {
        var decayed = {};
        for (var n = 0; n < decayedUpTo; n++) decayed[order[n]] = true;
        el.textContent = orig.map(function (ch, idx) {
          return decayed[idx] ? EGG_GLYPHS[Math.floor(Math.random() * EGG_GLYPHS.length)] : ch;
        }).join('');
      },
    };
  }

  function startTextDecay(durationMs) {
    var decayers = ['end-eyebrow', 'end-names', 'end-date', 'end-closing']
      .map(function (id) { return $(id); })
      .filter(Boolean)
      .map(makeDecayer);
    var start = performance.now();
    function tick() {
      var p = Math.min(1, (performance.now() - start) / durationMs);
      decayers.forEach(function (d) { d.setProgress(p); d.render(); });
      requestAnimationFrame(tick);
      /* 這個迴圈刻意不停——腐化到 100% 之後，已經爛掉的字還是要
         持續換符號閃爍，維持「還在腐蝕中」的感覺，直到頁面關掉為止。 */
    }
    tick();
  }

  function triggerEasterEgg() {
    var cfg = C.easterEgg;
    var overlay = $('egg-overlay');
    overlay.style.transitionDuration = cfg.glitchDurationMs + 'ms';
    void overlay.offsetWidth;                  // 強制重繪，確保 transition 會跑
    overlay.classList.add('on');
    document.body.classList.add('egg-active');
    startTextDecay(cfg.glitchDurationMs);

    var egg = new Audio();
    egg.src = cfg.src;
    egg.loop = cfg.loop !== false;
    egg.volume = cfg.volume != null ? cfg.volume : 0.9;
    egg.play().catch(function () { /* 播不出來就算了，視覺效果照樣跑 */ });
    if (qs.has('dev')) window.__egg = egg;
  }

  /* 純粹計時用，跟「跳過」按鈕的計時系統無關——
   * 影片段落播放時「跳過」本來就是關著的，這裡不需要能被跳過打斷。 */
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* 等影片真的可以流暢播放（HAVE_FUTURE_DATA 以上），有個逾時上限，
   * 逾時就放棄等待、直接播——網路真的很慢的話會卡頓，但至少不會卡死流程。 */
  function waitReady(video, timeoutMs) {
    return new Promise(function (resolve) {
      if (video.readyState >= 3) return resolve(true);
      var done = false;
      var to = setTimeout(function () { finish(false); }, timeoutMs);
      function onReady() { finish(true); }
      function onErr() { finish(false); }
      function finish(ok) {
        if (done) return;
        done = true;
        clearTimeout(to);
        video.removeEventListener('canplay', onReady);
        video.removeEventListener('error', onErr);
        resolve(ok);
      }
      video.addEventListener('canplay', onReady);
      video.addEventListener('error', onErr);
    });
  }

  /* ── 影片整段下載完才播 ──
   * 手機瀏覽器（尤其 iOS Safari）不會替 <video> 整支預先下載，網路一慢就播一下停一下。
   * 所以自己用 fetch 把整個檔案抓下來，變成 blob: 網址再交給 <video>，播放中就不會再卡。
   *
   * 下載順序是一段接一段（不同時抓，免得互搶頻寬），而且最多只超前「正在播的那段」兩段：
   * 影片每段幾十 MB，全部同時放在手機記憶體裡太吃緊。播完的那段會馬上釋放。
   * 下載失敗會重試；真的抓不下來，就退回原本的邊下載邊播（見 playOneClip 的卡住偵測）。 */
  var downloads = [];
  var playingIndex = -1;

  function playableClips() {
    return (C.video.clips || []).filter(function (c) { return c && c.src; });
  }

  function fetchWhole(url, d) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      d.total = parseInt(r.headers.get('content-length'), 10) || 0;
      if (!r.body || !r.body.getReader) return r.blob();   // 不能邊讀邊算進度的舊瀏覽器
      var reader = r.body.getReader();
      var chunks = [];
      d.loaded = 0;
      return (function pump() {
        return reader.read().then(function (x) {
          if (x.done) return new Blob(chunks, { type: 'video/mp4' });
          chunks.push(x.value);
          d.loaded += x.value.length;
          return pump();
        });
      })();
    });
  }

  function downloadClip(i) {
    var clips = playableClips();
    if (i < 0 || i >= clips.length) return null;
    if (downloads[i]) return downloads[i];
    var d = { loaded: 0, total: 0, url: null, done: false };
    downloads[i] = d;
    function attempt(n) {
      return fetchWhole(clips[i].src, d).catch(function (e) {
        if (n >= 3) throw e;
        return wait(1500 * n).then(function () { return attempt(n + 1); });
      });
    }
    d.promise = attempt(1).then(function (blob) {
      d.url = URL.createObjectURL(blob);
      return d.url;
    }, function (e) {
      console.warn('第 ' + (i + 1) + ' 段影片整段下載失敗（' + e.message + '），改成邊下載邊播');
      d.url = clips[i].src;
      return d.url;
    }).then(function (url) {
      d.done = true;
      downloadAhead();
      return url;
    });
    return d;
  }

  /* 依序往下抓，最多抓到「正在播的那段 + 2」 */
  function downloadAhead() {
    var clips = playableClips();
    for (var i = 0; i < clips.length && i <= playingIndex + 2; i++) {
      var d = downloads[i] || downloadClip(i);
      if (!d.done) return;          // 一次只抓一段
    }
  }

  function releaseClip(i) {
    var d = downloads[i];
    if (d && d.url && d.url.indexOf('blob:') === 0) URL.revokeObjectURL(d.url);
  }

  /* 等這一段下載完；還沒好的話，畫面上顯示下載進度 */
  async function waitForClip(i) {
    var d = downloadClip(i);
    if (d.done) return d.url;
    var el = $('clip-loading');
    function show() {
      var pct = d.total ? Math.min(99, Math.floor(d.loaded / d.total * 100)) : 0;
      el.textContent = '影片正在載入　' + pct + '%';
    }
    show();
    el.classList.add('in');
    var timer = setInterval(show, 300);
    try {
      return await d.promise;
    } finally {
      clearInterval(timer);
      el.classList.remove('in');
    }
  }

  /* ── 分段進度條（多段影片時，畫面上緣那排像限時動態的細線） ── */
  function setupClipProgress(n) {
    clipProgressEl.innerHTML = '';
    if (!C.video.clipProgress || n <= 1) { clipProgressEl.classList.remove('in'); return; }
    for (var i = 0; i < n; i++) {
      var seg = document.createElement('i');
      seg.appendChild(document.createElement('b'));
      clipProgressEl.appendChild(seg);
    }
    clipProgressEl.classList.add('in');
  }
  function clipProgressUpdate(index, frac) {
    var segs = clipProgressEl.children;
    for (var k = 0; k < segs.length; k++) {
      segs[k].classList.toggle('done', k < index);
      if (k === index) segs[k].querySelector('b').style.width = (frac * 100) + '%';
      else if (k > index) segs[k].querySelector('b').style.width = '0%';
    }
  }
  function teardownClipProgress() { clipProgressEl.classList.remove('in'); }

  /* 播放單一段落，直到播完（或這段真的放不出來）才 resolve。 */
  function playOneClip(clip, index) {
    return new Promise(function (resolve) {
      if (pano) pano.look(clip.startYaw || 0, clip.startPitch || 0, C.video.fov);

      var cues = (clip.captions || []).slice().sort(function (a, b) { return a.at - b.at; });
      var active = -1;
      var hintShown = false, hintHidden = false;
      var raf, finished = false, watchdog;

      function tick() {
        raf = requestAnimationFrame(tick);
        var t = vid.currentTime;

        if (C.video.clipProgress && vid.duration) {
          clipProgressUpdate(index, Math.min(1, t / vid.duration));
        }

        var found = -1;
        for (var i = 0; i < cues.length; i++) {
          if (t >= cues[i].at && t < cues[i].at + cues[i].dur) { found = i; break; }
        }
        if (found !== active) {
          if (found === -1) {
            capEl.classList.remove('in');
          } else {
            var cue = cues[found];
            var swap = function () {
              capWrap.className = 'pos-' + (cue.pos || 'bottom');
              capEl.textContent = cue.text;
              void capEl.offsetWidth;
              capEl.classList.add('in');
            };
            if (active === -1) { swap(); }
            else { capEl.classList.remove('in'); setTimeout(swap, 450); }
          }
          active = found;
        }

        if (usePano && C.video.dragHint && !everDragged) {
          if (!hintShown && t >= C.video.dragHintAt) {
            hintShown = true;
            dragHint.textContent = C.video.dragHint;
            dragHint.classList.add('in');
          }
          if (hintShown && !hintHidden && t >= C.video.dragHintAt + C.video.dragHintDur) {
            hintHidden = true;
            dragHint.classList.remove('in');
          }
        }
      }
      tick();

      function finish() {
        if (finished) return;
        finished = true;
        clearInterval(watchdog);
        cancelAnimationFrame(raf);
        hideLoading();
        capEl.classList.remove('in');
        vid.removeEventListener('ended', finish);
        vid.removeEventListener('error', onError);
        vid.removeEventListener('playing', onPlaying);
        resolve();
      }

      function bail(why) {
        console.warn('第 ' + (index + 1) + ' 段影片播不出來（' + why + '）：' + clip.src + '，跳到下一段。');
        setTimeout(finish, 500);
      }
      function onError() { bail('error ' + (vid.error ? vid.error.code : '?')); }
      var loadEl = $('clip-loading');
      function showLoading() {
        loadEl.textContent = '影片正在載入…';
        loadEl.classList.add('in');
      }
      function hideLoading() { loadEl.classList.remove('in'); }
      function onPlaying() { hideLoading(); }

      /* 跟伺服器重新要一次資料，從卡住的地方接著播——等於自動幫使用者按了重新整理，
         只是不會從頭來過。影片是靜音的（聲音來自 bgm），所以不需要新的手勢也能播。 */
      function nudge() {
        var t = vid.currentTime;
        console.warn('第 ' + (index + 1) + ' 段影片卡在 ' + t.toFixed(1) + ' 秒，重新載入');
        vid.load();
        vid.addEventListener('loadedmetadata', function once() {
          vid.removeEventListener('loadedmetadata', once);
          if (t > 0) vid.currentTime = t;
          vid.play().catch(function () { /* 下一輪檢查會再試 */ });
        });
      }


      vid.addEventListener('ended', finish);
      vid.addEventListener('error', onError);
      vid.addEventListener('playing', onPlaying);

      if (vid.error) { bail('error ' + vid.error.code); return; }

      var p = vid.play();
      if (p && p.catch) {
        p.catch(function () {
          vid.muted = true;
          vid.play().catch(function () { /* 真的播不動就讓它停著，逾時保護會接手 */ });
          if (!C.video.muted) addSoundButton();
        });
      }

      /* 卡住偵測。手機網路慢的時候，影片可能還沒開始、或播到一半就停下來等資料，
       * 有時瀏覽器還會從此不再繼續下載（使用者要重新整理才會好）。
       * 每秒看一次播放時間有沒有往前走：
       *   卡 2 秒 → 顯示「影片正在載入…」
       *   卡住、而且下載也停了 8 秒 → 重新要一次資料，從卡住的地方接著播（最多三次）。
       *     下載還在進行的話就只是網路慢，乖乖等——重新要資料會把已經下載的丟掉，反而更慢。
       *   卡住、而且下載停了 35 秒 → 放棄這一段、跳下一段，至少整個流程不會卡死
       * 影片正常是整段下載完才播（見 downloadClip），不會走到這裡；
       * 這是整段下載失敗、退回邊下載邊播時的保險。 */
      var lastT = -1, stuckFor = 0, nudges = 0;
      var lastBuf = -1, idleFor = 0;
      watchdog = setInterval(function () {
        if (finished) return;

        var b = vid.buffered;
        var buf = b.length ? b.end(b.length - 1) : 0;
        if (buf > lastBuf + 0.05) { lastBuf = buf; idleFor = 0; } else { idleFor++; }

        /* 只算「往前走」：重新載入時時間會先歸零再跳回來，那不算有進度 */
        if (vid.currentTime > lastT + 0.05) {
          lastT = vid.currentTime;
          stuckFor = 0;
          hideLoading();
          return;
        }
        stuckFor++;
        if (stuckFor === 2) showLoading();
        if (idleFor >= 8 && nudges < 3) { nudges++; idleFor = 0; lastBuf = -1; nudge(); }
        if (stuckFor >= 35 && idleFor >= 35) bail('卡住太久');
      }, 1000);
    });
  }

  async function playVideos() {
    var clips = (C.video.clips || []).filter(function (c) { return c && c.src; });
    showSkip(false);

    if (!clips.length) return;                 // 還沒放影片，直接略過整段

    videoScene.classList.toggle('pano', usePano);
    vid.muted = !!C.video.muted;
    vid.volume = C.video.volume != null ? C.video.volume : 1;

    if (usePano) {
      pano = window.createPano(canvas, vid, {
        fov: C.video.fov, fovMin: C.video.fovMin, fovMax: C.video.fovMax,
        startYaw: clips[0].startYaw || 0, startPitch: clips[0].startPitch || 0,
        autoSpin: C.video.autoSpin,
        onFirstDrag: function () { everDragged = true; dragHint.classList.remove('in'); }
      });
      if (!pano) {                              /* 沒有 WebGL：退回平面播放 */
        usePano = false;
        videoScene.classList.remove('pano');
      } else {
        canvas.classList.remove('hidden');
        pano.start();
        /* 加了 ?dev=1 時把播放器掛到 window，方便在 console 裡調角度除錯：
           __pano.look(180, 20, 70); __pano.renderOnce(); */
        if (qs.has('dev')) window.__pano = pano;
      }
    }
    if (!usePano) canvas.style.display = 'none';

    /* 體感按鈕：整段旅程只需要設一次，不用每段影片重建 */
    if (usePano && C.video.gyroEnabled && window.DeviceOrientationEvent &&
        matchMedia('(pointer: coarse)').matches) {
      gyroBtn.classList.remove('hidden');
      gyroBtn.classList.add('pill-btn');
      gyroBtn.addEventListener('click', function () {
        if (pano.hasGyro()) {
          pano.disableGyro();
          gyroBtn.textContent = '體感環顧';
        } else {
          pano.enableGyro().then(function (ok) {
            gyroBtn.textContent = ok ? '關閉體感' : '體感不可用';
            if (ok) dragHint.classList.remove('in');
          });
        }
      });
    }

    setupClipProgress(clips.length);
    showScene('videoScene');
    /* 音樂是用來取代影片本身的聲音的，所以只在影片靜音時才播——
       如果哪天把 video.muted 改回 false，影片自己有聲音了，就不再疊加音樂。 */
    for (var i = 0; i < clips.length; i++) {
      if (i === 0) {
        await wait(500);                        // 讓「淡入影片場景」的轉場先跑完
      } else {
        curtainEl.classList.add('on');
        await wait(700);
      }
      /* 整段下載完才換上去（黑幕後面等；第一段則是在黑畫面上顯示下載進度） */
      var url = await waitForClip(i);
      vid.pause();
      vid.src = url;
      vid.load();
      await waitReady(vid, 6000);
      if (i > 0) {
        releaseClip(i - 1);                     // 上一段已經換下來了，釋放記憶體
        curtainEl.classList.remove('on');
        await wait(700);
      } else if (C.video.muted) {
        /* 音樂等第一段準備好才開始，跟影片、字幕的時間才對得上。
           音樂是用來取代影片本身的聲音的，所以只在影片靜音時才播——
           如果哪天把 video.muted 改回 false，影片自己有聲音了，就不再疊加音樂。 */
        startBgm();
      }
      playingIndex = i;
      downloadAhead();                          // 往後多抓一段
      await playOneClip(clips[i], i);
    }

    gyroBtn.classList.add('hidden');
    var sb = $('sound-btn');
    if (sb) sb.remove();
    var mb = $('music-btn');
    if (mb) mb.remove();
    teardownClipProgress();
  }

  /* ═══════════════════════════ 5. 結尾 ═══════════════════════════ */

  /* 結尾卡的螢火。一張全螢幕 canvas，三層景深：
   *   遠的 —— 小、清楚、亮，飄得慢
   *   近的 —— 大、朦朧、淡，飄得快（像鏡頭前失焦的光）
   * 每一顆都緩緩往上飄、左右游移、各自閃爍。結尾卡亮起的那一刻，
   * 先從名字後面散出一把光點，之後才慢慢融進穩定上飄的螢火裡。
   * 光暈是預先畫好的小圖，每一幀只是貼幾十張圖，手機也跑得動。
   * 系統要求減少動態的話，螢火只閃不飄，也不會有開場那一把。 */
  function startFireflies() {
    var host = $('ending-glow');
    var canvas = $('fireflies');
    if (!host || !canvas || host.dataset.lit) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    host.dataset.lit = '1';
    var still = matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* 金、琥珀、暖白為主，摻一點點跟背景光暈同色的粉 */
    var COLORS = ['255,212,150', '255,184,110', '255,236,205', '238,188,200'];
    var WEIGHTS = [0.42, 0.26, 0.22, 0.10];
    var sprites = COLORS.map(function (rgb) {
      var s = 64, r = s / 2;
      var c = document.createElement('canvas');
      c.width = c.height = s;
      var g = c.getContext('2d');
      var grad = g.createRadialGradient(r, r, 0, r, r, r);
      grad.addColorStop(0, 'rgba(255,250,240,1)');
      grad.addColorStop(0.1, 'rgba(' + rgb + ',0.95)');
      grad.addColorStop(0.32, 'rgba(' + rgb + ',0.32)');
      grad.addColorStop(1, 'rgba(' + rgb + ',0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, s, s);
      return c;
    });
    function pickColor() {
      var r = Math.random();
      for (var i = 0; i < WEIGHTS.length - 1; i++) { if ((r -= WEIGHTS[i]) < 0) return i; }
      return WEIGHTS.length - 1;
    }
    function rand(a, b) { return a + Math.random() * (b - a); }

    var W = 0, H = 0;
    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = host.clientWidth || window.innerWidth;
      H = host.clientHeight || window.innerHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    /* z：0 = 最遠，1 = 貼在鏡頭前。多數放遠處，少數幾顆靠近。 */
    function makeFly(z, x, y) {
      return {
        z: z, x: x, y: y,
        size: 4 + z * z * 46,                 // 含光暈的直徑（px）
        alpha: 0.95 - z * 0.72,               // 越近越淡，才像失焦
        rise: rand(7, 12) + z * 30,           // 往上飄的速度（px/s），近的快一點 = 視差
        wa: rand(6, 14) + z * 26,             // 左右游移的幅度
        wf: rand(0.12, 0.32),                 // 游移頻率
        wp: rand(0, Math.PI * 2),
        tf: rand(0.5, 1.6),                   // 閃爍頻率
        tp: rand(0, Math.PI * 2),
        c: pickColor(),
        ix: 0, iy: 0,                         // 開場那一把的初速，會慢慢衰減掉
        born: -10,
      };
    }

    var n = Math.max(26, Math.min(64, Math.round(W * H / 16000)));
    var flies = [];
    for (var i = 0; i < n; i++) {
      flies.push(makeFly(Math.pow(Math.random(), 1.7), rand(0, W), rand(0, H)));
    }

    /* 開場那一把：從名字後面往上、往兩側散開，比平常的螢火亮一點 */
    function burst() {
      var cx = W / 2, cy = H * 0.44;
      var spread = Math.min(W, 700);
      for (var k = 0; k < 22; k++) {
        var f = makeFly(rand(0.08, 0.5), cx + rand(-0.12, 0.12) * spread, cy + rand(-14, 14));
        /* 上半圈，越往兩側飛得越遠，才不會擠成一束往正上方衝 */
        var ang = rand(-Math.PI * 0.97, -Math.PI * 0.03);
        var sp = rand(0.15, 0.42) * spread * (1.2 - Math.abs(Math.sin(ang)) * 0.5);
        f.ix = Math.cos(ang) * sp;
        f.iy = Math.sin(ang) * sp;
        f.alpha = Math.min(1, f.alpha + 0.15);
        f.born = t;
        flies.push(f);
      }
    }

    var t = 0, last = performance.now(), burstDone = still, eggAt = -1;
    function frame(now) {
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;

      /* 彩蛋觸發時整層會淡掉（CSS），淡完就不用再畫了，省電 */
      if (document.body.classList.contains('egg-active')) {
        if (eggAt < 0) eggAt = t;
        if (t - eggAt > 2) return;
      }
      if (!burstDone && t > 0.7) { burstDone = true; burst(); }

      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';    // 光疊光會更亮，像真的光
      var master = Math.min(1, t / 2.4);           // 整片螢火慢慢浮現

      for (var j = 0; j < flies.length; j++) {
        var f = flies[j];
        if (!still) {
          var decay = Math.exp(-dt * 1.2);
          f.ix *= decay;
          f.iy *= decay;
          f.x += f.ix * dt;
          f.y += (f.iy - f.rise) * dt;
          /* 飄出上緣就從下緣重新出發；開場那一把也就此融進一般螢火 */
          if (f.y < -f.size) {
            f.y = H + f.size;
            f.x = rand(0, W);
            f.ix = f.iy = 0;
          }
          if (f.x < -f.size * 2) f.x += W + f.size * 4;
          else if (f.x > W + f.size * 2) f.x -= W + f.size * 4;
        }
        var wx = still ? 0 : Math.sin(t * f.wf * Math.PI * 2 + f.wp) * f.wa;
        var tw = 0.5 + 0.5 * Math.sin(t * f.tf * Math.PI * 2 * (still ? 0.4 : 1) + f.tp);
        var fade = f.born > -10 ? Math.min(1, (t - f.born) / 0.35) : master;
        ctx.globalAlpha = f.alpha * (0.3 + 0.7 * tw * tw) * fade;
        ctx.drawImage(sprites[f.c], f.x + wx - f.size / 2, f.y - f.size / 2, f.size, f.size);
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  async function showEnding() {
    var E = C.ending;
    $('end-eyebrow').textContent = E.eyebrow;
    $('end-names').textContent = E.names;
    $('end-date').textContent = E.date;
    $('end-closing').textContent = E.closing;

    var gb = $('end-guestbook');
    if (E.guestbookUrl && E.guestbookUrl.indexOf('http') === 0 && E.guestbookUrl.indexOf('請換成') === -1) {
      gb.href = E.guestbookUrl;
      gb.textContent = E.guestbookLabel;
    } else {
      gb.classList.add('hidden');
    }

    var rp = $('end-replay');
    rp.textContent = E.replayLabel;
    rp.addEventListener('click', function () { location.href = 'story.html' + location.search; });

    var curtain = $('curtain');
    curtain.classList.add('on');
    /* 音樂不在這裡淡出——從影片開始播的那一刻起，會一路放到結尾卡，
       播完（或到結尾卡都還沒放完就繼續放）都不打斷。 */
    await sleep(700);
    if (pano) pano.stop();
    vid.pause();
    showScene('ending');
    curtain.classList.remove('on');
    startFireflies();

    eggState.atEnding = true;
    maybeArmEgg();
  }

  /* ═══════════════════════════ 主流程 ═══════════════════════════ */

  async function run() {
    showScene('gate');
    if (!(await unlock())) return;
    await preloadImages();
    await waitForTap();

    showSkip(true);
    try {
      await playCards(C.opening);
      await playSlides();
      await playCards(C.interlude);
    } catch (e) {
      if (!(e instanceof Skip)) throw e;
      cardLine.classList.remove('in');
      layers.forEach(function (l) { l.classList.remove('on'); });
      tapHint.classList.remove('in');
      progressEl.classList.remove('in');
    }
    showSkip(false);

    await playVideos();
    await showEnding();
  }

  run().catch(function (e) { console.error(e); });
})();
