import { elevationProfile } from "./geo-utils.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Drawing area in viewBox units. The svg itself scales to its container. */
const VIEW = { width: 1000, height: 300 };
const PAD = { top: 14, right: 6, bottom: 26, left: 6 };

const PLOT = {
  left: PAD.left,
  right: VIEW.width - PAD.right,
  top: PAD.top,
  bottom: VIEW.height - PAD.bottom,
};

/** Distance steps the ticks are allowed to sit on, in kilometers. */
const KM_STEPS = [0.5, 1, 2, 5, 10, 20, 50, 100];

/** Headroom above and below the line, as a share of the elevation span. */
const HEADROOM = 0.12;

/**
 * Draws the elevation profile of a track. Knows nothing about panels or maps:
 * it hands back an element to place and a cursor to drive, and reports what
 * the pointer is over so the caller can follow it elsewhere.
 *
 * No axes on purpose: on a phone the labels were noise, and the exact numbers
 * are a finger away in the tooltip. The caller shows the range in its header.
 * @param {*} options
 * @param {[number, number, number?][]} options.coords [[lng, lat, ele], ...]
 * @param {(index: number, coord: [number, number, number?]) => void} [options.onHover]
 * @param {() => void} [options.onLeave]
 * @returns {{ element: HTMLElement, profile: *, moveCursor: Function,
 *   clearCursor: Function }|null} null when the track carries no elevation
 */
export function elevationChart({ coords, onHover, onLeave }) {
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

  const line = pathOf(points, scale);

  root.append(
    svg("path", {
      class: "graphArea",
      d: `${line}L${PLOT.right},${PLOT.bottom}L${PLOT.left},${PLOT.bottom}Z`,
    }),
    svg("path", { class: "graphLine", d: line }),
    ...distanceTicks(profile.distance, scale),
  );

  const cursor = svg("g", { class: "graphCursor" });
  const cursorLine = svg("line", { y1: PLOT.top, y2: PLOT.bottom });
  const cursorDot = svg("circle", { r: 5 });
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

    // Centred on the cursor, but stopped at both ends: hanging out of the
    // chart put a sideways scrollbar on the panel and clipped the label.
    const width = root.getBoundingClientRect().width;
    const half = (tooltip.offsetWidth || 0) / 2;
    const centre = (x / VIEW.width) * width;

    tooltip.style.left = `${Math.min(Math.max(centre, half), width - half)}px`;
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
 * Maps meters of elevation and distance onto viewBox coordinates. The line
 * keeps a margin top and bottom, so a peak never touches the edge.
 * @param {*} profile elevation profile
 */
function scales({ distance, minEle, maxEle }) {
  const span = maxEle - minEle || 1;
  const low = minEle - span * HEADROOM;
  const high = maxEle + span * HEADROOM;

  return {
    x: (d) => PLOT.left + (d / (distance || 1)) * (PLOT.right - PLOT.left),
    y: (ele) =>
      PLOT.bottom - ((ele - low) / (high - low)) * (PLOT.bottom - PLOT.top),
    toDistance: (viewX) =>
      ((viewX - PLOT.left) / (PLOT.right - PLOT.left)) * distance,
  };
}

/**
 * Dots along the bottom, one per round distance. They give a sense of scale
 * without spending a line of labels on it.
 * @param {number} distance meters
 * @param {*} scale
 * @returns {SVGElement[]}
 */
function distanceTicks(distance, scale) {
  const step = niceStep(distance / 1000) * 1000;
  const ticks = [];

  for (let d = 0; d <= distance; d += step) {
    ticks.push(
      svg("circle", {
        class: "graphTick",
        cx: scale.x(d),
        cy: PLOT.bottom + 14,
        r: 4,
      }),
    );
  }

  return ticks;
}

/**
 * Smallest allowed step that keeps the ticks to a handful.
 * @param {number} kilometers span to cover
 * @returns {number} step in kilometers
 */
function niceStep(kilometers) {
  return (
    KM_STEPS.find((step) => kilometers / step <= 6) ??
    KM_STEPS[KM_STEPS.length - 1]
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
