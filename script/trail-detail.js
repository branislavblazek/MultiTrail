import { elevationChart } from "./elevation-chart.js";
import { parseTrack } from "./geo-utils.js";
import { showCursor, hideCursor } from "./map.js";
import { showDetailedGeometry } from "./trails.js";
import {
  showDetail,
  hideDetail,
  shownDetail,
  createStats,
  createSection,
} from "./detail-panel.js";
import { PLACES, shape } from "./labels.js";

/** Where the full resolution originals live, by slug. */
const GPX = (slug) => `./data/trails/${slug}.gpx`;

/** Parsed originals, so reopening a trail costs nothing. */
const cache = new Map();

/** What to tell the panel when the reader closes a detail. */
let dismissed = null;

/**
 * Registers what happens when a trail detail is closed. The panel lets go of
 * the trail then, so a closed detail never leaves a trail selected with
 * nothing to show for it.
 * @param {() => void} handler
 */
export function onTrailDetailClosed(handler) {
  dismissed = handler;
}

/**
 * Opens the full detail: numbers, description, tags, elevation profile and the
 * original file. The profile arrives late, since it is a separate fetch.
 * @param {*} map maplibre Map
 * @param {*} feature the trail to show
 */
export function openTrailDetail(map, feature) {
  const properties = feature.properties;
  const { slug, kind } = properties;
  const route = kind === "route";

  const body = [stats(properties), description(properties)];
  const tags = tagList(properties.tags);
  if (tags) body.push(tags);

  const section = createSection("Výškový profil");
  const profile = document.createElement("div");
  profile.className = "trailProfile";

  if (route) {
    profile.append(note("Načítavam profil…"));
    body.push(section.row, profile, downloadLink(slug));
  }

  showDetail({
    id: slug,
    eyebrow: route
      ? `Trasa · ${shape(properties.loop)}`
      : ["Miesto", PLACES[properties.place]].filter(Boolean).join(" · "),
    title: properties.name,
    body,
    onClose: () => {
      hideCursor(map);
      showDetailedGeometry(map, null);
      dismissed?.();
    },
  });

  if (route) loadProfile(map, properties, profile, section.aside);
}

/**
 * Closes the detail when it is this trail that is in it.
 * @param {string} slug
 */
export function closeTrailDetail(slug) {
  hideDetail(slug);
}

/**
 * Fetches the original track, draws its profile and puts the precise line on
 * the map in place of the simplified one.
 * @param {*} map maplibre Map
 * @param {*} properties of the trail
 * @param {HTMLElement} slot where the chart goes once it is ready
 * @param {HTMLElement} aside where the elevation range goes
 */
async function loadProfile(map, properties, slot, aside) {
  const { slug } = properties;
  const coords = await originalCoords(slug);

  // The reader may have moved on while this was in flight
  if (shownDetail() !== slug) return;

  if (!coords) {
    slot.replaceChildren(note("Profil pre túto trasu nie je dostupný."));
    return;
  }

  showDetailedGeometry(map, slug, coords);

  const chart = elevationChart({
    coords,
    onHover: (_index, coord) => showCursor(map, coord, "#0f766e"),
    onLeave: () => hideCursor(map),
  });

  if (!chart) {
    slot.replaceChildren(note("Táto trasa nemá výškové údaje."));
    return;
  }

  slot.replaceChildren(
    chart.element,
    note("Potiahnutím po profile presuniete bod na mape"),
  );

  aside.textContent =
    `${Math.round(chart.profile.minEle)}–` +
    `${Math.round(chart.profile.maxEle)} m`;
}

/**
 * The points of the original GPX, fetched once and kept.
 * @param {string} slug
 * @returns {Promise<[number, number, number?][]|null>}
 */
async function originalCoords(slug) {
  if (cache.has(slug)) return cache.get(slug);

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

  cache.set(slug, coords);

  return coords;
}

/**
 * The three numbers a route is judged by, or the altitude of a place.
 * @param {*} properties
 * @returns {HTMLElement}
 */
function stats(properties) {
  if (properties.kind === "place") {
    return createStats([
      { value: String(properties.ele_m ?? "—"), label: "m n. m." },
    ]);
  }

  return createStats([
    { value: (properties.distance_m / 1000).toFixed(1), label: "km" },
    { value: String(properties.ascent_m), label: "↑ m" },
    { value: String(properties.descent_m), label: "↓ m" },
  ]);
}

/**
 * The authored description. Slovak for now, whatever is there as a fallback.
 * @param {*} properties
 * @returns {HTMLElement}
 */
function description(properties) {
  const text = properties.description ?? {};

  const el = document.createElement("p");
  el.className = "trailDescription";
  el.textContent = text.sk ?? Object.values(text)[0] ?? "";

  return el;
}

/**
 * The authored tags. Labels, not buttons: filtering by them is the panel's
 * job and it is a click away up there.
 * @param {string[]} [tags]
 * @returns {HTMLElement|null} null when there are none
 */
function tagList(tags) {
  if (!tags?.length) return null;

  const row = document.createElement("div");
  row.className = "trailTags";

  row.append(
    ...tags.map((tag) => {
      const el = document.createElement("span");
      el.className = "trailTag";
      el.textContent = tag;

      return el;
    }),
  );

  return row;
}

/**
 * A link to the original file. A plain anchor, so the browser saves the
 * static file itself.
 * @param {string} slug
 * @returns {HTMLElement}
 */
function downloadLink(slug) {
  const el = document.createElement("a");
  el.className = "trailDownload";
  el.href = GPX(slug);
  el.download = `${slug}.gpx`;
  el.textContent = "Stiahnuť GPX ↓";

  return el;
}

/**
 * A quiet line of text.
 * @param {string} text
 * @returns {HTMLElement}
 */
function note(text) {
  const el = document.createElement("p");
  el.className = "trailNote";
  el.textContent = text;

  return el;
}
