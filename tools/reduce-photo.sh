#!/bin/zsh
# Zaradi stiahnutu fotku k trase: vezme data/images/tmp.jpg, zmensi ju na
# SIRKU max 2000 px a JPEG kvalitu 72, a presune do data/images/<slug>/image.jpg.
# Sirkovy limit preto, ze hero je full-bleed a object-fit: cover skaluje
# podla sirky - portretova fotka orezana cez dlhsiu stranu by mala sirku
# len ~1200 px a na desktope by bola rozmazana.
# Pouzitie: tools/reduce-photo.sh sk-ovciarsko-peklina
# Fotku najprv uloz ako data/images/tmp.jpg; original mas vzdy v Strave /
# Google Photos, takze existujuci image.jpg trasy sa prepisuje bez otazky.

set -e
CAP=2000
QUALITY=72

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

folder=$ROOT/data/images/$slug
target=$folder/image.jpg
tmp=$folder/image.tmp.jpg

mkdir -p $folder

if [[ -f $target ]]; then
  echo "$slug: prepisujem existujuci image.jpg"
fi

before=$(stat -f%z $SOURCE)
w=$(sips -g pixelWidth  $SOURCE | awk '/pixelWidth/  {print $2}')
h=$(sips -g pixelHeight $SOURCE | awk '/pixelHeight/ {print $2}')

if [ "$w" -gt "$CAP" ]; then
  sips --resampleWidth $CAP -s format jpeg -s formatOptions $QUALITY $SOURCE --out $tmp > /dev/null
else
  sips -s format jpeg -s formatOptions $QUALITY $SOURCE --out $tmp > /dev/null
fi

after=$(stat -f%z $tmp)
if [ "$after" -lt "$before" ]; then
  mv $tmp $target
  rm $SOURCE
  printf "%s/image.jpg: %d kB -> %d kB (%dx%d -> sirka max %d px)\n" "$slug" $((before/1024)) $((after/1024)) "$w" "$h" $CAP
else
  # Zmensenie by fotku nafuklo, tak ide dovnutra tak, ako prisla
  rm $tmp
  mv $SOURCE $target
  printf "%s/image.jpg: uz je mensi nez by vysiel, presuvam original (%d kB)\n" "$slug" $((before/1024))
fi
