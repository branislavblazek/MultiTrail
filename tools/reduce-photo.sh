#!/bin/zsh
# Zaradi stiahnutu fotku k trase: vezme data/images/tmp.jpg, oreze ju na pomer
# 3:2, zmensi na SIRKU max 2000 px a ulozi ako WebP do
# data/images/<slug>/image.webp.
#
# Orez na 3:2, lebo hero ma object-fit: cover a pomer 3/2 na mobile a 3/1 na
# desktope - z vyssej fotky sa teda nikdy neukaze viac nez w*2/3 riadkov.
# Portret 2000x2666 tak posielal polovicu pixelov rovno do kosa. Orez je
# centrovany, cize presne to, co browser aj tak urobi sam, len uz pred
# stiahnutim. Sirsiu fotku (napr. 16:9) nechavame tak: orez by ju zuzil a
# cover skaluje prave podla sirky.
#
# Sirkovy limit preto, ze hero je full-bleed a cover skaluje podla sirky -
# portretova fotka orezana cez dlhsiu stranu by mala sirku len ~1200 px a na
# desktope by bola rozmazana.
#
# WebP preto, ze pri rovnako vyzerajucej kvalite je subor zhruba polovicny
# oproti JPEG - a hero je LCP element stranky trasy.
#
# Pouzitie: tools/reduce-photo.sh sk-ovciarsko-peklina
# Fotku najprv uloz ako data/images/tmp.jpg; original mas vzdy v Strave /
# Google Photos, takze existujuca fotka trasy sa prepisuje bez otazky.

set -e
CAP=2000
QUALITY=78

# Cesty od korena repa, aby sa tool dal pustit z hociktoreho priecinka
ROOT=${0:A:h:h}
SOURCE=$ROOT/data/images/tmp.jpg

slug=$1

if [[ -z $slug || -n $2 ]]; then
  print -u2 "pouzitie: tools/reduce-photo.sh <slug>"
  exit 1
fi

# Slug, nie nazov suboru: preklep by inak vyrobil priecinok, ktory nikto nema
if [[ ! $slug =~ '^[a-z0-9]+(-[a-z0-9]+)*$' ]]; then
  print -u2 "$slug: nie je slug (male pismena, cisla a spojovniky)"
  exit 1
fi

if [[ ! -f $SOURCE ]]; then
  print -u2 "chyba data/images/tmp.jpg - stiahnutu fotku uloz sem"
  exit 1
fi

if ! command -v cwebp > /dev/null; then
  print -u2 "chyba cwebp - nainstaluj ho cez: brew install webp"
  exit 1
fi

folder=$ROOT/data/images/$slug
target=$folder/image.webp
tmp=$folder/image.tmp.webp
stale=$folder/image.jpg

mkdir -p $folder

if [[ -f $target ]]; then
  echo "$slug: prepisujem existujuci image.webp"
fi

before=$(stat -f%z $SOURCE)
w=$(sips -g pixelWidth  $SOURCE | awk '/pixelWidth/  {print $2}')
h=$(sips -g pixelHeight $SOURCE | awk '/pixelHeight/ {print $2}')

# cwebp orezava pred zmensenim, takze suradnice su v rozmeroch originalu
crop=()
keep=$(( w * 2 / 3 ))
if (( h > keep )); then
  crop=(-crop 0 $(( (h - keep) / 2 )) $w $keep)
fi

resize=()
if (( w > CAP )); then
  resize=(-resize $CAP 0)
fi

cwebp -quiet -q $QUALITY $crop $resize $SOURCE -o $tmp

after=$(stat -f%z $tmp)
fw=$(sips -g pixelWidth  $tmp | awk '/pixelWidth/  {print $2}')
fh=$(sips -g pixelHeight $tmp | awk '/pixelHeight/ {print $2}')

mv $tmp $target
rm $SOURCE

# Stary jpg by inak zostal lezat vedla noveho webp a mohol by sa dostat do gitu
if [[ -f $stale ]]; then
  rm $stale
  echo "$slug: mazem stary image.jpg - v trails.geojson prepis \"image\" na \"image.webp\""
fi

printf "%s/image.webp: %d kB -> %d kB (%dx%d -> %dx%d)\n" \
  "$slug" $((before/1024)) $((after/1024)) "$w" "$h" "$fw" "$fh"

if (( after >= before )); then
  echo "$slug: pozor, vysledok nie je mensi nez zdroj - nebola uz fotka zmensena?"
fi
