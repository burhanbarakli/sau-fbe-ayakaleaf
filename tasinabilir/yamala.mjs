// Docker imajindan alinan /overleaf agacini Windows ve macOS'ta calisacak hale getirir.
// Tekrar calistirmak zararsizdir.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), 'overleaf')
const URL_YOL = "decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\\/(?=[A-Za-z]:)/, '')"
const URL_KLASOR = "decodeURIComponent(new URL('.', import.meta.url).pathname).replace(/^\\/(?=[A-Za-z]:)/, '')"

const yamalar = [
  // new URL(import.meta.url).pathname Windows'ta /C:/... verir
  ['services/web/modules/login-register/app/src/LoginController.mjs', 'new URL(import.meta.url).pathname', URL_YOL],
  ['services/web/modules/login-register/app/src/RegisterController.mjs', 'new URL(import.meta.url).pathname', URL_YOL],
  ['services/web/app/src/Features/StaticPages/HomeController.mjs', "new URL('.', import.meta.url).pathname", URL_KLASOR],
  // ana modul kontrolu Windows'ta tutmaz, notifications hic dinlemeye baslamaz
  ['services/notifications/app.ts', 'if (import.meta.url === `file://${process.argv[1]}`) {', 'if (import.meta.main) {'],
  // Windows'ta surec grubu yok: process.kill(-pid) hata verir
  ['services/clsi/app/js/LocalCommandRunner.js', 'process.kill(-pid) // kill all processes in group',
    "process.platform === 'win32' ? spawnSync('taskkill', ['/pid', String(pid), '/T', '/F']) : process.kill(-pid) // kill all processes in group"],
  ['services/clsi/app/js/LocalCommandRunner.js', "import { spawn } from 'node:child_process'", "import { spawn, spawnSync } from 'node:child_process'"],
  ['services/clsi/app/js/LocalCommandRunner.js', '      detached: true,', "      detached: process.platform !== 'win32',\n      windowsHide: true,"],
  // yol ayirici: Windows'ta Path.normalize / Path.join / Path.relative "\" uretir
  ['services/web/app/src/Features/Uploads/ArchiveManager.mjs', 'if (dest !== Path.normalize(dest)) {',
    "if (dest.replace(/\\\\/g, '/') !== Path.normalize(dest).replace(/\\\\/g, '/')) {"],
  ['services/web/app/src/Features/Uploads/FileSystemImportManager.mjs', "const projectPath = Path.join('/', Path.relative(dirPath, filePath))",
    "const projectPath = Path.posix.join('/', Path.relative(dirPath, filePath).split(Path.sep).join('/'))"],
  ['services/clsi/app/js/ResourceWriter.js', "if (path.slice(0, basePath.length + 1) !== basePath + '/') {",
    'if (path.slice(0, Path.normalize(basePath).length + 1) !== Path.normalize(basePath) + Path.sep) {'],
  ['services/clsi/app/js/SynctexOutputParser.js', 'record.file = Path.relative(baseDir, value)',
    'record.file = Path.relative(baseDir, value).split(Path.sep).join(\'/\')'],
  ['services/clsi/app/js/OutputFileFinder.js', '    const p = Path.join(d, dirent.name)',
    "    const p = d ? d + '/' + dirent.name : dirent.name"],
]

let degisen = 0
for (const [dosya, eski, yeni] of yamalar) {
  const f = path.join(APP, dosya)
  let s = fs.readFileSync(f, 'utf8')
  if (s.includes(yeni)) continue
  if (!s.includes(eski)) { console.error(`YAMA BULUNAMADI: ${dosya}\n  ${eski}`); process.exitCode = 1; continue }
  s = s.split(eski).join(yeni)
  fs.writeFileSync(f, s)
  degisen++
}
console.log(`yamalar: ${degisen} dosya degisti`)

// ayar/settings.js: imajdaki /etc/overleaf/settings.js'ten, sabit Linux yollari ortam degiskenine cevrilerek
const KOK = path.dirname(APP)
const kaynak = path.join(KOK, 'etc', 'overleaf', 'settings.js')
if (fs.existsSync(kaynak)) {
  let s = fs.readFileSync(kaynak, 'utf8')
  const degistir = (eski, yeni) => {
    if (!s.includes(eski)) { console.error(`AYAR BULUNAMADI: ${eski}`); process.exitCode = 1 }
    s = s.split(eski).join(yeni)
  }
  degistir("const DATA_DIR = '/var/lib/overleaf/data'", 'const DATA_DIR = process.env.OVERLEAF_DATA_DIR')
  degistir("const TMP_DIR = '/var/lib/overleaf/tmp'", 'const TMP_DIR = process.env.OVERLEAF_TMP_DIR')
  degistir("'/var/lib/overleaf/data/history/", "process.env.OVERLEAF_DATA_DIR + '/history/")
  // web derleme ciktilarini clsi-nginx (8080) yerine baslat.mjs'in 3080 portundan ceker
  s = s.replace('\n  apis: {\n', "\n  apis: {\n    clsi: { downloadHost: process.env.AYA_CLSI_DOWNLOAD || 'http://127.0.0.1:8080' },\n")
  if (!s.includes('AYA_CLSI_DOWNLOAD')) { console.error('AYAR BULUNAMADI: apis'); process.exitCode = 1 }
  fs.mkdirSync(path.join(KOK, 'ayar'), { recursive: true })
  fs.writeFileSync(path.join(KOK, 'ayar', 'settings.js'), s)
  console.log('ayar/settings.js yazildi')
}
