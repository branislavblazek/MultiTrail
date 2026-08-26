import {
  addTrackLayer,
  updateTrackStyle,
  removeTrackLayer,
  fitToTrack,
} from "./map.js";
import { estimateGPXFilesize, parseTrack, trackStats } from "./geo-utils.js";

const PALETTE = [
  "#ef4444",
  "#3b82f6",
  "#22c55e",
  "#a855f7",
  "#f97316",
  "#0ea5e9",
];

const layers = new Map();

let colorTaken = 0;

/**
 * Wires the layer button to show/hide the layer panel.
 */
export function initLayerPanel() {
  const button = document.getElementById("layerButton");
  const panel = document.getElementById("layerPanel");

  button.addEventListener("click", () => panel.classList.toggle("active"));
}

/**
 * Wires the layer file input to show the submitted track on the map.
 * @param {*} map maplibre Map
 */
export function initFileInput(map) {
  const input = document.getElementById("layerFile");

  input.addEventListener("change", async (evt) => {
    const file = evt.target.files[0];
    if (!file) return;

    pushLayer(map, file.name, await file.text());
    input.value = "";
  });
}

/**
 * Parses a track and puts it on the map as a new layer.
 * @param {*} map maplibre Map
 * @param {string} filename name of the source file
 * @param {string} content GeoJson/GPX file content
 * @returns layer state, or null when the file holds no track
 */
export function pushLayer(map, filename, content) {
  const state = createState(filename, parseTrack(filename, content));
  if (!state) {
    console.warn(`No LineString found in ${filename}`);
    return null;
  }

  layers.set(state.id, state);

  addTrackLayer(map, state);
  document.getElementById("layerList").append(createLayerItem(map, state));
  fitToTrack(map, state.geoJson);

  return state;
}

/**
 * Builds the state of a single layer out of a parsed track.
 * @param {string} filename name of the source file
 * @param {*} geoJson GeoJson object
 * @returns layer state, or null when there is no LineString to show
 */
function createState(filename, geoJson) {
  const feature = geoJson.features?.find(
    (f) => f.geometry?.type === "LineString",
  );
  if (!feature) return null;

  const coords = feature.geometry.coordinates;
  const pointCount = coords.length;

  return {
    id: "layer-" + self.crypto.randomUUID(),
    filename,
    name: feature.properties?.name || filename,
    geoJson,
    pointCount,
    aproxSize: estimateGPXFilesize(pointCount),
    coords,
    stats: trackStats(coords),
    simplify: null,
    style: {
      width: 4,
      color: PALETTE[colorTaken++ % PALETTE.length],
      opacity: 0.8,
      visible: true,
    },
  };
}

/**
 * Takes a layer off the map and out of the panel.
 * @param {*} map maplibre Map
 * @param {*} state layer state
 * @param {HTMLElement} item panel entry of the layer
 */
function dropLayer(map, state, item) {
  removeTrackLayer(map, state);
  layers.delete(state.id);
  item.remove();
}

/**
 * Builds the panel entry of a layer: visibility, color, zoom, remove, opacity.
 * @param {*} map maplibre Map
 * @param {*} state layer state
 * @returns {HTMLElement} panel entry
 */
function createLayerItem(map, state) {
  const item = element("div", "layerItem");
  const head = element("div", "layerItemHead");

  const visible = element("input", "layerVisible");
  visible.type = "checkbox";
  visible.checked = state.style.visible;
  visible.title = "Show track";
  visible.addEventListener("change", () => {
    state.style.visible = visible.checked;
    updateTrackStyle(map, state);
    item.classList.toggle("dimmed", !visible.checked);
  });

  const color = element("input", "layerColor");
  color.type = "color";
  color.value = state.style.color;
  color.title = "Track color";
  color.addEventListener("input", () => {
    state.style.color = color.value;
    updateTrackStyle(map, state);
  });

  const name = element("span", "layerName");
  name.textContent = state.name;
  name.title = state.filename;

  const zoom = element("button", "layerZoom");
  zoom.textContent = "🔍";
  zoom.title = "Zoom to track";
  zoom.addEventListener("click", () => fitToTrack(map, state.geoJson));

  const remove = element("button", "layerRemove");
  remove.textContent = "✕";
  remove.title = "Remove layer";
  remove.addEventListener("click", () => dropLayer(map, state, item));

  const stats = element("span", "layerMeta");
  stats.textContent = formatStats(state.stats);

  const meta = element("span", "layerMeta");
  meta.textContent = `${state.pointCount.toLocaleString("sk-SK")} points · ${state.aproxSize}`;

  const width = createSliderRow("Width", {
    min: 1,
    max: 12,
    step: 0.5,
    value: state.style.width,
    format: (value) => `${value} px`,
  });
  width.input.addEventListener("input", () => {
    state.style.width = Number(width.input.value);
    updateTrackStyle(map, state);
  });

  const opacity = createSliderRow("Opacity", {
    min: 0,
    max: 1,
    step: 0.05,
    value: state.style.opacity,
    format: (value) => `${Math.round(value * 100)} %`,
  });
  opacity.input.addEventListener("input", () => {
    state.style.opacity = Number(opacity.input.value);
    updateTrackStyle(map, state);
  });

  head.append(visible, color, name, zoom, remove);
  item.append(head, stats, meta, width.row, opacity.row);

  return item;
}

/**
 * One line out of the measured track stats.
 * @param {*} stats distance, ascent and descent in meters
 * @returns {string} readable summary
 */
function formatStats({ distance, ascent, descent }) {
  const parts = [`${(distance / 1000).toFixed(1)} km`];

  if (ascent === null) parts.push("no elevation");
  else parts.push(`↑ ${Math.round(ascent)} m`, `↓ ${Math.round(descent)} m`);

  return parts.join(" · ");
}

/**
 * Builds a labelled slider that shows its own value.
 * @param {string} label text in front of the slider
 * @param {*} options min, max, step, value and a format(value) for the readout
 * @returns {{ row: HTMLElement, input: HTMLInputElement }}
 */
function createSliderRow(label, { min, max, step, value, format }) {
  const row = element("div", "layerRow");

  const name = element("span", "layerRowLabel");
  name.textContent = label;

  const input = element("input", "layerRowInput");
  input.type = "range";
  Object.assign(input, { min, max, step, value });

  const readout = element("span", "layerRowValue");
  readout.textContent = format(value);

  input.addEventListener("input", () => {
    readout.textContent = format(Number(input.value));
  });

  row.append(name, input, readout);

  return { row, input };
}

/**
 * Creates an element with a class.
 * @param {string} tag
 * @param {string} className
 * @returns {HTMLElement}
 */
function element(tag, className) {
  const el = document.createElement(tag);
  el.className = className;

  return el;
}
