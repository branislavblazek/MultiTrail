import { elevationChart } from "./elevation-chart.js";
import { parseTrack } from "./geo-utils.js";
import { showCursor, hideCursor, showPopup } from "./map.js";
import { COLOR, showDetailedGeometry } from "./trails.js";
import {
  showDetail,
  updateDetail,
  hideDetail,
  shownDetail,
} from "./detail-panel.js";

/** Where the full resolution originals live, by slug. */
const GPX = (slug) => `./data/trails/${slug}.gpx`;

/** Parsed originals, so reopening a trail costs nothing. */
const cache = new Map();

/** Only one popup is ever open. */
let popup = null;

/**
 * Opens the short popup on the map: the name, the numbers, and a way in.
 * @param {*} map maplibre Map
 * @param {*} feature the trail that was clicked
 * @param {*} lngLat where to anchor the popup
 */
export function openTrailPopup(map, feature, lngLat) {
  const properties = feature.properties;

  const content = document.createElement("div");
  content.className = "trailPopup";

  const name = document.createElement("strong");
  name.textContent = properties.name;

  const meta = document.createElement("span");
  meta.className = "trailPopupMeta";
  meta.textContent = summarise(properties);

  const open = document.createElement("button");
  open.className = "trailPopupOpen";
  open.textContent = "Detail";
  open.addEventListener("click", () => openTrailDetail(map, feature));

  content.append(name, meta, open);

  closeTrailPopup();
  popup = showPopup(map, lngLat, content);
}

/**
 * Closes the popup, if one is open.
 */
export function closeTrailPopup() {
  popup?.remove();
  popup = null;
}

/**
 * Opens the full detail: description, numbers, elevation profile and the
 * original file. The profile arrives late, since it is a separate fetch.
 * @param {*} map maplibre Map
 * @param {*} feature the trail to show
 */
export function openTrailDetail(map, feature) {
  const properties = feature.properties;
  const { slug, kind } = properties;

  closeTrailPopup();

  const body = [description(properties), tagList(properties.tags)].filter(
    Boolean,
  );
  const profile = document.createElement("div");

  if (kind === "route") {
    profile.className = "trailProfile";
    profile.append(note("Loading profile…"));
    body.push(profile, downloadLink(slug));
  } else if (properties.ele_m) {
    body.push(note(`${properties.place ?? "Place"} · ${properties.ele_m} m`));
  }

  showDetail({
    id: slug,
    title: properties.name,
    meta: summarise(properties),
    body,
    onClose: () => {
      hideCursor(map);
      showDetailedGeometry(map, null);
    },
  });

  if (kind === "route") loadProfile(map, properties, profile);
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
 */
async function loadProfile(map, properties, slot) {
  const { slug } = properties;
  const coords = await originalCoords(slug);

  // The reader may have moved on while this was in flight
  if (shownDetail() !== slug) return;

  if (!coords) {
    slot.replaceChildren(note("Profile is not available for this trail."));
    return;
  }

  showDetailedGeometry(map, slug, coords);

  const chart = elevationChart({
    coords,
    color: COLOR,
    onHover: (_index, coord) => showCursor(map, coord, COLOR),
    onLeave: () => hideCursor(map),
  });

  if (!chart) {
    slot.replaceChildren(note("This trail carries no elevation data."));
    return;
  }

  slot.replaceChildren(chart.element);
  updateDetail(slug, {
    meta:
      `${summarise(properties)} · ` +
      `↕ ${Math.round(chart.profile.minEle)}–${Math.round(chart.profile.maxEle)} m`,
  });
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
 * The numbers of a trail as one line, the same in the popup and the panel.
 * @param {*} properties
 * @returns {string}
 */
function summarise(properties) {
  if (properties.kind === "place") {
    return [properties.place, properties.region, properties.country]
      .filter(Boolean)
      .join(" · ");
  }

  const sports = Object.entries(properties.sports ?? {})
    .map(([sport, value]) =>
      value.duration_min ? `${sport} ${duration(value.duration_min)}` : sport,
    )
    .join(", ");

  return [
    `${(properties.distance_m / 1000).toFixed(1)} km`,
    `↑ ${properties.ascent_m} m`,
    `↓ ${properties.descent_m} m`,
    sports,
    [properties.region, properties.country].filter(Boolean).join(", "),
  ]
    .filter(Boolean)
    .join(" · ");
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
  el.textContent = "⬇ GPX";

  return el;
}

/**
 * Minutes as hours and minutes once it passes an hour.
 * @param {number} minutes
 * @returns {string}
 */
function duration(minutes) {
  if (minutes < 60) return `${minutes} min`;

  const rest = minutes % 60;

  return rest ? `${Math.floor(minutes / 60)} h ${rest}` : `${minutes / 60} h`;
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
