/* 把 private/secret.js 加密成 assets/js/sealed.js（需要 Node.js）
 *
 *   node tools/seal.js
 *
 * 做三件事：
 *   1. 十二張圖加密成 data/s/*.bin。repo 是公開的，在 github.com 上誰都能瀏覽，
 *      圖上又有燒進去的字，不加密等於整段故事攤在那裡。
 *      影片只複製成亂數檔名、不加密：加密的影片得整支下載完才能播，手機上撐不住。
 *      原始檔都不會被動到。
 *   2. 用密碼加密正片內容（PBKDF2 + AES-GCM，跟瀏覽器內建的 Web Crypto 相容）。
 *   3. 清掉 data/s/ 裡已經沒有用到的舊檔。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const secretPath = path.join(root, 'private', 'secret.js');
const outPath = path.join(root, 'assets', 'js', 'sealed.js');
const mediaDir = path.join(root, 'data', 's');

if (!fs.existsSync(secretPath)) {
  console.error('找不到 private/secret.js —— 這個檔案不在 git 裡，要從你的備份放回來。');
  process.exit(1);
}

const S = require(secretPath);
if (!/^\d+$/.test(S.password)) {
  console.error('password 只能是數字：' + JSON.stringify(S.password));
  process.exit(1);
}

const salt = Buffer.from(S.salt, 'hex');
const key = crypto.pbkdf2Sync(S.password, salt, S.iterations, 32, 'sha256');
const content = JSON.parse(JSON.stringify(S.content));

/* Web Crypto 的 AES-GCM 要的格式是「密文後面直接接驗證碼」 */
function encrypt(buf) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(buf), cipher.final()]);
  return { iv: iv, data: Buffer.concat([body, cipher.getAuthTag()]) };
}

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

/* ── 1. 媒體檔換成亂數檔名（圖片順便加密） ── */
fs.mkdirSync(mediaDir, { recursive: true });
const keep = new Set();

function relocate(item, sealIt) {
  if (!item || !item.src) return;
  const src = path.join(root, item.src);
  if (!fs.existsSync(src)) {
    console.warn('  ! 找不到 ' + item.src + '，先跳過（網頁上這一項會是空的）');
    return;
  }
  /* 檔名由密鑰和原始路徑決定，同一個檔案每次跑都會得到同一個名字，
     不會因為重跑一次就在 repo 裡多出一份副本。 */
  const ext = path.extname(item.src).toLowerCase();
  const name = crypto.createHmac('sha256', key).update(item.src).digest('hex').slice(0, 20) +
               (sealIt ? '.bin' : ext);
  const dest = path.join(mediaDir, name);
  const a = fs.statSync(src);
  const b = fs.existsSync(dest) && fs.statSync(dest);
  if (sealIt) {
    /* 加密檔的大小本來就跟原檔不同，只能看原檔有沒有比較新 */
    if (!b || b.mtimeMs < a.mtimeMs) {
      const e = encrypt(fs.readFileSync(src));
      fs.writeFileSync(dest, Buffer.concat([e.iv, e.data]));   // 前 12 bytes 是 iv
      console.log('  加密 ' + item.src + ' → data/s/' + name);
    }
    item.sealed = true;
    item.mime = MIME[ext] || 'application/octet-stream';
  } else if (!b || b.size !== a.size || b.mtimeMs < a.mtimeMs) {
    fs.copyFileSync(src, dest);
    console.log('  複製 ' + item.src + ' → data/s/' + name);
  }
  keep.add(name);
  item.src = 'data/s/' + name;
}

((content.slides && content.slides.items) || []).forEach(function (it) { relocate(it, true); });
((content.video && content.video.clips) || []).forEach(function (it) { relocate(it, false); });

fs.readdirSync(mediaDir).forEach(function (f) {
  if (!keep.has(f)) {
    fs.unlinkSync(path.join(mediaDir, f));
    console.log('  刪除用不到的 data/s/' + f);
  }
});

/* ── 2. 加密 ── */
const e = encrypt(Buffer.from(JSON.stringify(content), 'utf8'));
const data = e.data.toString('base64');

const sealed = { salt: S.salt, iter: S.iterations, iv: e.iv.toString('hex'), data: data };
fs.writeFileSync(outPath,
  '/* 自動產生的檔案，不要手改。重新產生：node tools/seal.js */\n' +
  'window.SEALED = ' + JSON.stringify(sealed) + ';\n');

console.log('完成：assets/js/sealed.js（' + data.length + ' 字元）');
