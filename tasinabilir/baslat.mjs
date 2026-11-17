// AyakaLeaf Pro'yu Docker'siz ve WSL'siz baslatir (Windows ve macOS), ilk calismada SAU FBE tez
// sablonunu yukler. Paket duzeni (ROOT = bu dosyanin klasoru, pakette "app/"):
//   overleaf/  derlenmis AyakaLeaf (Docker imajindaki /overleaf, yamala.mjs ile yamali)
//   ayar/      settings.js          sablon.zip   sablonun sablon/ klasoru
//   node/      Node.js              mongodb/     mongod(.exe)
//   garnet/    GarnetServer(.exe)   dotnet/      .NET calisma zamani (Garnet ister)
//   texlive/   tasinabilir TeX Live (yoksa sistemdeki LuaLaTeX kullanilir)
//   ../veri/   veritabani, projeler, gunlukler (ilk calismada olusur)
// Ortam degiskenleri: AYA_PORT (8080), AYA_VERI, AYA_TARAYICI=0 (tarayici acma),
//   AYA_YONETICI_EPOSTA + AYA_YONETICI_SIFRE (sormadan kur), AYA_KURULUMDAN_SONRA_CIK=1 (test icin).
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import net from 'node:net'
import crypto from 'node:crypto'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { sablonYukle } from './sablon-yukle.mjs'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const WIN = process.platform === 'win32'
const EXE = WIN ? '.exe' : ''
const APP = path.join(ROOT, 'overleaf')
const VERI = process.env.AYA_VERI || (path.basename(ROOT) === 'app' ? path.join(ROOT, '..', 'veri') : path.join(ROOT, 'veri'))
const DATA = path.join(VERI, 'data')
const TMP = path.join(VERI, 'tmp')
const LOG = path.join(VERI, 'log')
const MONGOD = process.env.AYA_MONGOD || ilkVar([path.join(ROOT, 'mongodb', 'bin', 'mongod' + EXE), path.join(ROOT, 'mongodb', 'mongod' + EXE)])
const GARNET = process.env.AYA_GARNET || path.join(ROOT, 'garnet', 'GarnetServer' + EXE)
const DOTNET = process.env.AYA_DOTNET || path.join(ROOT, 'dotnet')
const SABLON_ZIP = path.join(ROOT, 'sablon.zip')
const KURULUM = path.join(VERI, 'kurulum.json')
const p = s => s.split(path.sep).join('/') // node-config ve settings icin / ayirici
function ilkVar(liste) { return liste.find(f => fs.existsSync(f)) || liste[0] }

// AyakaLeaf'in sabit ic portlari (settings.defaults.js) ve bizim yardimcilarimiz
const IC_PORTLAR = { 3000: 'web-api', 3003: 'document-updater', 3009: 'filestore', 3010: 'chat', 3013: 'clsi',
  3016: 'docstore', 3026: 'real-time', 3042: 'notifications', 3054: 'project-history', 3066: 'linked-url-proxy',
  3080: 'derleme çıktıları', 3100: 'history-v1', 4000: 'web', 27017: 'MongoDB', 6379: 'Garnet (Redis)' }

function portBos(port) {
  return new Promise(ok => {
    const s = net.createServer().once('error', () => ok(false)).once('listening', () => s.close(() => ok(true)))
    s.listen(port, '127.0.0.1')
  })
}
function portBekle(port, sure = 60000) {
  const bas = Date.now()
  return new Promise((ok, hata) => {
    const dene = () => {
      const s = net.connect(port, '127.0.0.1', () => { s.end(); ok() })
      s.on('error', () => (Date.now() - bas > sure ? hata(new Error(`port ${port} açılmadı`)) : setTimeout(dene, 500)))
    }
    dene()
  })
}
function tarayiciAc(url) {
  if (process.env.AYA_TARAYICI === '0') return
  const [k, a] = WIN ? ['cmd', ['/c', 'start', '', url]] : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]]
  try { spawn(k, a, { detached: true, stdio: 'ignore', windowsHide: true }).unref() } catch {}
}
function sor(soru, gizli = false) {
  return new Promise(ok => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    if (gizli) rl._writeToOutput = s => rl.output.write(s.startsWith(soru) ? soru : s.replace(/[^\r\n]/g, '*'))
    rl.question(soru, c => { rl.close(); ok(c.trim()) })
  })
}

console.log('AyakaLeaf Pro + SAÜ FBE tez şablonu (taşınabilir, Docker\'sız)\n')

// --- ayni anda ikinci kopya: zaten calisiyorsa tarayiciyi acip cik
let calisanPort
try { calisanPort = JSON.parse(fs.readFileSync(path.join(VERI, 'calisiyor.json'), 'utf8')).port } catch {}
if (calisanPort && !(await portBos(4000)) && !(await portBos(calisanPort))) {
  console.log(`AyakaLeaf zaten çalışıyor: http://localhost:${calisanPort}`)
  tarayiciAc(`http://localhost:${calisanPort}`)
  process.exit(0)
}

// --- portlar
const dolu = []
for (const [port, ad] of Object.entries(IC_PORTLAR)) if (!(await portBos(Number(port)))) dolu.push(`${port} (${ad})`)
if (dolu.length) {
  console.error('Şu portlar başka bir program tarafından kullanılıyor:\n  ' + dolu.join('\n  '))
  console.error('\nBilgisayarınızda MongoDB, Redis ya da başka bir AyakaLeaf/Overleaf (Docker dahil) çalışıyorsa kapatıp yeniden deneyin.')
  process.exit(1)
}
let PORT = Number(process.env.AYA_PORT || 8080)
for (let i = 0; i < 20 && !(await portBos(PORT)); i++) PORT++
const SITE = process.env.OVERLEAF_SITE_URL || `http://localhost:${PORT}`

// --- uyarilar
if (WIN && /[^\x00-\x7F]/.test(ROOT)) {
  console.warn(`UYARI: Klasör yolunda Türkçe ya da özel karakter var:\n  ${ROOT}\n  LaTeX derlemesi bu yüzden hata verebilir. Klasörü C:\\AyakaLeaf gibi bir yere taşımanız önerilir.\n`)
}
for (const [ad, f] of [['MongoDB', MONGOD], ['Garnet', GARNET], ['AyakaLeaf', path.join(APP, '.pnp.cjs')]]) {
  if (!fs.existsSync(f)) { console.error(`${ad} bulunamadı: ${f}\nPaketi eksiksiz açtığınızdan emin olun.`); process.exit(1) }
}

for (const d of ['data/compiles', 'data/output', 'data/cache', 'data/template_files', 'data/history', 'data/learnPages',
  'data/user_files', 'tmp/projectHistories', 'tmp/dumpFolder', 'tmp/uploads', 'tmp/texmf-var', 'mongo', 'garnet', 'log']) {
  fs.mkdirSync(path.join(VERI, d), { recursive: true })
}
if (!fs.existsSync(path.join(VERI, 'site_status'))) fs.writeFileSync(path.join(VERI, 'site_status'), '')

// --- ilk kurulum bilgileri (servisler baslamadan once sorulur)
let kurulumBilgisi = null
if (!fs.existsSync(KURULUM)) {
  let email = process.env.AYA_YONETICI_EPOSTA, sifre = process.env.AYA_YONETICI_SIFRE
  if (!email || !sifre) {
    console.log('İlk kurulum: AyakaLeaf\'e gireceğiniz yönetici hesabını belirleyin (yalnızca bu bilgisayarda geçerli).')
    while (!/^[^@\s]+@[^@\s]+$/.test(email || '')) email = await sor('  E-posta: ')
    for (;;) {
      sifre = await sor('  Şifre (en az 8 karakter): ', true)
      if (sifre.length < 8) { console.log('  Şifre en az 8 karakter olmalı.'); continue }
      if ((await sor('  Şifre (tekrar): ', true)) === sifre) break
      console.log('  Şifreler aynı değil.')
    }
    console.log('')
  }
  kurulumBilgisi = { email, sifre }
}

// --- gizli anahtarlar (Docker'daki 100_generate_secrets.sh karsiligi)
const gizliDosya = path.join(VERI, 'gizli.json')
const r = () => crypto.randomBytes(32).toString('base64').replace(/[+/=]/g, '')
let gizli
try { gizli = JSON.parse(fs.readFileSync(gizliDosya, 'utf8')) } catch {
  const staging = r()
  gizli = { WEB_API_PASSWORD: r(), STAGING_PASSWORD: staging, V1_HISTORY_PASSWORD: staging, CRYPTO_RANDOM: r(), OT_JWT_AUTH_KEY: r() }
}
if (!gizli.OVERLEAF_INVITE_TOKEN_SECRET) gizli.OVERLEAF_INVITE_TOKEN_SECRET = r() // baglantiyla paylasim
fs.writeFileSync(gizliDosya, JSON.stringify(gizli, null, 2))

const env = {
  ...process.env,
  ...gizli,
  NODE_ENV: 'production',
  NODE_OPTIONS: `--require "${p(path.join(APP, '.pnp.cjs'))}" --import "file:///${p(path.join(APP, '.pnp.register.mjs')).replace(/^\//, '')}"`,
  OVERLEAF_CONFIG: path.join(ROOT, 'ayar', 'settings.js'),
  OVERLEAF_DATA_DIR: p(DATA),
  OVERLEAF_TMP_DIR: p(TMP),
  OVERLEAF_MONGO_URL: 'mongodb://127.0.0.1:27017/sharelatex',
  OVERLEAF_REDIS_HOST: '127.0.0.1',
  OVERLEAF_REDIS_PORT: '6379',
  OVERLEAF_SITE_URL: SITE,
  OVERLEAF_APP_NAME: process.env.OVERLEAF_APP_NAME || 'SAÜ FBE LaTeX',
  OVERLEAF_SITE_LANGUAGE: process.env.OVERLEAF_SITE_LANGUAGE || 'tr',
  OVERLEAF_HISTORY_BLOBS_BUCKET: p(path.join(DATA, 'history/overleaf-global-blobs')),
  OVERLEAF_HISTORY_PROJECT_BLOBS_BUCKET: p(path.join(DATA, 'history/overleaf-project-blobs')),
  OVERLEAF_HISTORY_CHUNKS_BUCKET: p(path.join(DATA, 'history/overleaf-chunks')),
  OVERLEAF_HISTORY_ZIPS_BUCKET: p(path.join(DATA, 'history/overleaf-zips')),
  OVERLEAF_SESSION_SECRET: gizli.CRYPTO_RANDOM,
  AYA_CLSI_DOWNLOAD: 'http://127.0.0.1:3080',
  WEB_API_USER: 'overleaf',
  ADMIN_PRIVILEGE_AVAILABLE: 'true',
  OPTIMISE_PDF: 'false',
  REQ_VALIDATION_MODE: 'enforce-log',
  TEXMFVAR: p(path.join(TMP, 'texmf-var')),
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  SITE_MAINTENANCE_FILE: path.join(VERI, 'site_status'),
  ENABLED_LINKED_FILE_TYPES: process.env.ENABLED_LINKED_FILE_TYPES || 'project_file,project_output_file',
  LISTEN_ADDRESS: '127.0.0.1',
  ENABLE_CONVERSIONS: 'true',
  OVERLEAF_TEMPLATE_GALLERY: 'true',
  OVERLEAF_TEMPLATE_CATEGORIES: 'thesis',
  TEMPLATE_THESIS_NAME: 'Tezler',
  TEMPLATE_THESIS_DESCRIPTION: 'Lisansüstü tez şablonları',
  TEMPLATE_ALL_NAME: 'Tüm şablonlar',
  TEMPLATE_ALL_DESCRIPTION: 'Bütün şablonlar',
}
for (const h of ['CHAT', 'CLSI', 'DOCSTORE', 'DOCUMENT_UPDATER', 'DOCUPDATER', 'FILESTORE', 'HISTORY_V1',
  'LINKED_URL_PROXY', 'NOTIFICATIONS', 'PROJECT_HISTORY', 'REALTIME', 'WEB', 'WEB_API']) env[h + '_HOST'] = '127.0.0.1'
if (fs.existsSync(DOTNET)) env.DOTNET_ROOT = DOTNET // Garnet: sistemde .NET kurulu olmasa da calisir

// --- TeX: paketteki TeX Live once gelir
const PATH_ANAHTAR = Object.keys(env).find(k => k.toUpperCase() === 'PATH') || 'PATH'
const texBin = fs.existsSync(path.join(ROOT, 'texlive', 'bin'))
  ? fs.readdirSync(path.join(ROOT, 'texlive', 'bin')).map(d => path.join(ROOT, 'texlive', 'bin', d)).find(d => fs.existsSync(path.join(d, 'lualatex' + EXE)))
  : null
if (texBin) env[PATH_ANAHTAR] = texBin + path.delimiter + (env[PATH_ANAHTAR] || '')
else if (spawnSync('lualatex', ['--version'], { env, windowsHide: true }).status !== 0) {
  console.warn('UYARI: LuaLaTeX bulunamadı; derleme çalışmaz. Paketteki texlive/ klasörü eksik olabilir.\n')
}

// --- surecler
const cocuklar = []
let kapaniyor = false
function baslat(ad, komut, args, ekEnv = {}, cwd = ROOT) {
  const out = fs.openSync(path.join(LOG, ad + '.log'), 'a')
  const c = spawn(komut, args, { cwd, env: { ...env, ...ekEnv }, stdio: ['ignore', out, out], windowsHide: true })
  c.on('exit', kod => { if (!kapaniyor) console.log(`[${ad}] durdu (kod ${kod}); günlük: ${path.join(LOG, ad + '.log')}`) })
  cocuklar.push({ ad, c })
  return c
}
function nodeCalistir(ad, args, cwd, zaman) {
  const r = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', windowsHide: true, timeout: zaman })
  fs.appendFileSync(path.join(LOG, ad + '.log'), (r.stdout || '') + (r.stderr || ''))
  if (r.status !== 0) throw new Error(`${ad} başarısız; günlük: ${path.join(LOG, ad + '.log')}`)
}
async function kapat(kod = 0) {
  if (kapaniyor) return
  kapaniyor = true
  console.log('\nKapatılıyor...')
  try { fs.rmSync(path.join(VERI, 'calisiyor.json'), { force: true }) } catch {}
  for (const { ad, c } of cocuklar) if (!['mongod', 'garnet'].includes(ad)) try { c.kill() } catch {}
  // MongoDB'yi duzgun kapat (veritabani dosyalari tutarli kalsin)
  try {
    nodeCalistir('mongo-kapat', ['-e', `const { MongoClient } = require('mongodb');
      (async () => { const c = new MongoClient('mongodb://127.0.0.1:27017/?directConnection=true');
        await c.connect(); try { await c.db('admin').command({ shutdown: 1 }) } catch {} })().then(() => process.exit(0), () => process.exit(0))`],
      path.join(APP, 'services', 'web'), 15000)
  } catch {}
  for (const { c } of cocuklar) try { c.kill() } catch {}
  setTimeout(() => process.exit(kod), 1000)
}
process.on('SIGINT', () => kapat(0))
process.on('SIGTERM', () => kapat(0))
process.on('SIGHUP', () => kapat(0))

console.log('MongoDB başlatılıyor...')
baslat('mongod', MONGOD, ['--replSet', 'overleaf', '--dbpath', path.join(VERI, 'mongo'), '--port', '27017', '--bind_ip', '127.0.0.1', '--quiet'])
console.log('Garnet (Redis) başlatılıyor...')
baslat('garnet', GARNET, ['--port', '6379', '--bind', '127.0.0.1', '-m', '512m', '--lua', '--lua-transaction-mode',
  '--checkpointdir', path.join(VERI, 'garnet'), '--recover', '--aof', '--aof-commit-freq', '1000'])
await portBekle(27017)
await portBekle(6379)

nodeCalistir('mongo-rs', ['-e', `
const { MongoClient } = require('mongodb');
(async () => {
  const c = new MongoClient('mongodb://127.0.0.1:27017/?directConnection=true');
  await c.connect();
  const a = c.db('admin');
  try { await a.command({ replSetGetStatus: 1 }) }
  catch (e) { await a.command({ replSetInitiate: { _id: 'overleaf', members: [{ _id: 0, host: '127.0.0.1:27017' }] } }) }
  for (let i = 0; i < 60; i++) { const s = await a.command({ hello: 1 }); if (s.isWritablePrimary) break; await new Promise(r => setTimeout(r, 500)) }
  await c.close();
})().catch(e => { console.error(e); process.exit(1) })`], path.join(APP, 'services', 'web'))

console.log('Veritabanı hazırlanıyor (ilk açılışta birkaç dakika sürebilir)...')
// east, Windows'ta "./lib/adapter.mjs" yolunu ve C:\ ile baslayan import'lari cozemez; file:// URL'ye cevir
nodeCalistir('migrations', ['-e', `
const P = require('path'), { pathToFileURL } = require('url');
const M = require('east/lib/migrator'), yukle = M.prototype._loadModule;
M.prototype._resolveModulePath = function (y) { return y.startsWith('.') || P.isAbsolute(y) ? P.resolve(y) : y };
M.prototype._loadModule = function (y) { return yukle.call(this, P.isAbsolute(y) && this.params.esModules ? pathToFileURL(y).href : y) };
process.argv = [process.argv[0], 'east', '--es-modules', 'migrate', '-t', 'server-ce'];
require('east/bin/east')`], path.join(APP, 'tools', 'migrations'))

console.log('AyakaLeaf servisleri başlatılıyor...')
const servisler = [
  ['web', 'services/web/app.mjs', { ENABLED_SERVICES: 'web', WEB_PORT: '4000' }],
  ['web-api', 'services/web/app.mjs', { ENABLED_SERVICES: 'api', METRICS_APP_NAME: 'web-api' }],
  ['real-time', 'services/real-time/app.js'],
  ['document-updater', 'services/document-updater/app.js'],
  ['clsi', 'services/clsi/app.js'],
  ['filestore', 'services/filestore/app.js'],
  ['docstore', 'services/docstore/app.js'],
  ['chat', 'services/chat/app.js'],
  ['notifications', 'services/notifications/app.ts'],
  ['project-history', 'services/project-history/app.js'],
  ['history-v1', 'services/history-v1/app.js', { NODE_CONFIG_DIR: path.join(APP, 'services/history-v1/config') }],
  ['linked-url-proxy', 'services/linked-url-proxy/app.mjs'],
]
for (const [ad, giris, ek] of servisler) baslat(ad, process.execPath, [path.join(APP, giris)], ek || {}, path.join(APP, path.dirname(giris)))

// --- nginx yerine: statik dosyalar, derleme ciktilari, socket.io ve web'e yonlendirme
const PUBLIC = path.join(APP, 'services/web/public')
const TUR = { '.pdf': 'application/pdf', '.log': 'text/plain', '.blg': 'text/plain', '.aux': 'text/plain', '.stdout': 'text/plain', '.stderr': 'text/plain',
  '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.wasm': 'application/wasm', '.map': 'application/json' }
function dosyaGonder(res, dosya, ekBaslik = {}) {
  fs.stat(dosya, (e, st) => {
    if (e || !st.isFile()) { res.writeHead(404); return res.end('Not found') }
    res.writeHead(200, { 'Content-Type': TUR[path.extname(dosya)] || 'application/octet-stream', 'Content-Length': st.size, ...ekBaslik })
    fs.createReadStream(dosya).pipe(res)
  })
}
const guvenli = (kok, ...parca) => { const f = path.resolve(kok, ...parca); return f.startsWith(path.resolve(kok)) ? f : null }
function cikti(url) {
  const OUT = path.join(DATA, 'output')
  let m
  if ((m = url.match(/^\/project\/([0-9a-f]+)\/user\/([0-9a-f]+)\/build\/([0-9a-f-]+)\/output\/(.+)$/))) return guvenli(OUT, `${m[1]}-${m[2]}`, 'generated-files', m[3], m[4])
  if ((m = url.match(/^\/project\/([0-9a-f-]+)\/build\/([0-9a-f-]+)\/output\/(.+)$/))) return guvenli(OUT, m[1], 'generated-files', m[2], m[3])
  if ((m = url.match(/^\/project\/([0-9a-f]+)\/user\/([0-9a-f]+)\/content\/([0-9a-f-]+\/[0-9a-f]+)$/))) return guvenli(OUT, `${m[1]}-${m[2]}`, 'content', m[3])
  if ((m = url.match(/^\/project\/([0-9a-f]+)\/content\/([0-9a-f-]+\/[0-9a-f]+)$/))) return guvenli(OUT, m[1], 'content', m[2])
  return null
}
// clsi-nginx karsiligi: web derleme ciktilarini buradan ceker
http.createServer((req, res) => {
  const c = cikti(decodeURIComponent(req.url.split('?')[0]))
  if (c) return dosyaGonder(res, c)
  res.writeHead(404); res.end()
}).listen(3080, '127.0.0.1')

function hedef(url) { return url.startsWith('/socket.io') ? 3026 : 4000 }
const sunucu = http.createServer((req, res) => {
  const yol = decodeURIComponent(req.url.split('?')[0])
  if (/^\/(metrics|health_check)/i.test(yol)) { res.writeHead(404); return res.end('Not found') }
  const c = cikti(yol)
  if (c) return dosyaGonder(res, c)
  if (/^\/(stylesheets|minjs|img|js|fonts)\//.test(yol)) {
    const f = guvenli(PUBLIC, '.' + yol)
    if (f && fs.existsSync(f)) return dosyaGonder(res, f, { 'Cache-Control': 'public, max-age=31536000' })
  }
  const istek = http.request({ host: '127.0.0.1', port: hedef(yol), method: req.method, path: req.url,
    headers: { ...req.headers, 'x-forwarded-for': req.socket.remoteAddress, 'x-forwarded-host': req.headers.host, 'x-forwarded-proto': 'http' } }, cevap => {
    res.writeHead(cevap.statusCode, cevap.headers)
    cevap.pipe(res)
  })
  istek.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('AyakaLeaf henüz hazır değil, birkaç saniye sonra sayfayı yenileyin.') })
  req.pipe(istek)
})
sunucu.on('upgrade', (req, soket, bas) => {
  const yol = req.url.split('?')[0]
  const arka = net.connect(hedef(yol), '127.0.0.1', () => {
    let s = `${req.method} ${req.url} HTTP/1.1\r\n`
    for (let i = 0; i < req.rawHeaders.length; i += 2) s += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`
    s += `X-Forwarded-For: ${req.socket.remoteAddress}\r\nX-Forwarded-Proto: http\r\n\r\n`
    arka.write(s); if (bas?.length) arka.write(bas)
    arka.pipe(soket); soket.pipe(arka)
  })
  arka.on('error', () => soket.destroy()); soket.on('error', () => arka.destroy())
})
await portBekle(4000, 300000)
await portBekle(3026, 60000)
await new Promise(ok => sunucu.listen(PORT, '127.0.0.1', ok))
fs.writeFileSync(path.join(VERI, 'calisiyor.json'), JSON.stringify({ port: PORT, pid: process.pid }))
console.log(`\nAyakaLeaf hazır: ${SITE}`)

// --- ilk kurulum: yonetici + sablon + Tezim
if (kurulumBilgisi) {
  console.log('\nİlk kurulum: şablon yükleniyor ve derleniyor...')
  try {
    if (!fs.existsSync(SABLON_ZIP)) throw new Error(`sablon.zip bulunamadı: ${SABLON_ZIP}`)
    await sablonYukle({ url: `http://127.0.0.1:${PORT}`, ...kurulumBilgisi, zipYolu: SABLON_ZIP, yoneticiOlusturulsun: true })
    fs.writeFileSync(KURULUM, JSON.stringify({ tarih: new Date().toISOString(), email: kurulumBilgisi.email }, null, 2))
    console.log('\nKURULUM TAMAM')
  } catch (e) {
    console.error(`\nŞablon yüklenemedi: ${e.message}\nAyakaLeaf çalışmaya devam ediyor. Kapatıp yeniden açtığınızda kurulum tekrar denenir.`)
    if (process.env.AYA_KURULUMDAN_SONRA_CIK === '1') { await kapat(1); await new Promise(() => {}) }
  }
  kurulumBilgisi = null
  if (process.env.AYA_KURULUMDAN_SONRA_CIK === '1') { await kapat(0); await new Promise(() => {}) }
}

console.log(`\nTarayıcıda açın: ${SITE}`)
console.log('Bu pencere açık kaldığı sürece AyakaLeaf çalışır. Kapatmak için Ctrl+C\'ye basın ya da pencereyi kapatın.')
tarayiciAc(SITE)
