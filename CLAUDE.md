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
- Yönetici şifresini sohbete yazdırma, komut satırına açık yazma; betik `getpass` ile sorar.
- Docker Desktop kurulumu ve lisans onayı kullanıcıya aittir. `sudo` gerektiren her komutu önce göster.
- Günlükler: `cd ~/ayakaleaf-toolkit && bin/docker-compose logs --tail=100 sharelatex`, derleyici: `bin/logs -f clsi`.
- Belgeler: README.md ve `docs/index.html` (GitHub Pages). AyakaLeaf belgeleri: https://ayakaleaf-pro.ayaka.space/llms.txt
