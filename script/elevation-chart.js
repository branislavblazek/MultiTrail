import { elevationProfile } from "./geo-utils.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Drawing area in viewBox units. The svg itself scales to its container. */
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

/**
 * Draws the elevation profile of a track. Knows nothing about panels or maps:
 * it hands back an element to place and a cursor to drive, and reports what
 * the pointer is over so the caller can follow it elsewhere.
 * @param {*} options
 * @param {[number, number, number?][]} options.coords [[lng, lat, ele], ...]
 * @param {string} options.color line color of the track
 * @param {(index: number, coord: [number, number, number?]) => void} [options.onHover]
 * @param {() => void} [options.onLeave]
 * @returns {{ element: HTMLElement, profile: *, moveCursor: Function,
 *   clearCursor: Function }|null} null when the track carries no elevation
 */
export function elevationChart({ coords, color, onHover, onLeave }) {
  const profile = elevationProfile(coords);
  if (!profile) return null;

  const { points } = profile;
  const scale = scales(profile);

  const wrapper = document.createElement("div");
  wrapper.className = "graphChart";

  const root = svg("svg", {
    viewBox: `0 0 ${VIEW.width} ${VIEW.height}`,
    class: "graphSvg",
  });

  root.append(
    ...elevationGrid(scale),
    ...distanceGrid(profile.distance, scale),
  );

  const line = pathOf(points, scale);

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

  /**
   * Puts the cursor on a point of the track.
   * @param {number} index index into coords, shared with the profile
   */
  const moveCursor = (index) => {
    const [distance, ele] = points[index];
    const x = scale.x(distance);

    cursor.style.display = "";
    cursorLine.setAttribute("x1", x);
    cursorLine.setAttribute("x2", x);
    cursorDot.setAttribute("cx", x);
    cursorDot.setAttribute("cy", scale.y(ele));

    tooltip.style.display = "";
    tooltip.textContent = `${(distance / 1000).toFixed(2)} km · ${Math.round(ele)} m`;
    tooltip.style.left = `${(x / VIEW.width) * 100}%`;
  };

  const clearCursor = () => {
    cursor.style.display = "none";
    tooltip.style.display = "none";
  };

  root.addEventListener("pointermove", (evt) => {
    const rect = root.getBoundingClientRect();
    const viewX = (evt.clientX - rect.left) * (VIEW.width / rect.width);

    // One profile point per coordinate, so the index carries over to coords
    const index = nearestIndex(points, scale.toDistance(viewX));

    moveCursor(index);
    onHover?.(index, coords[index]);
  });

  root.addEventListener("pointerleave", () => {
    clearCursor();
    onLeave?.();
  });

  wrapper.append(root, tooltip);

  return { element: wrapper, profile, moveCursor, clearCursor };
}

/**
 * Turns profile points into an svg path.
 * @param {[number, number][]} points [[distance, elevation], ...]
 * @param {*} scale
 * @returns {string} path data
 */
function pathOf(points, scale) {
  return points
    .map(([distance, ele], i) => {
      return `${i ? "L" : "M"}${scale.x(distance)},${scale.y(ele)}`;
    })
    .join("");
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
    y: (ele) => PLOT.bottom - ((ele - low) / span) * (PLOT.bottom - PLOT.top),
    toDistance: (viewX) =>
      ((viewX - PLOT.left) / (PLOT.right - PLOT.left)) * distance,
  };
}

/**
 * Horizontal grid lines with their elevation labels.
 * @returns {SVGElement[]}
 */
function elevationGrid(scale) {
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
  return steps.find((step) => range / step <= 5) ?? steps[steps.length - 1];
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
