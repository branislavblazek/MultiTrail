import { elevationChart } from "./elevation-chart.js";
import { showCursor, hideCursor } from "./map.js";

/** The layer whose profile is on screen, and the button that opened it. */
let shownId = null;
let shownButton = null;

/** The one map the panel points its cursor at. */
let mapRef = null;

/**
 * Wires the close button and the escape key of the graph panel.
 * @param {*} map maplibre Map the graph cursor marks its position on
 */
export function initGraphPanel(map) {
  mapRef = map;

  document
    .getElementById("graphClose")
    .addEventListener("click", () => hideGraph());

  document.addEventListener("keydown", (evt) => {
    if (evt.key === "Escape") hideGraph();
  });
}

/**
 * Shows the elevation profile of a layer, or closes an already shown one.
 * @param {*} state layer state
 * @param {HTMLElement} button the graph button of that layer
 */
export function toggleGraph(state, button) {
  if (shownId === state.id) {
    hideGraph();
    return;
  }

  shownButton?.classList.remove("active");
  shownButton = button;
  shownButton.classList.add("active");
  shownId = state.id;

  render(state);
  document.getElementById("graphPanel").classList.add("active");
}

/**
 * Closes the graph panel.
 * @param {string} [id] close only when this layer is the one on screen
 */
export function hideGraph(id) {
  if (shownId === null || (id !== undefined && id !== shownId)) return;

  hideCursor(mapRef);
  document.getElementById("graphPanel").classList.remove("active");
  shownButton?.classList.remove("active");
  shownButton = null;
  shownId = null;
}

/**
 * Fills the panel with the profile of a layer.
 * @param {*} state layer state
 */
function render(state) {
  const body = document.getElementById("graphBody");

  document.getElementById("graphTitle").textContent = state.name;
  body.replaceChildren();

  const chart = elevationChart({
    coords: state.coords,
    color: state.style.color,
    onHover: (_index, coord) => showCursor(mapRef, coord, state.style.color),
    onLeave: () => hideCursor(mapRef),
  });

  document.getElementById("graphStats").textContent = formatStats(
    state.stats,
    chart?.profile,
  );

  body.append(
    chart ? chart.element : message("This track carries no elevation data."),
  );
}

/**
 * The measured numbers of a track as one line.
 * @param {*} stats distance, ascent and descent in meters
 * @param {*} profile elevation profile, or null when there is no elevation
 * @returns {string} readable summary
 */
function formatStats({ distance, ascent, descent }, profile) {
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
