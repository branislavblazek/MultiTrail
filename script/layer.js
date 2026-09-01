import {
  addTrackLayer,
  updateTrackStyle,
  removeTrackLayer,
  fitToTrack,
  addSimplifiedLayer,
  updateSimplifiedData,
  hasSimplifiedLayer,
} from "./map.js";
import {
  estimateGPXFilesize,
  isLoop,
  parseTrack,
  trackStats,
} from "./geo-utils.js";
import { isAuthor } from "./author.js";
import { toggleLayerDetail, hideLayerDetail } from "./layer-detail.js";
import {
  prepare,
  applyTolerance,
  reduceAt,
  DEFAULT_TOLERANCE,
} from "./simplify.js";
import { coordsToGpx, simplifiedName, saveGpx } from "./gpx-export.js";
import { slugify, featureBlock, copyText } from "./publish.js";

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
function pushLayer(map, filename, content) {
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
  const lines = (geoJson.features ?? []).filter(
    (f) => f.geometry?.type === "LineString",
  );
  const feature = lines[0];
  if (!feature) return null;

  const coords = feature.geometry.coordinates;
  const pointCount = coords.length;
  const name = feature.properties?.name || filename;

  return {
    id: "layer-" + self.crypto.randomUUID(),
    filename,
    name,
    slug: slugify(name),
    // All of them get drawn, but only the first one is measured
    trackCount: lines.length,
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
  hideLayerDetail(state.id); // Only closes when this layer is the one being graphed
  removeTrackLayer(map, state);
  layers.delete(state.id);
  item.remove();
}

/**
 * Builds the panel entry of a layer: visibility, color, zoom, remove and the
 * style rows the palette button folds out.
 * @param {*} map maplibre Map
 * @param {*} state layer state
 * @returns {HTMLElement} panel entry
 */
function createLayerItem(map, state) {
  const item = element("div", "layerItem");
  const head = element("div", "layerItemHead");
  const actions = element("div", "layerItemActions");

  const dot = element("button", "layerDot");
  dot.style.color = state.style.color; // Both the fill and the ring follow it

  const paintDot = () => {
    dot.classList.toggle("hollow", !state.style.visible);
    dot.title = state.style.visible ? "Hide track" : "Show track";
    dot.setAttribute("aria-pressed", state.style.visible);
    item.classList.toggle("dimmed", !state.style.visible);
  };

  paintDot();
  dot.addEventListener("click", () => {
    state.style.visible = !state.style.visible;
    updateTrackStyle(map, state);
    paintDot();
  });

  const color = element("input", "layerColor");
  color.type = "color";
  color.value = state.style.color;
  color.addEventListener("input", () => {
    state.style.color = color.value;
    dot.style.color = color.value;
    updateTrackStyle(map, state);
  });

  const name = element("span", "layerName");
  name.textContent = state.name;
  name.title = state.filename;

  const warning = element("span", "layerWarning");
  if (state.trackCount > 1) {
    warning.textContent = "⚠️";
    warning.title =
      `${state.trackCount} tracks in this file. All of them are drawn, ` +
      `but every number and the publish block come from the first one only.`;
    console.warn(
      `${state.filename}: ${state.trackCount} LineStrings, measuring the first`,
    );
  }

  const info = element("button", "layerInfo");
  info.textContent = "ℹ️";
  info.title = "Show track details";
  info.addEventListener("click", () => toggleLayerDetail(state, info));

  const style = element("button", "layerStyle");
  style.textContent = "🎨";
  style.title = "Edit line style";
  const styleFold = createFoldout(style);

  const simplify = element("button", "layerSimplify");
  simplify.textContent = "✂️";
  simplify.title = "Compare with a simplified track";
  const simplifyFold = createFoldout(simplify, (open) =>
    toggleSimplified(map, state, open, tolerance.input, simplifyMeta),
  );

  const zoom = element("button", "layerZoom");
  zoom.textContent = "🔍";
  zoom.title = "Zoom to track";
  zoom.addEventListener("click", () => fitToTrack(map, state.geoJson));

  const remove = element("button", "layerRemove");
  remove.textContent = "✕";
  remove.title = "Remove layer";
  remove.addEventListener("click", () => dropLayer(map, state, item));


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

  const simplifyMeta = element("span", "layerMeta");

  const tolerance = createSliderRow("Tolerance", {
    min: 0,
    max: 50,
    step: 1,
    value: DEFAULT_TOLERANCE,
    format: (value) => `${value} m`,
  });

  const save = element("button", "layerSave");
  save.textContent = "⬇ Save GPX";
  save.addEventListener("click", () => {
    const { processed, tolerance: meters } = state.simplify;

    saveGpx(
      simplifiedName(state.filename, meters),
      coordsToGpx(processed.coords, state.name),
    );
  });

  // One redraw per frame at most, since this one rewrites the line geometry
  let frame = 0;
  tolerance.input.addEventListener("input", () => {
    if (frame) return;

    frame = requestAnimationFrame(() => {
      frame = 0;
      applyTolerance(state, Number(tolerance.input.value));
      updateSimplifiedData(map, state);
      simplifyMeta.textContent = formatSimplified(state);
      publishing?.describe(); // Publish follows this slider, so keep it honest
    });
  });

  // Publishing is an authoring job, the rest of the panel is for everyone
  const publishing = isAuthor() ? createPublishing(state, tolerance.input) : null;

  styleFold.inner.append(createRow("Color", color), width.row, opacity.row);
  simplifyFold.inner.append(simplifyMeta, tolerance.row, save);

  head.append(dot, name, warning);
  actions.append(info, style, simplify, zoom, remove);
  item.append(head, actions, styleFold.rows, simplifyFold.rows);

  if (publishing) {
    actions.insertBefore(publishing.button, zoom);
    item.append(publishing.rows);
  }

  return item;
}

/**
 * Builds the publishing fold: the slug, what the two outputs will hold, and
 * the button that writes them. Author only, so it is not built otherwise.
 * @param {*} state layer state
 * @param {HTMLInputElement} toleranceInput the simplify slider to follow
 * @returns {{ button: HTMLElement, rows: HTMLElement, describe: Function }}
 */
function createPublishing(state, toleranceInput) {
  const button = element("button", "layerPublish");
  button.textContent = "📤";
  button.title = "Publish as a recommended trail";

  const fold = createFoldout(button, (open) => {
    if (open) describe();
  });

  const slug = element("input", "layerSlugInput");
  slug.value = state.slug;
  slug.spellcheck = false;
  slug.title = "Filename, map id and url of the published trail";
  slug.addEventListener("input", () => {
    state.slug = slug.value;
  });
  slug.addEventListener("blur", () => {
    state.slug = slugify(slug.value);
    slug.value = state.slug;
    describe();
  });

  const meta = element("span", "layerMeta");
  const status = element("span", "layerMeta");

  const block = element("textarea", "layerBlock");
  block.readOnly = true;
  block.rows = 4;
  block.hidden = true;

  /** Both outputs come from one prepared simplification, at two tolerances. */
  const reductions = () => {
    if (!state.simplify) prepare(state);

    const meters = Number(toleranceInput.value);

    return {
      meters,
      original: reduceAt(state.simplify, 0),
      reduced: reduceAt(state.simplify, meters),
    };
  };

  const describe = () => {
    const { meters, original, reduced } = reductions();
    const count = (value) => value.toLocaleString("sk-SK");

    meta.textContent =
      `${state.slug}.gpx: ${count(original.pointCount)} pts · ` +
      `block: ${meters} m, ${count(reduced.pointCount)} pts`;
  };

  const save = element("button", "layerSave");
  save.textContent = "⬇ Publish";
  save.addEventListener("click", async () => {
    const { original, reduced } = reductions();

    saveGpx(`${state.slug}.gpx`, coordsToGpx(original.coords, state.name));

    // Numbers describe the file that was saved, not the raw import
    const text = featureBlock({
      slug: state.slug,
      name: state.name,
      coords: reduced.coords,
      stats: trackStats(original.coords),
      loop: isLoop(original.coords),
    });

    const copied = await copyText(text);

    block.hidden = copied;
    block.value = copied ? "" : text;

    status.textContent =
      `Saved ${state.slug}.gpx · ` +
      (copied ? "feature block copied" : "copy the block below") +
      (state.trackCount > 1 ? ` · first of ${state.trackCount} tracks` : "");
  });

  fold.inner.append(createRow("Slug", slug), meta, save, block, status);

  return { button, rows: fold.rows, describe };
}

/**
 * Builds a labelled slider that shows its own value.
 * @param {string} label text in front of the slider
 * @param {*} options min, max, step, value and a format(value) for the readout
 * @returns {{ row: HTMLElement, input: HTMLInputElement }}
 */
function createSliderRow(label, { min, max, step, value, format }) {
  const input = element("input", "layerRowInput");
  input.type = "range";
  Object.assign(input, { min, max, step, value });

  const readout = element("span", "layerRowValue");
  readout.textContent = format(value);

  input.addEventListener("input", () => {
    readout.textContent = format(Number(input.value));
  });

  return { row: createRow(label, input, readout), input };
}

/**
 * Turns a track's reduced twin on or off. The first turn on is the only one
 * that pays for the algorithm; afterwards it is a visibility switch.
 * @param {*} map maplibre Map
 * @param {*} state layer state
 * @param {boolean} open whether the fold was just opened
 * @param {HTMLInputElement} input the tolerance slider
 * @param {HTMLElement} meta the readout under the slider
 */
function toggleSimplified(map, state, open, input, meta) {
  if (open) {
    if (!state.simplify) prepare(state);

    applyTolerance(state, Number(input.value));

    if (hasSimplifiedLayer(map, state)) updateSimplifiedData(map, state);
    else addSimplifiedLayer(map, state);

    meta.textContent = formatSimplified(state);
  }

  state.simplify.active = open;
  updateTrackStyle(map, state);
}

/**
 * How much the current tolerance costs in points and in exported filesize.
 * @param {*} state layer state with a simplification in place
 * @returns {string} readable before and after
 */
function formatSimplified(state) {
  const { pointCount, aproxSize } = state.simplify.processed;
  const locale = (value) => value.toLocaleString("sk-SK");

  return (
    `${locale(state.pointCount)} → ${locale(pointCount)} points · ` +
    `${state.aproxSize} → ${aproxSize}`
  );
}

/**
 * Builds a fold that a button opens and closes, animated by css.
 * @param {HTMLElement} button the button that toggles the fold
 * @param {(open: boolean) => void} [onToggle] runs after every toggle
 * @returns {{ rows: HTMLElement, inner: HTMLElement }} fold and its content
 */
function createFoldout(button, onToggle) {
  const rows = element("div", "layerFoldout");
  const inner = element("div", "layerFoldoutInner");
  rows.inert = true; // Folded away, so keep it out of tab order as well
  rows.append(inner);

  button.addEventListener("click", () => {
    const open = rows.classList.toggle("open");

    rows.inert = !open;
    button.classList.toggle("active", open);
    onToggle?.(open);
  });

  return { rows, inner };
}

/**
 * Builds a labelled row of the style panel.
 * @param {string} label text in front of the controls
 * @param {...HTMLElement} controls
 * @returns {HTMLElement} the row
 */
function createRow(label, ...controls) {
  const row = element("div", "layerRow");

  const name = element("span", "layerRowLabel");
  name.textContent = label;

  row.append(name, ...controls);

  return row;
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
