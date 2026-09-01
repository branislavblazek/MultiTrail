import { elevationChart } from "./elevation-chart.js";
import { showCursor, hideCursor } from "./map.js";
import { showDetail, hideDetail, shownDetail } from "./detail-panel.js";

/** The map the cursor is drawn on, and the button that opened the panel. */
let mapRef = null;
let shownButton = null;

/**
 * Remembers the map the graph cursor marks its position on.
 * @param {*} map maplibre Map
 */
export function initLayerDetail(map) {
  mapRef = map;
}

/**
 * Shows the profile of a layer in the shared panel, or closes it again.
 * @param {*} state layer state
 * @param {HTMLElement} button the details button of that layer
 */
export function toggleLayerDetail(state, button) {
  if (shownDetail() === state.id) {
    hideDetail(state.id);
    return;
  }

  const color = state.style.color;

  const chart = elevationChart({
    coords: state.coords,
    color,
    onHover: (_index, coord) => showCursor(mapRef, coord, color),
    onLeave: () => hideCursor(mapRef),
  });

  shownButton = button;
  button.classList.add("active");

  showDetail({
    id: state.id,
    title: state.name,
    meta: describe(state.stats, chart?.profile),
    body: [chart ? chart.element : message("This track carries no elevation data.")],
    onClose: () => {
      hideCursor(mapRef);
      shownButton?.classList.remove("active");
      shownButton = null;
    },
  });
}

/**
 * Closes the panel when it is this layer that is in it.
 * @param {string} id layer id
 */
export function hideLayerDetail(id) {
  hideDetail(id);
}

/**
 * The measured numbers of a track as one line.
 * @param {*} stats distance, ascent and descent in meters
 * @param {*} profile elevation profile, or undefined without elevation
 * @returns {string}
 */
function describe({ distance, ascent, descent }, profile) {
  const parts = [`${(distance / 1000).toFixed(1)} km`];

  if (ascent === null || !profile) {
    parts.push("no elevation");
  } else {
    parts.push(
      `↑ ${Math.round(ascent)} m`,
      `↓ ${Math.round(descent)} m`,
      `↕ ${Math.round(profile.minEle)}–${Math.round(profile.maxEle)} m`,
    );
  }

  return parts.join(" · ");
}

/**
 * A plain notice shown instead of a chart.
 * @param {string} text
 * @returns {HTMLElement}
 */
function message(text) {
  const el = document.createElement("p");
  el.className = "graphMessage";
  el.textContent = text;

  return el;
}
