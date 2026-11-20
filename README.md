# MultiTrail

## Admin režim (len lokálne)

Trasy sa dajú pridávať a upravovať priamo v appke. Stačí ju otvoriť cez
lokálny admin server namiesto obyčajného statického:

```sh
node tools/admin-server.mjs        # http://localhost:8000
node tools/admin-server.mjs 8010   # iný port
```

Appka si server nájde sama a zapne admin režim: pri logu sa objaví štítok
`ADMIN`, vpravo hore tlačidlo **Nová trasa** a v karte každej trasy
**Upraviť trasu**. Uloženie zapíše:

- `data/trails.geojson` – v rovnakom formáte, v akom ho necháva Prettier,
  takže v gite vidno len to, čo sa naozaj zmenilo,
- `data/trails/<slug>.gpx` – pri novej trase alebo po výmene GPX,
- `data/images/<slug>/image.webp` – fotka prejde cez `tools/reduce-photo.sh`
  (treba `cwebp`: `brew install webp`).

### Trasa zo Stravy

Trasu netreba sťahovať ako GPX: editor si ju vie vypýtať od Stravy. Pri novej
trase stačí vložiť embed kód do poľa Strava ID, pri existujúcej kliknúť na
**Načítať zo Stravy**. Ide to len pri vlastných aktivitách.

Samotný embed kód trasu neobsahuje (Strava cezeň vydá len obrázok mapy), takže
to ide cez oficiálne Strava API a treba ho raz pripojiť:

1. Na <https://www.strava.com/settings/api> si vytvor aplikáciu. Do
   *Authorization Callback Domain* daj `localhost`, ostatné polia sú ľubovoľné.
2. Pri prvom načítaní si editor vypýta jej *Client ID* a *Client Secret* a
   otvorí okno Stravy, kde potvrdíš prístup k aktivitám.

Údaje aj prístup sa uložia do `~/.config/multitrail/strava.json`, mimo
projektu, takže sa nedostanú do gitu ani na web. Zmazaním súboru sa Strava
odpojí.

Na produkcii server nebeží, takže tam editor nenabehne: mimo `localhost` sa
appka na admin ani nepýta a editor ani jeho štýly sa nenačítajú. Server
počúva len na `127.0.0.1` a nemá žiadne závislosti.

Na `localhost` sa samé zapnú aj autorské nástroje v paneli **Moje trasy**
(publikovanie nahratého GPX cez 📤). Žiadny parameter v adrese na to netreba
a mimo `localhost` sa zapnúť nedajú. Fungujú aj s obyčajným statickým
serverom. Zapisovať do `data/` vie len editor cez admin server.
