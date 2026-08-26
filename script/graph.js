import { elevationProfile } from "./geo-utils.js";
import { showCursor, hideCursor } from "./map.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Drawing area in viewBox units. The svg itself scales to the panel. */
const VIEW = { width: 1000, height: 260 };
const PAD = { top: 14, right: 14, bottom: 24, left: 46 };

const PLOT = {
  left: PAD.left,
  right: VIEW.width - PAD.right,
  top: PAD.top,
  bottom: VIEW.height - PAD.bottom,
};

/** Steps the axes are allowed to label, so the numbers stay readable. */
const ELE_STEPS = [10, 20, 25, 50, 100, 200, 250, 500, 1000];
const KM_STEPS = [0.5, 1, 2, 5, 10, 20, 50, 100];

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
  const profile = elevationProfile(state.coords);

  document.getElementById("graphTitle").textContent = state.name;
  document.getElementById("graphStats").textContent = formatStats(
    state.stats,
    profile,
  );
  body.replaceChildren();

  if (!profile) {
    body.append(message("This track carries no elevation data."));
    return;
  }

  body.append(chart(profile, state));
}

/**
 * The measured numbers of a track as one line.
 * @param {*} stats distance, ascent and descent in meters
 * @param {*} profile elevation profile, or null when there is no elevation
 * @returns {string} readable summary
 */
function formatStats({ distance, ascent, descent }, profile) {
  const parts = [`${(distance / 1000).toFixed(1)} km`];

  if (ascent === null) {
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
 * Builds the whole chart: grid, area, line and the hover readout.
 * @param {*} profile elevation profile
 * @param {*} state layer state the profile was built from
 * @returns {HTMLElement} wrapper holding the svg and its tooltip
 */
function chart(profile, state) {
  const { points, distance, minEle, maxEle } = profile;
  const color = state.style.color;

  const scale = scales(profile);
  const wrapper = document.createElement("div");
  wrapper.className = "graphChart";

  const root = svg("svg", {
    viewBox: `0 0 ${VIEW.width} ${VIEW.height}`,
    class: "graphSvg",
  });

  root.append(
    ...elevationGrid(minEle, maxEle, scale),
    ...distanceGrid(distance, scale),
  );

  const line = points
    .map(([d, ele], i) => `${i ? "L" : "M"}${scale.x(d)},${scale.y(ele)}`)
    .join("");

  root.append(
    svg("path", {
      d: `${line}L${PLOT.right},${PLOT.bottom}L${PLOT.left},${PLOT.bottom}Z`,
      fill: color,
      "fill-opacity": 0.15,
    }),
    svg("path", {
      d: line,
      fill: "none",
      stroke: color,
      "stroke-width": 1.6,
      "stroke-linejoin": "round",
    }),
  );

  const cursor = svg("g", { class: "graphCursor" });
  const cursorLine = svg("line", {
    y1: PLOT.top,
    y2: PLOT.bottom,
    "stroke-width": 1,
  });
  const cursorDot = svg("circle", { r: 3.5, fill: color });
  cursor.append(cursorLine, cursorDot);
  cursor.style.display = "none";
  root.append(cursor);

  const tooltip = document.createElement("div");
  tooltip.className = "graphTooltip";
  tooltip.style.display = "none";

  root.addEventListener("pointermove", (evt) => {
    const rect = root.getBoundingClientRect();
    const viewX = (evt.clientX - rect.left) * (VIEW.width / rect.width);

    // One profile point per coordinate, so the index carries over to the map
    const index = nearestIndex(points, scale.toDistance(viewX));
    const [d, ele] = points[index];

    showCursor(mapRef, state.coords[index], color);

    cursor.style.display = "";
    cursorLine.setAttribute("x1", scale.x(d));
    cursorLine.setAttribute("x2", scale.x(d));
    cursorDot.setAttribute("cx", scale.x(d));
    cursorDot.setAttribute("cy", scale.y(ele));

    tooltip.style.display = "";
    tooltip.textContent = `${(d / 1000).toFixed(2)} km · ${Math.round(ele)} m`;
    tooltip.style.left = `${(scale.x(d) / VIEW.width) * rect.width}px`;
  });

  root.addEventListener("pointerleave", () => {
    hideCursor(mapRef);
    cursor.style.display = "none";
    tooltip.style.display = "none";
  });

  wrapper.append(root, tooltip);

  return wrapper;
}

/**
 * Maps meters of elevation and distance onto viewBox coordinates.
 * @param {*} profile elevation profile
 */
function scales({ distance, minEle, maxEle }) {
  const step = niceStep(maxEle - minEle, ELE_STEPS);
  const low = Math.floor(minEle / step) * step;
  const high = Math.ceil(maxEle / step) * step;
  const span = high - low || 1;

  return {
    step,
    low,
    high,
    x: (d) => PLOT.left + (d / (distance || 1)) * (PLOT.right - PLOT.left),
    y: (ele) =>
      PLOT.bottom - ((ele - low) / span) * (PLOT.bottom - PLOT.top),
    toDistance: (viewX) =>
      ((viewX - PLOT.left) / (PLOT.right - PLOT.left)) * distance,
  };
}

/**
 * Horizontal grid lines with their elevation labels.
 * @returns {SVGElement[]}
 */
function elevationGrid(minEle, maxEle, scale) {
  const parts = [];

  for (let ele = scale.low; ele <= scale.high; ele += scale.step) {
    const y = scale.y(ele);

    parts.push(
      svg("line", {
        class: "graphGrid",
        x1: PLOT.left,
        x2: PLOT.right,
        y1: y,
        y2: y,
      }),
    );

    const label = svg("text", {
      class: "graphLabel",
      x: PLOT.left - 8,
      y: y + 4,
      "text-anchor": "end",
    });
    label.textContent = ele;
    parts.push(label);
  }

  return parts;
}

/**
 * Vertical grid lines with their distance labels, in kilometers.
 * @returns {SVGElement[]}
 */
function distanceGrid(distance, scale) {
  const parts = [];
  const step = niceStep(distance / 1000, KM_STEPS) * 1000;

  for (let d = 0; d <= distance; d += step) {
    const x = scale.x(d);

    parts.push(
      svg("line", {
        class: "graphGrid",
        x1: x,
        x2: x,
        y1: PLOT.top,
        y2: PLOT.bottom,
      }),
    );

    const label = svg("text", {
      class: "graphLabel",
      x,
      y: PLOT.bottom + 16,
      "text-anchor": "middle",
    });
    label.textContent = `${+(d / 1000).toFixed(1)} km`;
    parts.push(label);
  }

  return parts;
}

/**
 * Smallest allowed step that keeps the axis under six lines.
 * @param {number} range span the axis has to cover
 * @param {number[]} steps allowed steps, ascending
 * @returns {number} step
 */
function niceStep(range, steps) {
  return (
    steps.find((step) => range / step <= 5) ?? steps[steps.length - 1]
  );
}

/**
 * Index of the point closest to a distance. Points are sorted by distance.
 * @param {[number, number][]} points
 * @param {number} distance meters
 * @returns {number} index
 */
function nearestIndex(points, distance) {
  let low = 0,
    high = points.length - 1;

  while (low < high) {
    const middle = (low + high) >> 1;
    if (points[middle][0] < distance) low = middle + 1;
    else high = middle;
  }

  const previous = Math.max(0, low - 1);

  return Math.abs(points[previous][0] - distance) <
    Math.abs(points[low][0] - distance)
    ? previous
    : low;
}

/**
 * Creates an svg element with attributes.
 * @param {string} tag
 * @param {*} attributes
 * @returns {SVGElement}
 */
function svg(tag, attributes) {
  const el = document.createElementNS(SVG_NS, tag);

  for (const [name, value] of Object.entries(attributes)) {
    el.setAttribute(name, value);
  }

  return el;
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
