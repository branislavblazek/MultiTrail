#!/bin/zsh
# Zmensi fotky pre data/images: SIRKA max 2000 px, JPEG kvalita 72.
# Sirkovy limit preto, ze hero je full-bleed a object-fit: cover skaluje
# podla sirky - portretova fotka orezana cez dlhsiu stranu by mala sirku
# len ~1200 px a na desktope by bola rozmazana.
# Pouzitie: tools/reduce-photo.sh subor.jpg [dalsi.jpg ...]
# Prepisuje subory na mieste; original mas vzdy v Strave / Google Photos.

set -e
CAP=2000
QUALITY=72

for f in "$@"; do
  [ -f "$f" ] || { echo "preskakujem, nie je subor: $f"; continue }

  before=$(stat -f%z "$f")
  w=$(sips -g pixelWidth  "$f" | awk '/pixelWidth/  {print $2}')
  h=$(sips -g pixelHeight "$f" | awk '/pixelHeight/ {print $2}')

  tmp="${f%.jpg}.tmp.jpg"
  if [ "$w" -gt "$CAP" ]; then
    sips --resampleWidth $CAP -s format jpeg -s formatOptions $QUALITY "$f" --out "$tmp" > /dev/null
  else
    sips -s format jpeg -s formatOptions $QUALITY "$f" --out "$tmp" > /dev/null
  fi

  after=$(stat -f%z "$tmp")
  if [ "$after" -lt "$before" ]; then
    mv "$tmp" "$f"
    printf "%s: %d kB -> %d kB (%dx%d -> sirka max %d px)\n" "$f" $((before/1024)) $((after/1024)) "$w" "$h" $CAP
  else
    rm "$tmp"
    printf "%s: uz je mensi nez by vysiel, nechavam (%d kB)\n" "$f" $((before/1024))
  fi
done
