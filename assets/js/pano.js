/* 360° 全景播放器
 *
 * 用一支 fragment shader 直接把 equirectangular（等距長方投影）影片
 * 反投影到螢幕上，沒有用任何第三方函式庫。
 * 支援：手指拖曳、雙指縮放、滑鼠滾輪、體感（陀螺儀）、閒置自動緩慢旋轉。
 *
 * createPano(canvas, video, opts) → 控制器物件；不支援 WebGL 時回傳 null。
 */
(function (global) {
  'use strict';

  var VERT = [
    'attribute vec2 aPos;',
    'void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n');

  var FRAG = [
    'precision highp float;',
    'uniform vec2 uRes;',
    'uniform float uFov;',    // 垂直視角（弧度）
    'uniform mat3 uRot;',
    'uniform sampler2D uTex;',
    'const float PI = 3.141592653589793;',
    'void main(){',
    '  vec2 ndc = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;',
    '  float t = tan(uFov * 0.5);',
    '  vec3 dir = normalize(vec3(ndc.x * t * (uRes.x / uRes.y), ndc.y * t, -1.0));',
    '  dir = uRot * dir;',
    '  float lon = atan(dir.x, -dir.z);',
    '  float lat = asin(clamp(dir.y, -1.0, 1.0));',
    '  vec2 uv = vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI);',
    '  gl_FragColor = texture2D(uTex, uv);',
    '}'
  ].join('\n');

  var DEG = Math.PI / 180;

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('shader:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  function createPano(canvas, video, opts) {
    opts = opts || {};

    var glOpts = { alpha: false, antialias: false, depth: false, stencil: false,
                   preserveDrawingBuffer: false, powerPreference: 'high-performance' };
    var gl = canvas.getContext('webgl2', glOpts);
    var isGL2 = !!gl;
    if (!gl) gl = canvas.getContext('webgl', glOpts) || canvas.getContext('experimental-webgl', glOpts);
    if (!gl) return null;

    var vs = compile(gl, gl.VERTEX_SHADER, VERT);
    var fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return null;

    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('link:', gl.getProgramInfoLog(prog));
      return null;
    }
    gl.useProgram(prog);

    /* 一個蓋滿螢幕的大三角形 */
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    var uRes = gl.getUniformLocation(prog, 'uRes');
    var uFov = gl.getUniformLocation(prog, 'uFov');
    var uRot = gl.getUniformLocation(prog, 'uRot');
    var uTex = gl.getUniformLocation(prog, 'uTex');

    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, isGL2 ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    /* 先塞一個黑色像素，影片還沒解碼出畫面時才不會是雜訊 */
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE,
                  new Uint8Array([0, 0, 0]));
    gl.uniform1i(uTex, 0);

    /* ---------- 狀態 ---------- */
    var yaw = (opts.startYaw || 0) * DEG;
    var pitch = (opts.startPitch || 0) * DEG;
    var fov = (opts.fov || 80) * DEG;
    var fovMin = (opts.fovMin || 45) * DEG;
    var fovMax = (opts.fovMax || 100) * DEG;
    var autoSpin = (opts.autoSpin || 0) * DEG;   // 每秒幾度
    var maxPitch = 85 * DEG;
    var running = false;
    var raf = null;
    var lastT = 0;
    var idleSince = performance.now();
    var gyro = null;
    var onFirstDrag = opts.onFirstDrag || null;
    var dragged = false;

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.round(canvas.clientWidth * dpr);
      var h = Math.round(canvas.clientHeight * dpr);
      if (w === 0 || h === 0) return;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
    }

    function setRot() {
      var cy = Math.cos(yaw), sy = Math.sin(yaw);
      var cp = Math.cos(pitch), sp = Math.sin(pitch);
      /* R = Ry(yaw) · Rx(pitch)，以 column-major 傳給 WebGL */
      gl.uniformMatrix3fv(uRot, false, new Float32Array([
        cy,        0,   -sy,
        sy * sp,   cp,   cy * sp,
        sy * cp,  -sp,   cy * cp
      ]));
    }

    var lastVideoTime = -1;
    function uploadFrame() {
      if (video.readyState < 2) return;
      if (video.currentTime === lastVideoTime && !video.seeking) return;
      lastVideoTime = video.currentTime;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
      } catch (e) { /* 某些瀏覽器在第一幀還沒好時會丟例外，忽略 */ }
    }

    /* 畫一格。rAF 迴圈用它，測試時也可以單獨呼叫 renderOnce()。 */
    function draw() {
      resize();
      uploadFrame();
      setRot();
      gl.uniform1f(uFov, fov);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function frame(t) {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      var dt = lastT ? Math.min((t - lastT) / 1000, 0.1) : 0;
      lastT = t;

      /* 閒置三秒後開始緩慢自轉 */
      if (autoSpin && !dragging && !gyro && t - idleSince > 3000) {
        yaw += autoSpin * dt;
      }

      draw();
    }

    /* ---------- 手勢 ---------- */
    var pointers = new Map();
    var dragging = false;
    var lastX = 0, lastY = 0, pinchDist = 0;

    function onDown(e) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);
      if (pointers.size === 1) {
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
      } else if (pointers.size === 2) {
        pinchDist = distance();
      }
      idleSince = performance.now();
    }

    function distance() {
      var p = Array.from(pointers.values());
      return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
    }

    function onMove(e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      idleSince = performance.now();

      if (pointers.size >= 2) {
        var d = distance();
        if (pinchDist > 0 && d > 0) {
          fov = clamp(fov * (pinchDist / d), fovMin, fovMax);
        }
        pinchDist = d;
        return;
      }
      if (!dragging) return;

      var h = canvas.clientHeight || 1;
      var k = fov / h;
      yaw += (e.clientX - lastX) * k;
      pitch = clamp(pitch + (e.clientY - lastY) * k, -maxPitch, maxPitch);
      lastX = e.clientX;
      lastY = e.clientY;

      if (!dragged && onFirstDrag) { dragged = true; onFirstDrag(); }
    }

    function onUp(e) {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) { dragging = false; idleSince = performance.now(); }
      if (pointers.size < 2) pinchDist = 0;
    }

    function onWheel(e) {
      e.preventDefault();
      fov = clamp(fov * (1 + e.deltaY * 0.0012), fovMin, fovMax);
      idleSince = performance.now();
    }

    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    /* ---------- 陀螺儀 ---------- */
    function gyroHandler(e) {
      if (e.alpha == null) return;
      var orient = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
      yaw = (e.alpha + orient) * DEG;
      pitch = clamp((e.beta - 90) * DEG, -maxPitch, maxPitch);
    }

    function enableGyro() {
      var DOE = global.DeviceOrientationEvent;
      if (!DOE) return Promise.resolve(false);
      var go = function () {
        gyro = gyroHandler;
        window.addEventListener('deviceorientation', gyroHandler, true);
        return true;
      };
      if (typeof DOE.requestPermission === 'function') {
        return DOE.requestPermission()
          .then(function (r) { return r === 'granted' ? go() : false; })
          .catch(function () { return false; });
      }
      return Promise.resolve(go());
    }

    function disableGyro() {
      if (gyro) {
        window.removeEventListener('deviceorientation', gyro, true);
        gyro = null;
      }
    }

    /* ---------- 對外介面 ---------- */
    return {
      start: function () {
        if (running) return;
        running = true;
        lastT = 0;
        idleSince = performance.now();
        resize();
        raf = requestAnimationFrame(frame);
      },
      stop: function () {
        running = false;
        if (raf) cancelAnimationFrame(raf);
        raf = null;
      },
      resize: resize,
      renderOnce: draw,
      /* 給測試與除錯用：直接指定鏡頭角度（單位：度） */
      look: function (yawDeg, pitchDeg, fovDeg) {
        if (yawDeg != null) yaw = yawDeg * DEG;
        if (pitchDeg != null) pitch = clamp(pitchDeg * DEG, -maxPitch, maxPitch);
        if (fovDeg != null) fov = clamp(fovDeg * DEG, fovMin, fovMax);
      },
      enableGyro: enableGyro,
      disableGyro: disableGyro,
      hasGyro: function () { return !!gyro; },
      destroy: function () {
        this.stop();
        disableGyro();
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp);
        canvas.removeEventListener('pointercancel', onUp);
        canvas.removeEventListener('wheel', onWheel);
      }
    };
  }

  global.createPano = createPano;
})(window);
