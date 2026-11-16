#!/usr/bin/env bash
# SAÜ FBE tez şablonu gömülü AyakaLeaf Pro kurulumu (Linux, Windows WSL 2, macOS).
#
#   ./kur.sh              kurar, başlatır, yönetici oluşturur ve şablonu galeriye yükler
#   ./kur.sh --sablon     yalnızca şablonu yeniden yükler/günceller (sunucu çalışırken)
#
# Ayarlar (ortam değişkeni olarak verilebilir):
#   AYAKALEAF_DIZIN  Toolkit klasörü              (varsayılan: ~/ayakaleaf-toolkit)
#   AYAKALEAF_PORT   Tarayıcı portu               (varsayılan: 8080)
#   TEXLIVE_IMAGE    TeX Live imajı               (varsayılan: ghcr.io/ayaka-notes/texlive-full:2026.1)
#   AYAKALEAF_EMAIL  Yönetici e-postası           (verilmezse sorulur)
set -euo pipefail

BURASI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIZIN="${AYAKALEAF_DIZIN:-$HOME/ayakaleaf-toolkit}"
PORT="${AYAKALEAF_PORT:-8080}"
TEXLIVE="${TEXLIVE_IMAGE:-ghcr.io/ayaka-notes/texlive-full:2026.1}"
TOOLKIT_GIT="https://github.com/ayaka-notes/toolkit.git"
URL="http://localhost:${PORT}"

bilgi() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
uyari() { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }
hata()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }
sor()   { local c; read -r -p "$1 [e/H] " c; [[ "$c" =~ ^[eEyY] ]]; }

# ---------------------------------------------------------------- şablonu yükle
sablon_yukle() {
  command -v python3 >/dev/null || hata "python3 bulunamadı."
  local email="${AYAKALEAF_EMAIL:-}"
  [ -n "$email" ] || read -r -p "Yönetici e-postası (giriş adınız olacak): " email
  local ek=()
  [ "${1:-}" = "--yonetici-olustur" ] && ek+=(--yonetici-olustur)
  python3 "$BURASI/sablonu-yayinla.py" --url "$URL" --email "$email" "${ek[@]}"
}

if [ "${1:-}" = "--sablon" ]; then
  sablon_yukle
  exit 0
fi

# ---------------------------------------------------------------- 1. işletim sistemi
OS="$(uname -s)"
case "$OS" in
  Darwin)
    bilgi "macOS bulundu."
    command -v brew >/dev/null || hata "Homebrew gerekli: https://brew.sh"
    if ! sed --version >/dev/null 2>&1; then
      if [ ! -d "$(brew --prefix)/opt/gnu-sed" ]; then
        bilgi "Toolkit GNU sed ister; kuruluyor: brew install gnu-sed"
        brew install gnu-sed
      fi
      export PATH="$(brew --prefix gnu-sed)/libexec/gnubin:$PATH"
    fi
    ;;
  Linux)
    if grep -qi microsoft /proc/version 2>/dev/null; then bilgi "Windows WSL 2 bulundu."; else bilgi "Linux bulundu."; fi
    case "$DIZIN" in /mnt/[a-z]/*) uyari "Toolkit'i /mnt/c altına değil, Linux ev klasörüne kurun (varsayılan ~/ayakaleaf-toolkit).";; esac
    ;;
  *) hata "Desteklenmeyen sistem: $OS. Windows'ta bu betiği Ubuntu (WSL 2) terminalinde çalıştırın." ;;
esac
for k in git curl openssl python3; do command -v "$k" >/dev/null || hata "'$k' bulunamadı. Ubuntu: sudo apt install -y git curl openssl python3 perl gawk"; done

# ---------------------------------------------------------------- 2. Docker
if ! docker info >/dev/null 2>&1; then
  if [ "$OS" = "Darwin" ]; then
    hata "Docker çalışmıyor. Docker Desktop'ı kurup açın (https://docs.docker.com/desktop/setup/install/mac-install/), sonra betiği yeniden çalıştırın."
  fi
  if command -v docker >/dev/null; then
    hata "Docker kurulu ama erişilemiyor. Docker Desktop kullanıyorsanız açın ve Settings > Resources > WSL Integration'da bu dağıtımı etkinleştirin. Docker Engine kullanıyorsanız: sudo systemctl start docker; kullanıcı docker grubunda değilse 'sudo usermod -aG docker \$USER' sonrası terminali kapatıp açın."
  fi
  uyari "Docker bulunamadı."
  echo "    Seçenek A: Windows'a Docker Desktop kurun ve WSL Integration'ı açın (sonra betiği yeniden çalıştırın)."
  echo "    Seçenek B: Bu Linux'a Docker Engine kurulsun (sudo apt install docker.io docker-compose-v2)."
  if sor "Seçenek B ile Docker Engine şimdi kurulsun mu?"; then
    sudo apt-get update
    sudo apt-get install -y docker.io docker-compose-v2
    sudo usermod -aG docker "$USER"
    sudo systemctl enable --now docker 2>/dev/null || sudo service docker start
    bilgi "Docker kuruldu. Grup üyeliğinin geçerli olması için terminali kapatıp açın (Windows'ta: 'wsl --shutdown' gerekmez, yeni bir Ubuntu penceresi yeter) ve ./kur.sh'ı yeniden çalıştırın."
    exit 0
  fi
  exit 1
fi
docker compose version >/dev/null 2>&1 || hata "'docker compose' eklentisi yok. Ubuntu: sudo apt install docker-compose-v2"
bilgi "Docker hazır: $(docker version --format '{{.Server.Version}}')"

CPU="$(docker info --format '{{.NCPU}}')"; RAM_GB="$(( $(docker info --format '{{.MemTotal}}') / 1073741824 ))"
[ "$RAM_GB" -lt 4 ] && uyari "Docker'a ayrılan bellek ${RAM_GB} GB; en az 4 GB (önerilen 8 GB) verin."
BOS_GB="$(df -Pk "$HOME" | awk 'NR==2{print int($4/1048576)}')"
docker image inspect "$TEXLIVE" >/dev/null 2>&1 || { [ "$BOS_GB" -lt 50 ] && uyari "Boş disk ${BOS_GB} GB; TeX Live full imajı ve uygulama için en az 50 GB gerekir."; }
bilgi "Kaynaklar: ${CPU} CPU, ${RAM_GB} GB bellek, ${BOS_GB} GB boş disk."

# ---------------------------------------------------------------- 3. Toolkit
if [ ! -d "$DIZIN/.git" ]; then
  bilgi "AyakaLeaf Toolkit indiriliyor: $DIZIN"
  git clone -q "$TOOLKIT_GIT" "$DIZIN"
fi
cd "$DIZIN"
YENI=0
if [ ! -f config/overleaf.rc ]; then
  bin/init
  YENI=1
fi

rc_ayarla()  { if grep -q "^$1=" config/overleaf.rc; then sed -i "s|^$1=.*|$1=$2|" config/overleaf.rc; else echo "$1=$2" >> config/overleaf.rc; fi; }
env_ayarla() { if grep -q "^$1=" config/variables.env; then sed -i "s|^$1=.*|$1=$2|" config/variables.env; else echo "$1=$2" >> config/variables.env; fi; }

bilgi "Yapılandırma yazılıyor (config/overleaf.rc, config/variables.env)."
rc_ayarla SERVER_PRO true
rc_ayarla OVERLEAF_LISTEN_IP 127.0.0.1
rc_ayarla OVERLEAF_PORT "$PORT"
rc_ayarla SIBLING_CONTAINERS_ENABLED true
rc_ayarla DOCKER_SOCKET_PATH /var/run/docker.sock

env_ayarla OVERLEAF_APP_NAME '"SAÜ FBE LaTeX"'
env_ayarla OVERLEAF_SITE_URL "$URL"
env_ayarla OVERLEAF_SITE_LANGUAGE tr
grep -q '^OVERLEAF_SESSION_SECRET=' config/variables.env || env_ayarla OVERLEAF_SESSION_SECRET "$(openssl rand -hex 32)"
env_ayarla TEX_LIVE_DOCKER_IMAGE "$TEXLIVE"
env_ayarla ALL_TEX_LIVE_DOCKER_IMAGES "$TEXLIVE"
env_ayarla ALL_TEX_LIVE_DOCKER_IMAGE_NAMES '"TeX Live 2026"'
env_ayarla ENABLE_CONVERSIONS true
env_ayarla OVERLEAF_TEMPLATE_GALLERY true
env_ayarla OVERLEAF_TEMPLATE_CATEGORIES thesis
env_ayarla TEMPLATE_THESIS_NAME Tezler
env_ayarla TEMPLATE_THESIS_DESCRIPTION '"Lisansüstü tez şablonları"'
env_ayarla TEMPLATE_ALL_NAME '"Tüm şablonlar"'
env_ayarla TEMPLATE_ALL_DESCRIPTION '"Bütün şablonlar"'

# MongoDB, 6.19 - 7.0.13 arası Linux çekirdeklerinde çöker (AyakaLeaf belgesi); gerekiyorsa geçici çözüm.
KERNEL="$(docker info --format '{{.KernelVersion}}' | grep -oE '^[0-9]+\.[0-9]+(\.[0-9]+)?')"
IFS=. read -r KMAJ KMIN KPAT <<<"$KERNEL"; KPAT="${KPAT:-0}"
KSAY=$(( KMAJ * 1000000 + KMIN * 1000 + KPAT ))
if [ "$KSAY" -ge 6019000 ] && [ "$KSAY" -lt 7000014 ] && [ ! -f config/docker-compose.override.yml ]; then
  uyari "Docker çekirdeği $KERNEL MongoDB ile sorunlu; config/docker-compose.override.yml ile geçici çözüm ekleniyor."
  printf 'services:\n  mongo:\n    environment:\n      GLIBC_TUNABLES: glibc.pthread.rseq=1\n' > config/docker-compose.override.yml
fi

# ---------------------------------------------------------------- 4. başlat
bilgi "AyakaLeaf başlatılıyor. İlk çalıştırmada imajlar iner (TeX Live full diskte ~29 GB); bu, bağlantınıza göre uzun sürebilir."
bin/up -d

bilgi "Uygulamanın açılması bekleniyor: $URL"
for _ in $(seq 1 120); do
  curl -fsS -o /dev/null "$URL/launchpad" 2>/dev/null && break
  sleep 5
done
curl -fsS -o /dev/null "$URL/launchpad" || hata "Uygulama açılmadı. Günlük: cd $DIZIN && bin/docker-compose logs --tail=100 sharelatex"

# ---------------------------------------------------------------- 5. yönetici + şablon
echo
bilgi "Şimdi yönetici hesabı oluşturulacak (yoksa) ve tez şablonu galeriye yüklenecek."
echo "    Şifre en az 8 karakter olmalı ve e-postaya benzememeli."
sablon_yukle --yonetici-olustur

echo
bilgi "Kurulum tamam."
echo "    Adres     : $URL"
echo "    Şablon    : $URL/templates/thesis"
echo "    Toolkit   : $DIZIN   (durdur: bin/stop, başlat: bin/start)"
