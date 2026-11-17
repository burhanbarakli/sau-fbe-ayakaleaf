// sablonu-yayinla.py'nin Node karsiligi (tasinabilir pakette Python olmayabilir).
// Ilk yoneticiyi olusturur, sablonu proje olarak yukler, LuaLaTeX ile derler, "Tezler" galerisinde
// yayinlar ve hesapta baska proje yoksa "Tezim" adli hazir projeyi olusturur.
import fs from 'node:fs'

const KILAVUZ = 'https://burhanbarakli.github.io/sau-fbe-doktora-latex-sablonu/'
const DEPO = 'https://github.com/burhanbarakli/sau-fbe-doktora-latex-sablonu'
export const SABLON_ADI = 'SAÜ FBE Lisansüstü Tez Şablonu'
const HAZIR_AD = 'Tezim'
const ACIKLAMA = `Sakarya Üniversitesi Fen Bilimleri Enstitüsü doktora ve yüksek lisans tez şablonu.
Enstitünün resmi Word şablonunun ve Lisansüstü Tez Yazım Kılavuzu'nun LuaLaTeX karşılığıdır.

- **Resimli kullanım kılavuzu:** [${KILAVUZ}](${KILAVUZ})
- **Kaynak kod ve Word karşılaştırması:** [${DEPO}](${DEPO})

Derleyici LuaLaTeX olarak ayarlıdır. Tez bilgilerinizi \`tez.tex\` dosyasının başına yazın, bölümleri
\`bolumler/\` klasöründe düzenleyin. Teslim çıktısından önce \`tez.tex\`'in ilk satırında \`notlar\` yerine
\`notsuz\` yazın.

Lisans: MIT. *Enstitünün resmi bir ürünü değildir; teslimden önce güncel kılavuzu kontrol ediniz.*`
const YAZAR = `[burhanbarakli](${DEPO})`

const log = m => console.log(`[sablon] ${m}`)
class Hata extends Error {}

class Istemci {
  constructor(url) { this.url = url.replace(/\/$/, ''); this.cerez = new Map(); this.csrf = null }

  async istek(yol, { json, govde, tur, yontem, zaman = 120000 } = {}) {
    const basliklar = { Accept: 'application/json, text/html' }
    if (json !== undefined) { govde = JSON.stringify(json); tur = 'application/json' }
    if (tur) basliklar['Content-Type'] = tur
    if (this.csrf && govde !== undefined) basliklar['X-Csrf-Token'] = this.csrf
    let url = this.url + yol
    let method = yontem || (govde !== undefined ? 'POST' : 'GET')
    for (let i = 0; i < 5; i++) {
      if (this.cerez.size) basliklar.Cookie = [...this.cerez].map(([k, v]) => `${k}=${v}`).join('; ')
      const y = await fetch(url, { method, headers: basliklar, body: govde, redirect: 'manual', signal: AbortSignal.timeout(zaman) })
      for (const c of y.headers.getSetCookie()) {
        const [kv] = c.split(';'); const j = kv.indexOf('=')
        this.cerez.set(kv.slice(0, j).trim(), kv.slice(j + 1).trim())
      }
      if ([301, 302, 303, 307, 308].includes(y.status) && y.headers.get('location')) {
        url = new URL(y.headers.get('location'), url).href
        if (y.status !== 307 && y.status !== 308) { method = 'GET'; govde = undefined; delete basliklar['Content-Type'] }
        continue
      }
      return [y.status, await y.text()]
    }
    throw new Hata(`Çok fazla yönlendirme: ${yol}`)
  }

  async csrfAl(yol) {
    const [, html] = await this.istek(yol)
    const m = html.match(/name="ol-csrfToken"\s+content="([^"]+)"/)
    if (!m) throw new Hata(`CSRF anahtarı bulunamadı: ${yol}`)
    this.csrf = m[1]
    return html
  }
}

export async function yoneticiVarMi(url) {
  const ist = new Istemci(url)
  const html = await ist.csrfAl('/launchpad')
  const m = html.match(/<meta name="ol-adminUserExists"[^>]*>/)
  return !m || m[0].includes('content="true"')
}

async function yoneticiOlustur(ist, email, sifre) {
  const html = await ist.csrfAl('/launchpad')
  const m = html.match(/<meta name="ol-adminUserExists"[^>]*>/)
  if (!m || m[0].includes('content="true"')) { log('Yönetici zaten var; oluşturma adımı atlandı.'); return }
  const [kod, yanit] = await ist.istek('/launchpad/register_admin', { json: { email, password: sifre, _csrf: ist.csrf } })
  if (kod >= 400) throw new Hata(`Yönetici oluşturulamadı (${kod}): ${yanit.slice(0, 300)}`)
  log(`Yönetici hesabı oluşturuldu: ${email}`)
}

async function giris(ist, email, sifre) {
  await ist.csrfAl('/login')
  const [kod, yanit] = await ist.istek('/login', { json: { email, password: sifre, _csrf: ist.csrf } })
  if (kod >= 400 || !yanit.includes('"redir"')) throw new Hata(`Giriş başarısız (${kod}). E-posta/şifreyi kontrol edin.`)
  await ist.csrfAl('/project')
  log('Giriş yapıldı.')
}

async function projeYukle(ist, ad, zip) {
  const form = new FormData()
  form.append('name', ad)
  form.append('qqfile', new Blob([zip], { type: 'application/zip' }), 'sablon.zip')
  const r = new Request('http://x', { method: 'POST', body: form })
  const tur = r.headers.get('content-type')
  const govde = Buffer.from(await r.arrayBuffer())
  const [kod, yanit] = await ist.istek('/project/new/upload', { govde, tur })
  let pid
  try { pid = JSON.parse(yanit).project_id } catch {}
  if (!pid) throw new Hata(`Proje yüklenemedi (${kod}): ${yanit.slice(0, 300)}`)
  log(`Proje yüklendi: ${ist.url}/project/${pid}`)
  return pid
}

async function projeler(ist) {
  const [kod, yanit] = await ist.istek('/api/project', { json: { filters: {}, page: { size: 1000 }, sort: { by: 'lastUpdated', order: 'desc' } } })
  if (kod !== 200) return null
  return (JSON.parse(yanit).projects || []).filter(p => !p.trashed).map(p => ({ id: p.id, ad: p.name }))
}

const bekleMs = ms => new Promise(r => setTimeout(r, ms))

async function derle(ist, pid, deneme = 3) {
  let [kod, yanit] = await ist.istek(`/project/${pid}/settings`, { json: { compiler: 'lualatex' } })
  if (kod >= 400) throw new Hata(`Derleyici ayarlanamadı (${kod}): ${yanit.slice(0, 200)}`)
  for (let i = 1; i <= deneme; i++) {
    log(`Derleniyor (LuaLaTeX, deneme ${i}/${deneme}; ilk derlemede yazı tipi önbelleği oluştuğu için birkaç dakika sürebilir)...`)
    ;[kod, yanit] = await ist.istek(`/project/${pid}/compile?auto_compile=false`, {
      json: { rootDoc_id: null, draft: false, check: 'silent', incrementalCompilesEnabled: true, stopOnFirstError: false },
      zaman: 900000,
    })
    let j = {}
    try { j = JSON.parse(yanit) } catch {}
    const pdf = (j.outputFiles || []).find(f => f.path === 'output.pdf')
    if (j.status === 'success' && pdf) { log('Derleme başarılı.'); return pdf.build }
    log(`Derleme sonucu: ${j.status || kod}`)
    await bekleMs(10000)
  }
  throw new Hata('Şablon derlenemedi. Projeyi tarayıcıda açıp günlüğe (Logs) bakın.')
}

async function eskiProje(ist, ad) {
  const [kod, yanit] = await ist.istek('/api/template?' + new URLSearchParams({ key: 'name', val: ad }))
  try { return kod === 200 ? (JSON.parse(yanit) || {}).project_id : null } catch { return null }
}

async function yayinla(ist, pid, build, ad) {
  const eski = await eskiProje(ist, ad)
  const govde = { category: '/templates/thesis', name: ad, authorMD: YAZAR, license: 'other', descriptionMD: ACIKLAMA, build, override: false }
  let [kod, yanit] = await ist.istek(`/template/new/${pid}`, { json: govde, zaman: 300000 })
  if (kod === 409) {
    log('Aynı adlı şablon var; yeni sürüm olarak güncelleniyor.')
    govde.override = true
    ;[kod, yanit] = await ist.istek(`/template/new/${pid}`, { json: govde, zaman: 300000 })
  }
  if (kod >= 400) throw new Hata(`Şablon yayınlanamadı (${kod}): ${yanit.slice(0, 300)}`)
  let tid
  try { const j = JSON.parse(yanit); tid = j.template_id || j.templateId } catch {}
  log('Şablon yayınlandı: ' + (tid ? `${ist.url}/template/${tid}` : `${ist.url}/templates/thesis`))
  if (eski && eski !== pid) {
    const [k] = await ist.istek(`/project/${eski}`, { govde: '', yontem: 'DELETE' })
    if (k < 400) log('Önceki sürümün kaynak projesi silindi.')
  }
  await ist.istek(`/project/${pid}/rename`, { json: { newProjectName: ad } })
  const [k] = await ist.istek(`/Project/${pid}/archive`, { govde: '' })
  if (k < 400) log('Galerinin kaynak projesi arşive kaldırıldı (Arşivlenmiş projeler).')
}

async function hazirProje(ist, zip, kaynakPid, ad) {
  const liste = await projeler(ist)
  if (!liste) { log('Proje listesi okunamadı; hazır proje adımı atlandı.'); return }
  const kendi = liste.filter(p => p.id !== kaynakPid)
  if (kendi.length) { log(`Hesapta zaten ${kendi.length} proje var; hazır "${ad}" projesi eklenmedi.`); return }
  const pid = await projeYukle(ist, ad, zip)
  await derle(ist, pid)
  log(`Hazır proje oluşturuldu: "${ad}" -> ${ist.url}/project/${pid} (adını değiştirip tezinize başlayın)`)
}

/** Sablonu yayinlar. hata durumunda Hata firlatir. */
export async function sablonYukle({ url, email, sifre, zipYolu, yoneticiOlusturulsun = false, hazir = true }) {
  const ist = new Istemci(url)
  if (yoneticiOlusturulsun) await yoneticiOlustur(ist, email, sifre)
  await giris(ist, email, sifre)
  const zip = fs.readFileSync(zipYolu)
  const pid = await projeYukle(ist, SABLON_ADI, zip)
  const build = await derle(ist, pid)
  await yayinla(ist, pid, build, SABLON_ADI)
  if (hazir) await hazirProje(ist, zip, pid, HAZIR_AD)
  log(`Bitti. Tarayıcıda açın: ${ist.url}/project`)
}
