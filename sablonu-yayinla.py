#!/usr/bin/env python3
"""SAÜ FBE LaTeX tez şablonunu bir AyakaLeaf Pro sunucusunun şablon galerisine yükler.

Yaptıkları:
  1. (isteğe bağlı) İlk yönetici hesabını /launchpad üzerinden oluşturur.
  2. Yönetici olarak giriş yapar.
  3. Şablonu GitHub'dan indirir (ya da --kaynak ile verilen klasörü/ZIP'i kullanır) ve proje olarak yükler.
  4. Projenin derleyicisini LuaLaTeX yapar ve derler.
  5. Projeyi "Tezler" kategorisinde şablon olarak yayınlar; aynı adlı şablon varsa yeni sürüm olarak günceller.
     Galerinin kaynak projesini arşive kaldırır (proje listesinde görünmez, şablon güncellenince silinir).
  6. Yöneticinin başka hiç projesi yoksa şablonun bir kopyasını "Tezim" adıyla hazır proje olarak oluşturur;
     kullanıcı bunu açıp yeniden adlandırarak doğrudan tezine başlar. Zaten bir projesi varsa dokunmaz.

Yalnızca Python 3 standart kitaplığını kullanır.
Örnek:  python3 sablonu-yayinla.py --url http://localhost:8080 --email admin@ornek.edu.tr
"""
import argparse
import getpass
import http.cookiejar
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile

KAYNAK_ZIP = 'https://codeload.github.com/burhanbarakli/sau-fbe-doktora-latex-sablonu/zip/refs/heads/main'
KILAVUZ = 'https://burhanbarakli.github.io/sau-fbe-doktora-latex-sablonu/'
DEPO = 'https://github.com/burhanbarakli/sau-fbe-doktora-latex-sablonu'
SABLON_ADI = 'SAÜ FBE Lisansüstü Tez Şablonu'
HAZIR_AD = 'Tezim'
ACIKLAMA = f'''Sakarya Üniversitesi Fen Bilimleri Enstitüsü doktora ve yüksek lisans tez şablonu.
Enstitünün resmi Word şablonunun ve Lisansüstü Tez Yazım Kılavuzu'nun LuaLaTeX karşılığıdır.

- **Resimli kullanım kılavuzu:** [{KILAVUZ}]({KILAVUZ})
- **Kaynak kod ve Word karşılaştırması:** [{DEPO}]({DEPO})

Derleyici LuaLaTeX olarak ayarlıdır. Tez bilgilerinizi `tez.tex` dosyasının başına yazın, bölümleri
`bolumler/` klasöründe düzenleyin. Teslim çıktısından önce `tez.tex`'in ilk satırında `notlar` yerine
`notsuz` yazın.

Lisans: MIT. *Enstitünün resmi bir ürünü değildir; teslimden önce güncel kılavuzu kontrol ediniz.*'''
YAZAR = f'[burhanbarakli]({DEPO})'


def log(msg):
    print(f'[sablon] {msg}', flush=True)


class Istemci:
    def __init__(self, url):
        self.url = url.rstrip('/')
        self.jar = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf = None

    def istek(self, yol, veri=None, json_veri=None, govde=None, tur=None, yontem=None, zaman=120):
        basliklar = {'Accept': 'application/json, text/html'}
        if json_veri is not None:
            govde = json.dumps(json_veri).encode()
            tur = 'application/json'
        elif veri is not None:
            govde = urllib.parse.urlencode(veri).encode()
            tur = 'application/x-www-form-urlencoded'
        if tur:
            basliklar['Content-Type'] = tur
        if self.csrf and govde is not None:
            basliklar['X-Csrf-Token'] = self.csrf
        r = urllib.request.Request(self.url + yol, data=govde, headers=basliklar, method=yontem)
        try:
            with self.op.open(r, timeout=zaman) as y:
                return y.status, y.read().decode('utf8', 'replace')
        except urllib.error.HTTPError as h:
            return h.code, h.read().decode('utf8', 'replace')

    def csrf_al(self, yol):
        _, html = self.istek(yol)
        m = re.search(r'name="ol-csrfToken"\s+content="([^"]+)"', html)
        if not m:
            raise SystemExit(f'CSRF anahtarı bulunamadı: {yol}')
        self.csrf = m.group(1)
        return html


def bekle(ist, sure):
    log(f'Sunucu bekleniyor: {ist.url} (en çok {sure} sn)')
    son = time.time() + sure
    while time.time() < son:
        try:
            kod, _ = ist.istek('/launchpad', zaman=10)
            if kod in (200, 302):
                return
        except Exception:
            pass
        time.sleep(5)
    raise SystemExit('Sunucu yanıt vermedi. "bin/docker-compose logs sharelatex" ile günlüğe bakın.')


def yonetici_olustur(ist, email, sifre):
    html = ist.csrf_al('/launchpad')
    m = re.search(r'<meta name="ol-adminUserExists"[^>]*>', html)
    if not m or 'content="true"' in m.group(0):
        log('Yönetici zaten var; oluşturma adımı atlandı.')
        return
    kod, yanit = ist.istek('/launchpad/register_admin',
                           json_veri={'email': email, 'password': sifre, '_csrf': ist.csrf})
    if kod >= 400:
        raise SystemExit(f'Yönetici oluşturulamadı ({kod}): {yanit[:300]}')
    log(f'Yönetici hesabı oluşturuldu: {email}')


def giris(ist, email, sifre):
    ist.csrf_al('/login')
    kod, yanit = ist.istek('/login', json_veri={'email': email, 'password': sifre, '_csrf': ist.csrf})
    if kod >= 400 or '"redir"' not in yanit:
        raise SystemExit(f'Giriş başarısız ({kod}). E-posta/şifreyi kontrol edin. {yanit[:200]}')
    ist.csrf_al('/project')
    log('Giriş yapıldı.')


def sablon_zip(kaynak):
    """sablon/ klasörünün içeriğini (kökte tez.tex olacak biçimde) ZIP baytı olarak döndürür."""
    dosyalar = {}
    if kaynak and os.path.isdir(kaynak):
        for kok, _, adlar in os.walk(kaynak):
            for ad in adlar:
                yol = os.path.join(kok, ad)
                dosyalar[os.path.relpath(yol, kaynak).replace(os.sep, '/')] = open(yol, 'rb').read()
    else:
        if kaynak:
            veri = open(kaynak, 'rb').read()
        else:
            log('Şablon GitHub\'dan indiriliyor...')
            veri = urllib.request.urlopen(KAYNAK_ZIP, timeout=120).read()
        with zipfile.ZipFile(io.BytesIO(veri)) as z:
            for ad in z.namelist():
                m = re.match(r'^(?:[^/]+/)?sablon/(.+)$', ad)
                if m and not ad.endswith('/'):
                    dosyalar[m.group(1)] = z.read(ad)
    atla = re.compile(r'\.(aux|log|toc|lof|lot|out|fls|fdb_latexmk|synctex\.gz|pdf)$')
    dosyalar = {k: v for k, v in dosyalar.items() if not atla.search(k) or k.startswith('sekiller/')}
    if 'tez.tex' not in dosyalar or 'sauthesis.cls' not in dosyalar:
        raise SystemExit('Kaynakta sablon/tez.tex ve sablon/sauthesis.cls bulunamadı.')
    tampon = io.BytesIO()
    with zipfile.ZipFile(tampon, 'w', zipfile.ZIP_DEFLATED) as z:
        for ad in sorted(dosyalar):
            z.writestr(ad, dosyalar[ad])
    log(f'Şablon paketlendi: {len(dosyalar)} dosya.')
    return tampon.getvalue()


def proje_yukle(ist, ad, zip_bayt):
    sinir = uuid.uuid4().hex
    govde = (f'--{sinir}\r\nContent-Disposition: form-data; name="name"\r\n\r\n{ad}\r\n'
             f'--{sinir}\r\nContent-Disposition: form-data; name="qqfile"; filename="sablon.zip"\r\n'
             f'Content-Type: application/zip\r\n\r\n').encode() + zip_bayt + f'\r\n--{sinir}--\r\n'.encode()
    kod, yanit = ist.istek('/project/new/upload', govde=govde, tur=f'multipart/form-data; boundary={sinir}')
    try:
        pid = json.loads(yanit)['project_id']
    except Exception:
        raise SystemExit(f'Proje yüklenemedi ({kod}): {yanit[:300]}')
    log(f'Proje yüklendi: {ist.url}/project/{pid}')
    return pid


def projeler(ist):
    """Giriş yapan kullanıcının çöpte olmayan projeleri: [(id, ad, arşivde_mi)]."""
    kod, yanit = ist.istek('/api/project', json_veri={'filters': {}, 'page': {'size': 1000},
                                                      'sort': {'by': 'lastUpdated', 'order': 'desc'}})
    if kod != 200:
        return None
    return [(p['id'], p['name'], p.get('archived')) for p in json.loads(yanit).get('projects', [])
            if not p.get('trashed')]


def derle(ist, pid, deneme=3):
    kod, yanit = ist.istek(f'/project/{pid}/settings', json_veri={'compiler': 'lualatex'})
    if kod >= 400:
        raise SystemExit(f'Derleyici ayarlanamadı ({kod}): {yanit[:200]}')
    for i in range(1, deneme + 1):
        log(f'Derleniyor (LuaLaTeX, deneme {i}/{deneme}; ilk derleme birkaç dakika sürebilir)...')
        kod, yanit = ist.istek(f'/project/{pid}/compile?auto_compile=false',
                               json_veri={'rootDoc_id': None, 'draft': False, 'check': 'silent',
                                          'incrementalCompilesEnabled': True, 'stopOnFirstError': False},
                               zaman=900)
        try:
            j = json.loads(yanit)
        except Exception:
            j = {}
        pdf = next((f for f in j.get('outputFiles', []) if f.get('path') == 'output.pdf'), None)
        if j.get('status') == 'success' and pdf:
            log('Derleme başarılı.')
            return pdf['build']
        log(f'Derleme sonucu: {j.get("status", kod)}')
        time.sleep(10)
    raise SystemExit('Şablon derlenemedi. Projeyi tarayıcıda açıp günlüğe (Logs) bakın.')


def eski_proje(ist, ad):
    """Aynı adlı yayınlanmış şablonun kaynak projesinin kimliği (yoksa None)."""
    kod, yanit = ist.istek('/api/template?' + urllib.parse.urlencode({'key': 'name', 'val': ad}))
    try:
        return (json.loads(yanit) or {}).get('project_id') if kod == 200 else None
    except Exception:
        return None


def yayinla(ist, pid, build, ad):
    eski = eski_proje(ist, ad)
    govde = {'category': '/templates/thesis', 'name': ad, 'authorMD': YAZAR, 'license': 'other',
             'descriptionMD': ACIKLAMA, 'build': build, 'override': False}
    kod, yanit = ist.istek(f'/template/new/{pid}', json_veri=govde, zaman=300)
    if kod == 409:
        log('Aynı adlı şablon var; yeni sürüm olarak güncelleniyor.')
        govde['override'] = True
        kod, yanit = ist.istek(f'/template/new/{pid}', json_veri=govde, zaman=300)
    if kod >= 400:
        raise SystemExit(f'Şablon yayınlanamadı ({kod}): {yanit[:300]}')
    try:
        tid = json.loads(yanit).get('template_id') or json.loads(yanit).get('templateId')
    except Exception:
        tid = None
    log('Şablon yayınlandı: ' + (f'{ist.url}/template/{tid}' if tid else f'{ist.url}/templates/thesis'))
    if eski and eski != pid:
        # Şablon, yayın anındaki ZIP/PDF kopyasını sakladığı için eski kaynak proje artık gerekmez.
        kod, _ = ist.istek(f'/project/{eski}', govde=b'', yontem='DELETE')
        if kod < 400:
            log('Önceki sürümün kaynak projesi silindi.')
    # Kaynak proje yüklenirken eski proje varsa "(2)" eki alır; eski silindikten sonra adı düzelt.
    ist.istek(f'/project/{pid}/rename', json_veri={'newProjectName': ad})
    # Kaynak proje şablonun malıdır: listeyi kalabalıklaştırmasın ve içine yanlışlıkla tez yazılmasın.
    if ist.istek(f'/Project/{pid}/archive', govde=b'')[0] < 400:
        log('Galerinin kaynak projesi arşive kaldırıldı (Arşivlenmiş projeler).')


def hazir_proje(ist, zip_bayt, kaynak_pid, ad):
    liste = projeler(ist)
    if liste is None:
        log('Proje listesi okunamadı; hazır proje adımı atlandı.')
        return
    kendi = [p for p in liste if p[0] != kaynak_pid]
    if kendi:
        log(f'Hesapta zaten {len(kendi)} proje var; hazır "{ad}" projesi eklenmedi.')
        return
    pid = proje_yukle(ist, ad, zip_bayt)
    derle(ist, pid)
    log(f'Hazır proje oluşturuldu: "{ad}" -> {ist.url}/project/{pid} (adını değiştirip tezinize başlayın)')


def main():
    p = argparse.ArgumentParser(description='SAÜ FBE tez şablonunu AyakaLeaf şablon galerisine yükler.')
    p.add_argument('--url', default=os.environ.get('AYAKALEAF_URL', 'http://localhost:8080'))
    p.add_argument('--email', default=os.environ.get('AYAKALEAF_EMAIL'))
    p.add_argument('--sifre-dosyasi', help='Şifreyi bu dosyanın ilk satırından okur (yoksa AYAKALEAF_SIFRE ya da sorar).')
    p.add_argument('--yonetici-olustur', action='store_true', help='Hiç yönetici yoksa bu e-posta/şifreyle oluşturur.')
    p.add_argument('--kaynak', help='Yerel sablon/ klasörü ya da depo ZIP\'i (verilmezse GitHub\'daki son sürüm).')
    p.add_argument('--ad', default=SABLON_ADI, help='Galerideki şablon adı.')
    p.add_argument('--hazir-proje', default=HAZIR_AD, metavar='AD',
                   help='Hesapta proje yoksa şablondan bu adla hazır proje oluşturur (varsayılan: Tezim).')
    p.add_argument('--hazir-proje-yok', action='store_true', help='Hazır proje oluşturma.')
    p.add_argument('--bekle', type=int, default=600, help='Sunucunun açılmasını bekleme süresi (sn).')
    a = p.parse_args()

    email = a.email or input('Yönetici e-postası: ').strip()
    if a.sifre_dosyasi:
        sifre = open(a.sifre_dosyasi, encoding='utf8').readline().strip()
    else:
        sifre = os.environ.get('AYAKALEAF_SIFRE') or getpass.getpass('Yönetici şifresi (en az 8 karakter): ')

    ist = Istemci(a.url)
    bekle(ist, a.bekle)
    if a.yonetici_olustur:
        yonetici_olustur(ist, email, sifre)
    giris(ist, email, sifre)
    zip_bayt = sablon_zip(a.kaynak)
    pid = proje_yukle(ist, a.ad, zip_bayt)
    build = derle(ist, pid)
    yayinla(ist, pid, build, a.ad)
    if not a.hazir_proje_yok:
        hazir_proje(ist, zip_bayt, pid, a.hazir_proje)
    log(f'Bitti. Tarayıcıda açın: {ist.url}/project')


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
