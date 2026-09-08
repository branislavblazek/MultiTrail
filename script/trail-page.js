import {
  createMap,
  addTrackLayer,
  fitToTrack,
  showCursor,
  hideCursor,
} from "./map.js";
import { parseTrack } from "./geo-utils.js";
import { copyText } from "./publish.js";
import { elevationChart } from "./elevation-chart.js";
import { createStats, createSection } from "./detail-panel.js";
import { COLOR } from "./trails.js";
import {
  SPORTS,
  PLACES,
  COUNTRIES,
  DIFFICULTY,
  shape,
  duration,
} from "./labels.js";

const TRAILS = "./data/trails.geojson";
const GPX = (slug) => `./data/trails/${slug}.gpx`;

/**
 * Fills the standalone trail page, driven by ?t=<slug> in the url. The page
 * reads the same trails.geojson and gpx the map does, so there is no second
 * copy of any content to drift away.
 */
export async function initTrailPage() {
  const slug = new URLSearchParams(location.search).get("t");
  const feature = slug ? await findTrail(slug) : null;

  if (!feature) {
    renderMissing(slug);
    return;
  }

  const properties = feature.properties;
  const route = properties.kind === "route";

  document.title = `${properties.name} · MultiTrail`;

  // Back lands on the map with this trail already selected
  document.getElementById("pageBack").href =
    `./#trail=${encodeURIComponent(properties.slug)}`;

  renderHero(properties);
  renderHead(properties, route);
  renderStats(properties, route);
  renderSports(properties);
  renderText(properties);

  // The map sits inside a scrolling article, so one finger scrolls the page
  // and the map only moves with two, google-maps style; ctrl+wheel to zoom
  const map = await createMap("pageMap", {
    cooperativeGestures: true,
    locale: {
      "CooperativeGesturesHandler.WindowsHelpText":
        "Mapu priblížiš s Ctrl + koliesko",
      "CooperativeGesturesHandler.MacHelpText":
        "Mapu priblížiš s ⌘ + koliesko",
      "CooperativeGesturesHandler.MobileHelpText":
        "Mapu posunieš dvomi prstami",
    },
  });

  if (route) {
    drawRoute(map, feature);
    await loadProfile(map, properties, feature);
  } else {
    drawPlace(map, feature);
    renderWeather(
      weatherAnchor(properties, pointOf(feature), properties.ele_m, "toto miesto"),
    );
  }

  renderStrava(properties.strava_id, properties.strava_token);
  renderParking(properties.parking);
  renderShare(properties.name);
}

/**
 * The trail this url points at.
 * @param {string} slug
 * @returns {Promise<*>} feature, or null
 */
async function findTrail(slug) {
  try {
    const response = await fetch(TRAILS);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const collection = await response.json();

    return (
      (collection.features ?? []).find((f) => f.properties.slug === slug) ??
      null
    );
  } catch (err) {
    console.error(`Could not load ${TRAILS}:`, err);
    return null;
  }
}

/**
 * The authored photo above the header. The image property names a file in
 * data/images/<slug>/, so the photo keeps whatever name it came with. Shown
 * only once it actually loads, so a typo cannot leave a broken frame behind.
 * @param {*} properties
 */
function renderHero(properties) {
  const { slug, image, name } = properties;
  if (!image) return;

  const hero = document.getElementById("pageHero");
  hero.alt = name;
  hero.addEventListener("load", () => {
    hero.hidden = false;
  });
  hero.src = `./data/images/${encodeURIComponent(slug)}/${encodeURIComponent(image)}`;
}

/**
 * Eyebrow, name and where the trail is.
 * @param {*} properties
 * @param {boolean} route
 */
function renderHead(properties, route) {
  document.getElementById("pageEyebrow").textContent = route
    ? `Trasa · ${shape(properties.loop)}`
    : ["Miesto", PLACES[properties.place]].filter(Boolean).join(" · ");

  document.getElementById("pageTitle").textContent = properties.name;

  document.getElementById("pageWhere").textContent = [
    properties.region,
    COUNTRIES[properties.country] ?? properties.country,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * The numbers a route is judged by, or the altitude of a place.
 * @param {*} properties
 * @param {boolean} route
 */
function renderStats(properties, route) {
  const stats = route
    ? [
        { value: (properties.distance_m / 1000).toFixed(1), label: "km" },
        { value: String(properties.ascent_m), label: "↑ m" },
        { value: String(properties.descent_m), label: "↓ m" },
      ]
    : [{ value: String(properties.ele_m ?? "—"), label: "m n. m." }];

  document.getElementById("pageStats").replaceChildren(createStats(stats));
}

/**
 * One row per sport: name, duration and difficulty.
 * @param {*} properties
 */
function renderSports(properties) {
  const sports = Object.entries(properties.sports ?? {});
  const el = document.getElementById("pageSports");

  el.hidden = sports.length === 0;
  el.replaceChildren(
    ...sports.map(([sport, value]) => {
      const row = document.createElement("div");
      row.className = "pageSport";

      const name = document.createElement("strong");
      name.textContent = SPORTS[sport] ?? sport;

      const meta = document.createElement("span");
      meta.textContent = [
        value.duration_min ? duration(value.duration_min) : null,
        DIFFICULTY[value.difficulty] ?? value.difficulty ?? null,
      ]
        .filter(Boolean)
        .join(" · ");

      row.append(name, meta);
      return row;
    }),
  );
}

/**
 * Description and tags.
 * @param {*} properties
 */
function renderText(properties) {
  const text = properties.description ?? {};
  const description = document.getElementById("pageDescription");
  description.textContent = text.sk ?? Object.values(text)[0] ?? "";
  description.hidden = !description.textContent;

  const tags = properties.tags ?? [];
  const row = document.getElementById("pageTags");
  row.hidden = tags.length === 0;
  row.replaceChildren(
    ...tags.map((tag) => {
      const el = document.createElement("span");
      el.className = "trailTag";
      el.textContent = tag;
      return el;
    }),
  );
}

/**
 * The overview geometry, drawn the moment the map is ready. The precise line
 * replaces it once the gpx arrives.
 * @param {*} map maplibre Map
 * @param {*} feature
 */
function drawRoute(map, feature) {
  addTrackLayer(map, {
    id: "trail",
    geoJson: { type: "FeatureCollection", features: [feature] },
    style: { width: 4, color: COLOR, opacity: 1, visible: true },
  });

  fitToTrack(map, feature);
}

/**
 * A place is one dot.
 * @param {*} map maplibre Map
 * @param {*} feature
 */
function drawPlace(map, feature) {
  map.addSource("trail", { type: "geojson", data: feature });

  map.addLayer({
    id: "trail--point",
    type: "circle",
    source: "trail",
    paint: {
      "circle-color": COLOR,
      "circle-radius": 8,
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
    },
  });

  map.jumpTo({ center: pointOf(feature), zoom: 13 });
}

/**
 * Fetches the original track, swaps it onto the map, draws the profile and
 * offers the file. The weather widget waits for it too, because only the gpx
 * knows the altitude.
 * @param {*} map maplibre Map
 * @param {*} properties
 * @param {*} feature the overview feature, the fallback for everything
 */
async function loadProfile(map, properties, feature) {
  const { slug } = properties;
  const section = document.getElementById("pageProfile");
  let coords = null;

  try {
    const response = await fetch(GPX(slug));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const geoJson = parseTrack(`${slug}.gpx`, await response.text());
    const line = geoJson.features?.find(
      (f) => f.geometry?.type === "LineString",
    );

    coords = line ? line.geometry.coordinates : null;
  } catch (err) {
    console.error(`Could not load ${GPX(slug)}:`, err);
  }

  if (!coords) {
    renderWeather(weatherAnchor(properties, pointOf(feature), 0, "štart trasy"));
    return;
  }

  // The 10 m overview line gives way to the real one
  map.getSource("trail").setData({
    type: "FeatureCollection",
    features: [
      { ...feature, geometry: { ...feature.geometry, coordinates: coords } },
    ],
  });

  const chart = elevationChart({
    coords,
    onHover: (_index, coord) => showCursor(map, coord, COLOR),
    onLeave: () => hideCursor(map),
  });

  if (chart) {
    const head = createSection("Výškový profil");
    head.aside.textContent =
      `${Math.round(chart.profile.minEle)}–` +
      `${Math.round(chart.profile.maxEle)} m`;

    section.hidden = false;
    section.replaceChildren(head.row, chart.element);
  }

  const download = document.getElementById("pageDownload");
  download.hidden = false;
  download.href = GPX(slug);
  download.download = `${slug}.gpx`;

  // Mountain weather is decided up top, so the forecast anchors there
  const top = coords.reduce(
    (best, coord) => ((coord[2] ?? -1) > (best[2] ?? -1) ? coord : best),
    coords[0],
  );

  renderWeather(weatherAnchor(properties, top, top[2], "najvyšší bod trasy"));
}

/**
 * Where the forecast is for: the highest point of the track by default, or
 * whatever an authored weather_point says instead. Two authored shapes work:
 * [lng, lat, ele] coordinates, or a meteoblue location id as a string
 * ("zilina_slovensko_3056508" — a pasted meteoblue url is forgiven, the last
 * path segment is all that is kept).
 * @param {*} properties
 * @param {[number, number, number?]} fallback [lng, lat, ele?]
 * @param {number} [fallbackAltitude] meters
 * @param {string} fallbackLabel what the fallback point is, for the note
 * @returns {{ at?: [number, number, number], id?: string, label: string }}
 */
function weatherAnchor(properties, fallback, fallbackAltitude, fallbackLabel) {
  const point = properties.weather_point;

  if (typeof point === "string" && point.trim()) {
    const id = point.trim().split("?")[0].split("/").filter(Boolean).at(-1);

    return { id, label: "určené miesto" };
  }

  if (Array.isArray(point) && point.length >= 2) {
    return {
      at: [point[0], point[1], point[2] ?? fallbackAltitude ?? 0],
      label: "určený bod",
    };
  }

  return {
    at: [fallback[0], fallback[1], fallbackAltitude ?? 0],
    label: fallbackLabel,
  };
}

/**
 * The meteoblue daily widget, an iframe pointed at the anchor. Free and
 * loginless; the altitude sharpens a coordinate forecast, a location id
 * carries its own.
 * @param {{ at?: [number, number, number], id?: string, label: string }} anchor
 */
function renderWeather({ at, id, label }) {
  let spot;

  if (id) {
    spot = encodeURIComponent(id);
  } else {
    const [lng, lat, altitude] = at;
    const ns = lat >= 0 ? "N" : "S";
    const ew = lng >= 0 ? "E" : "W";

    spot =
      `${Math.abs(lat).toFixed(3)}${ns}` +
      `${Math.abs(lng).toFixed(3)}${ew}` +
      `${Math.round(altitude ?? 0)}_UTC`;
  }

  const frame = document.getElementById("weatherFrame");
  frame.src =
    `https://www.meteoblue.com/en/weather/widget/daily/${spot}` +
    `?geoloc=fixed&days=4&tempunit=CELSIUS&windunit=KILOMETER_PER_HOUR` +
    `&precipunit=MILLIMETER&coloured=coloured&pictoicon=1` +
    `&maxtemperature=1&mintemperature=1&windspeed=1` +
    `&precipitation=1&precipitationprobability=1`;

  const altitude = at?.[2];
  const where = document.getElementById("weatherNote");
  where.textContent =
    `Predpoveď pre ${label}` +
    (altitude ? ` (${Math.round(altitude)} m n. m.)` : "");

  document.getElementById("pageWeather").hidden = false;
}

/**
 * The native share sheet where there is one, the clipboard where there is
 * not. Hidden only when the browser offers neither.
 * @param {string} name of the trail, for the share payload
 */
function renderShare(name) {
  if (!navigator.share && !navigator.clipboard) return;

  const button = document.getElementById("pageShare");
  button.hidden = false;

  button.addEventListener("click", async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: name, url: location.href });
      } catch {
        // The reader closed the sheet, nothing to do
      }
      return;
    }

    const copied = await copyText(location.href);
    flash(button, copied ? "Odkaz skopírovaný ✓" : "Skopíruj adresu stránky");
  });
}

/**
 * Shows a message on a button for a moment, then puts its label back.
 * @param {HTMLElement} button
 * @param {string} text
 */
function flash(button, text) {
  const label = button.textContent;

  button.textContent = text;
  setTimeout(() => {
    button.textContent = label;
  }, 2000);
}

/**
 * The way to the trailhead. An authored parking of [lng, lat] becomes a
 * Google Maps directions link; an authored url string is used as it is.
 * @param {[number, number]|string} [parking]
 */
function renderParking(parking) {
  let href = null;

  if (typeof parking === "string" && parking.trim()) {
    href = parking.trim();
  } else if (Array.isArray(parking) && parking.length >= 2) {
    const [lng, lat] = parking;
    href = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  }

  if (!href) return;

  const button = document.getElementById("pageParking");
  button.href = href;
  button.hidden = false;
}

/**
 * The official Strava embed. Both values come from Strava's own "Create your
 * custom embed" dialog on the activity page: data-embed-id and data-token.
 * Without the token the embed service answers "This content is unavailable",
 * whatever the privacy settings say.
 * @param {string} [activity] the authored strava_id property; a pasted
 *   activity url is forgiven, the digits are all that is kept
 * @param {string} [token] the authored strava_token property
 */
function renderStrava(activity, token) {
  const id = /(\d{5,})/.exec(activity ?? "")?.[1];
  if (!id) return;

  const placeholder = document.createElement("div");
  placeholder.className = "strava-embed-placeholder";
  placeholder.dataset.embedType = "activity";
  placeholder.dataset.embedId = id;
  placeholder.dataset.style = "standard";

  if (token) {
    placeholder.dataset.token = token;
    placeholder.dataset.fromEmbed = "false";
  }

  document.getElementById("stravaSlot").replaceChildren(placeholder);
  document.getElementById("pageStrava").hidden = false;

  const script = document.createElement("script");
  script.src = "https://strava-embeds.com/embed.js";
  document.body.append(script);
}

/**
 * What the page says when the url points nowhere.
 * @param {string|null} slug
 */
function renderMissing(slug) {
  document.title = "Trasa sa nenašla · MultiTrail";
  document.getElementById("pageEyebrow").textContent = "MultiTrail";
  document.getElementById("pageTitle").textContent = "Trasa sa nenašla";
  document.getElementById("pageWhere").textContent = slug
    ? `Nič sa tu nevolá „${slug}“. Skús to z mapy.`
    : "Tejto stránke chýba adresa trasy. Skús to z mapy.";

  document.getElementById("pageMap").hidden = true;
}

/**
 * Where a point feature sits.
 * @param {*} feature
 * @returns {[number, number]}
 */
function pointOf(feature) {
  return feature.geometry.type === "Point"
    ? feature.geometry.coordinates
    : feature.geometry.coordinates[0];
}
