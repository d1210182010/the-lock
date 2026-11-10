/* 用密碼解開 sealed.js 裡的內容（瀏覽器內建的 Web Crypto，不用第三方函式庫）。
 *
 * 密碼對不對，就看解不解得開——原始碼裡沒有密碼，也沒有密碼的雜湊。
 * 每試一次密碼都要跑很多輪 PBKDF2（輪數在 sealed.js 的 iter），
 * 輸入正確的人只會多等不到一秒，但想把一萬種組合全試一遍就得算很久。
 *
 *   unseal('1234') → Promise：解開了是內容物件，密碼錯是 null，
 *                    瀏覽器不支援 Web Crypto 則 reject。 */
(function (global) {
  'use strict';

  function hex(s) {
    var u = new Uint8Array(s.length / 2);
    for (var i = 0; i < u.length; i++) u[i] = parseInt(s.substr(i * 2, 2), 16);
    return u;
  }

  function b64(s) {
    var bin = atob(s);
    var u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }

  function unseal(code) {
    var S = global.SEALED;
    /* Web Crypto 只在 https 或 localhost 底下才有。
       用手機連電腦的區網 IP（http://192.168…）測試會走到這裡。 */
    if (!S || !global.crypto || !global.crypto.subtle) {
      return Promise.reject(new Error('unsupported'));
    }
    var subtle = global.crypto.subtle;
    return subtle.importKey('raw', new TextEncoder().encode(String(code)), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return subtle.deriveKey(
          { name: 'PBKDF2', salt: hex(S.salt), iterations: S.iter, hash: 'SHA-256' },
          base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      })
      .then(function (key) {
        return subtle.decrypt({ name: 'AES-GCM', iv: hex(S.iv) }, key, b64(S.data))
          .then(function (buf) {
            openedKey = key;
            return JSON.parse(new TextDecoder().decode(buf));
          }, function () { return null; });   // 驗證碼對不上 = 密碼錯
      });
  }

  /* 解開成功之後，用同一把鑰匙解開加密過的圖片（data/s/*.bin，前 12 bytes 是 iv）。
   *   unsealFile(url, 'image/jpeg') → Promise<可以直接當 src 用的 blob: 網址> */
  var openedKey = null;

  function unsealFile(url, mime) {
    if (!openedKey) return Promise.reject(new Error('locked'));
    return fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error(r.status + ' ' + url);
        return r.arrayBuffer();
      })
      .then(function (buf) {
        return global.crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: new Uint8Array(buf, 0, 12) }, openedKey, new Uint8Array(buf, 12));
      })
      .then(function (plain) {
        return URL.createObjectURL(new Blob([plain], { type: mime || '' }));
      });
  }

  global.unseal = unseal;
  global.unsealFile = unsealFile;
})(window);
