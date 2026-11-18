# Claude için notlar

Bu depo, AyakaLeaf Pro'yu (Overleaf CE tabanlı, kendi sunucunda çalışan LaTeX editörü) kurup SAÜ FBE tez
şablonunu şablon galerisine ekler. AyakaLeaf'in kendisi burada değildir; `kur.sh` resmi Toolkit'i
`~/ayakaleaf-toolkit` klasörüne klonlar.

- Kurulum: `./kur.sh` (Linux, macOS ya da Windows'ta **Ubuntu/WSL 2 terminalinde**; PowerShell'de değil).
  Yalnızca şablonu yeniden yüklemek: `./kur.sh --sablon`.
- `kur.sh` Toolkit ayarlarını `config/overleaf.rc` ve `config/variables.env` içinde anahtar anahtar yazar;
  mevcut bir kurulumun `config/` ve `data/` klasörlerini asla silme ya da yeniden oluşturma.
- Şablonun kaynağı: https://github.com/burhanbarakli/sau-fbe-doktora-latex-sablonu (`sablon/` klasörü).
  `sablonu-yayinla.py` bunu indirir, proje olarak yükler, derleyiciyi LuaLaTeX yapar ve `/template/new/<id>`
  ile yayınlar. Şablonun biçim dosyalarını bu depoda değiştirme; değişiklik o depoda yapılır.
- Varsayılan yönetici hesabı `tez@sau.local` / `sakarya2026` (taşınabilir paket sormadan bununla kurar; `kur.sh`'ta
  Enter). Kullanıcı kendi şifresini girecekse onu sohbete yazdırma, komut satırına açık yazma; betik `getpass` ile sorar.
- Docker Desktop kurulumu ve lisans onayı kullanıcıya aittir. `sudo` gerektiren her komutu önce göster.
- Günlükler: `cd ~/ayakaleaf-toolkit && bin/docker-compose logs --tail=100 sharelatex`, derleyici: `bin/logs -f clsi`.
- **Taşınabilir paket (Kurulum 1, önerilen):** `tasinabilir/` + `.github/workflows/tasinabilir.yml`. İş akışı
  `AYA_IMAJ` imajından `/overleaf`'i çıkarır, `yamala.mjs` ile Windows/macOS yamalarını uygulayıp `ayar/settings.js`'i
  üretir; Node, MongoDB, Garnet (Redis yerine), .NET ve taşınabilir TeX Live (`tex-paketleri.txt`) ekleyip zip'ler,
  Windows ve macOS'ta `Baslat`'ı çalıştırıp şablonun sayfa sayısını (77) doğrular; `yayinla` girdisiyle Releases'e koyar.
  `baslat.mjs` Docker'daki runit/nginx/init betiklerinin karşılığıdır; ilk açılışta varsayılan yöneticiyi oluşturur ve
  `sablon-yukle.mjs` (sablonu-yayinla.py'nin Node karşılığı) ile şablonu yükler. Veriler paketin yanındaki `veri/`'de.
  AyakaLeaf sürümü yükseltilince `yamala.mjs` "YAMA BULUNAMADI" derse yamayı yeni koda göre güncelle.
- **Kurulum 3 (masaüstü editör, AyakaLeaf'siz):** yalnızca belgelerde anlatılır (MiKTeX/MacTeX + TeXstudio,
  şablon zip'i). `tez.tex`'in ilk iki satırı (`% !TeX program = lualatex`, `% !BIB program = biber`) TeXstudio'nun
  derleyiciyi seçmesini sağlar; şablon deposunda bu satırları koru.
- Belgeler: README.md ve `docs/index.html` (GitHub Pages). AyakaLeaf belgeleri: https://ayakaleaf-pro.ayaka.space/llms.txt
