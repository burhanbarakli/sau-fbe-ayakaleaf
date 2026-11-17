#!/bin/bash
# SAU FBE LaTeX (AyakaLeaf) - macOS baslatici. Cift tiklayin; Terminal penceresi acik kaldikca calisir.
cd "$(dirname "$0")" || exit 1
# Internetten indirilen paketteki karantina isaretini kaldir; yoksa macOS her programi tek tek engeller.
xattr -dr com.apple.quarantine . 2>/dev/null
./app/node/bin/node app/baslat.mjs
echo
read -n 1 -s -r -p "Pencereyi kapatabilirsiniz (ya da bir tusa basin)."
