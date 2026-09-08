#!/bin/zsh
# Zmensi fotky pre data/images: dlhsia strana max 1600 px, JPEG kvalita 72.
# Pouzitie: tools/reduce-photo.sh subor.jpg [dalsi.jpg ...]
# Prepisuje subory na mieste; original mas vzdy v Strave / Google Photos.

set -e
CAP=1600
QUALITY=72

for f in "$@"; do
  [ -f "$f" ] || { echo "preskakujem, nie je subor: $f"; continue }

  before=$(stat -f%z "$f")
  w=$(sips -g pixelWidth  "$f" | awk '/pixelWidth/  {print $2}')
  h=$(sips -g pixelHeight "$f" | awk '/pixelHeight/ {print $2}')
  max=$(( w > h ? w : h ))

  tmp="${f%.jpg}.tmp.jpg"
  if [ "$max" -gt "$CAP" ]; then
    sips --resampleHeightWidthMax $CAP -s format jpeg -s formatOptions $QUALITY "$f" --out "$tmp" > /dev/null
  else
    sips -s format jpeg -s formatOptions $QUALITY "$f" --out "$tmp" > /dev/null
  fi

  after=$(stat -f%z "$tmp")
  if [ "$after" -lt "$before" ]; then
    mv "$tmp" "$f"
    printf "%s: %d kB -> %d kB (%dx%d -> max %d px)\n" "$f" $((before/1024)) $((after/1024)) "$w" "$h" $CAP
  else
    rm "$tmp"
    printf "%s: uz je mensi nez by vysiel, nechavam (%d kB)\n" "$f" $((before/1024))
  fi
done
