/* 密碼鎖：四個可以拖曳的數字滾輪 */
(function () {
  'use strict';

  var C = window.CONFIG.lock;
  /* 解開之後把密碼記在這支手機上，story.html 拿它去解開正片內容 */
  var KEY = 'married:code';

  /* 行動瀏覽器網址列會吃掉高度，用實際高度覆寫 --vh */
  function fixVh() {
    document.documentElement.style.setProperty('--vh', window.innerHeight * 0.01 + 'px');
  }
  fixVh();
  window.addEventListener('resize', fixVh);
  window.addEventListener('orientationchange', function () { setTimeout(fixVh, 250); });

  /* ---------- 文案 ---------- */
  document.getElementById('lock-title').textContent = C.title;
  document.getElementById('lock-subtitle').textContent = C.subtitle;

  var cluesEl = document.getElementById('clues');
  if (C.showClues && C.clues && C.clues.length) {
    C.clues.forEach(function (clue) {
      /* 線索可以是純文字，也可以是 { text, url, label } 帶一顆連結按鈕 */
      var item = (typeof clue === 'string') ? { text: clue } : (clue || {});
      var li = document.createElement('li');
      var span = document.createElement('span');
      span.textContent = item.text || '';
      li.appendChild(span);
      if (item.url) {
        var a = document.createElement('a');
        a.className = 'clue-link';
        a.href = item.url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = item.label || '前往';
        li.appendChild(a);
      }
      cluesEl.appendChild(li);
    });
  } else {
    cluesEl.classList.add('hidden');
  }

  /* ---------- 滾輪 ---------- */
  var wheelsEl = document.getElementById('wheels');
  var wheels = [];

  for (var i = 0; i < C.digits; i++) wheels.push(makeWheel(i));

  function makeWheel(index) {
    var el = document.createElement('div');
    el.className = 'wheel';
    el.tabIndex = 0;
    el.setAttribute('role', 'spinbutton');
    el.setAttribute('aria-label', '第 ' + (index + 1) + ' 位數字');

    var strip = document.createElement('div');
    strip.className = 'wheel-strip';
    var spans = [];
    for (var d = 0; d <= 9; d++) {
      var s = document.createElement('span');
      s.textContent = d;
      strip.appendChild(s);
      spans.push(s);
    }
    el.appendChild(strip);
    wheelsEl.appendChild(el);

    var w = { el: el, strip: strip, spans: spans, value: 0, index: index };

    function itemH() { return el.clientHeight / 3; }
    function render(offsetPx) {
      var y = (1 - w.value) * itemH() + (offsetPx || 0);
      strip.style.transform = 'translateY(' + y + 'px)';
      spans.forEach(function (s, d) { s.classList.toggle('active', d === w.value); });
    }
    w.set = function (v, silent) {
      w.value = ((v % 10) + 10) % 10;
      render(0);
      if (!silent) clearStatus();
    };
    w.render = render;

    /* 拖曳 */
    var dragging = false, startY = 0, startValue = 0, pointerId = null, moved = 0;
    el.addEventListener('pointerdown', function (e) {
      dragging = true; moved = 0;
      startY = e.clientY;
      startValue = w.value;
      pointerId = e.pointerId;
      el.setPointerCapture(pointerId);
      strip.classList.add('dragging');
      el.focus({ preventScroll: true });
    });
    el.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dy = e.clientY - startY;
      moved = Math.max(moved, Math.abs(dy));
      var raw = startValue - dy / itemH();
      var clamped = Math.max(-0.6, Math.min(9.6, raw));
      w.value = Math.max(0, Math.min(9, Math.round(clamped)));
      strip.style.transform = 'translateY(' + ((1 - clamped) * itemH()) + 'px)';
      spans.forEach(function (s, d) { s.classList.toggle('active', d === w.value); });
    });
    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      strip.classList.remove('dragging');
      if (pointerId !== null && el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
      /* 幾乎沒動 = 當成點擊：點上半往前一格、點下半往後一格 */
      if (moved < 6) {
        var rect = el.getBoundingClientRect();
        var localY = (e.clientY || rect.top + rect.height / 2) - rect.top;
        if (localY < rect.height / 3) w.set(w.value - 1);
        else if (localY > rect.height * 2 / 3) w.set(w.value + 1);
        else render(0);
      } else {
        w.set(w.value);
      }
      clearStatus();
    }
    /* 瀏覽器把手勢接手去捲頁面時會送 pointercancel。
       這種情況要把數字還原成手指按下去之前的值——
       使用者的本意是捲頁面，不是改密碼。 */
    function cancelDrag() {
      if (!dragging) return;
      dragging = false;
      strip.classList.remove('dragging');
      if (pointerId !== null && el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
      w.set(startValue, true);
    }
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', cancelDrag);

    el.addEventListener('focus', function () { el.classList.add('focus'); });
    el.addEventListener('blur', function () { el.classList.remove('focus'); });

    el.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowUp') { w.set(w.value - 1); e.preventDefault(); }
      else if (e.key === 'ArrowDown') { w.set(w.value + 1); e.preventDefault(); }
      else if (/^[0-9]$/.test(e.key)) {
        w.set(parseInt(e.key, 10));
        var next = wheels[index + 1];
        if (next) next.el.focus({ preventScroll: true });
        e.preventDefault();
      } else if (e.key === 'Enter') {
        attempt();
      }
    });

    /* 版面尺寸變了要重算 */
    window.addEventListener('resize', function () { render(0); });
    requestAnimationFrame(function () { render(0); });
    return w;
  }

  /* ---------- 檢查密碼 ---------- */
  var statusEl = document.getElementById('status');
  var btnUnlock = document.getElementById('btn-unlock');
  var btnHint = document.getElementById('btn-hint');
  var btnHelp = document.getElementById('btn-help');
  var hintLog = document.getElementById('hint-log');
  var unlockLabel = btnUnlock.textContent;
  var attempts = 0;
  var hintsUsed = 0;
  var busy = false;
  var done = false;

  function clearStatus() { statusEl.classList.remove('show'); }

  function showStatus(text) {
    statusEl.textContent = text;
    statusEl.classList.add('show');
  }

  function currentCode() {
    return wheels.map(function (w) { return w.value; }).join('');
  }

  /* 讓某個東西現身。第一次現身時順便捲到看得到的位置——
   * 這些東西是接在畫面下方長出來的，手機上很可能一開始在視線外，
   * 不主動捲過去的話，使用者根本不知道多了東西。 */
  function reveal(el) {
    if (!el.classList.contains('hidden')) return;
    el.classList.remove('hidden');
    setTimeout(function () {
      if (el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);
  }

  /* 解密要算一下（刻意的，見 unseal.js），按鈕先鎖住、換成「解鎖中」，
     免得有人以為沒反應而連按好幾次。 */
  function setBusy(on) {
    busy = on;
    btnUnlock.disabled = on;
    btnUnlock.textContent = on ? '解鎖中…' : unlockLabel;
  }

  function attempt() {
    if (done || busy) return;
    var code = currentCode();
    clearStatus();
    setBusy(true);
    window.unseal(code).then(function (content) {
      setBusy(false);
      if (content) succeed(code);
      else fail();
    }, function () {
      setBusy(false);
      showStatus('這個瀏覽器打不開這道鎖，換 Chrome 或 Safari 試試看。');
    });
  }

  function fail() {
    attempts++;
    wheelsEl.classList.add('shake', 'wrong');
    if (navigator.vibrate) navigator.vibrate([12, 60, 12]);
    setTimeout(function () { wheelsEl.classList.remove('shake', 'wrong'); }, 700);

    showStatus('不對。再想想。');

    /* 求救表單 */
    if (C.helpAfter > 0 && C.helpUrl && attempts >= C.helpAfter) {
      reveal(btnHelp);
    }

    if (C.hints && hintsUsed < C.hints.length && attempts >= 2) {
      reveal(btnHint);
    }
  }

  function succeed(code) {
    done = true;
    wheelsEl.classList.add('right');
    clearStatus();
    if (navigator.vibrate) navigator.vibrate(30);
    enter(code, C.unlockedText);
  }

  function enter(code, text) {
    try { localStorage.setItem(KEY, code); } catch (e) { /* 無痕模式寫不進去，下面改走網址 */ }
    /* 無痕模式下 localStorage 可能存不了，密碼就跟著網址帶過去 */
    var stored = false;
    try { stored = localStorage.getItem(KEY) === code; } catch (e) { stored = false; }
    var next = stored ? 'story.html' : 'story.html?code=' + code;
    var veil = document.getElementById('unlocked');
    veil.textContent = text || '';
    requestAnimationFrame(function () { veil.classList.add('on'); });
    setTimeout(function () { location.href = next; }, 1900);
  }

  btnUnlock.addEventListener('click', attempt);

  btnHint.addEventListener('click', function () {
    var p = document.createElement('p');
    p.textContent = C.hints[hintsUsed++];
    hintLog.appendChild(p);
    if (hintsUsed >= C.hints.length) btnHint.classList.add('hidden');
  });

  if (C.helpUrl) {
    btnHelp.href = C.helpUrl;
    btnHelp.textContent = C.helpLabel || '卡住了？告訴我們';
  }

  /* 沒看過說明就直接連進來的人，給一條路回表單 */
  var btnGuide = document.getElementById('btn-guide');
  if (C.guideUrl) {
    btnGuide.href = C.guideUrl;
    btnGuide.textContent = C.guideLabel || '還沒看過說明？從這裡開始';
    btnGuide.classList.remove('hidden');
  }

  /* 沒有任何「不用解就能進去」的路徑。
     解開過的人再回來也要重新輸入一次——反正他們知道密碼。 */

  /* 網址帶 ?code=1234 可直接預填，方便自己測試 */
  var pre = new URLSearchParams(location.search).get('code');
  if (pre) {
    pre.split('').slice(0, wheels.length).forEach(function (ch, i) {
      if (/[0-9]/.test(ch)) wheels[i].set(parseInt(ch, 10), true);
    });
  }
})();
