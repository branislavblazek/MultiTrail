import { elevationChart } from "./elevation-chart.js";
import { showCursor, hideCursor } from "./map.js";
import {
  showDetail,
  hideDetail,
  shownDetail,
  createStats,
  createSection,
} from "./detail-panel.js";

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
 * Shows the profile of a layer in the shared sheet, or closes it again.
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
    onHover: (_index, coord) => showCursor(mapRef, coord, color),
    onLeave: () => hideCursor(mapRef),
  });

  const section = createSection("Výškový profil");

  if (chart) {
    section.aside.textContent =
      `${Math.round(chart.profile.minEle)}–` +
      `${Math.round(chart.profile.maxEle)} m`;
  }

  shownButton = button;
  button.classList.add("active");

  showDetail({
    id: state.id,
    eyebrow: "Vrstva",
    title: state.name,
    body: [
      stats(state.stats),
      section.row,
      chart ? chart.element : message("Táto trasa nemá výškové údaje."),
    ],
    onClose: () => {
      hideCursor(mapRef);
      shownButton?.classList.remove("active");
      shownButton = null;
    },
  });
}

/**
 * Closes the sheet when it is this layer that is in it.
 * @param {string} id layer id
 */
export function hideLayerDetail(id) {
  hideDetail(id);
}

/**
 * The measured numbers of a track.
 * @param {*} trackStats distance, ascent and descent in meters
 * @returns {HTMLElement}
 */
function stats({ distance, ascent, descent }) {
  return createStats([
    { value: (distance / 1000).toFixed(1), label: "km" },
    { value: ascent === null ? "—" : String(Math.round(ascent)), label: "↑ m" },
    {
      value: descent === null ? "—" : String(Math.round(descent)),
      label: "↓ m",
    },
  ]);
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
