import {
  createGeoJson,
  estimateGPXFilesize,
  projectToMeters,
} from "./geo-utils.js";

/**
 * Radial pre-pass distance. Fixed and below GPS accuracy on purpose: it only
 * clears logger noise and standstill clusters, never anything you could see.
 */
const RADIAL_TOLERANCE = 1.5;

/** Douglas-Peucker tolerance the slider starts at, in meters. */
export const DEFAULT_TOLERANCE = 10;

/**
 * Prepares everything the tolerance slider needs. Runs once per layer, since
 * Douglas-Peucker is precomputed into a per point significance.
 * @param {*} state layer state, gets its simplify slot filled
 */
export function prepare(state) {
  const projected = projectToMeters(state.coords);
  const kept = radialDistance(projected, RADIAL_TOLERANCE);

  const coords = kept.map((index) => state.coords[index]);
  const xy = kept.map((index) => projected[index]);

  state.simplify = {
    active: false,
    tolerance: DEFAULT_TOLERANCE,
    coords, // Indexes of coords, xy and sig line up
    xy,
    sig: pointSignificance(xy),
    processed: null,
  };
}

/**
 * Simplifies the track down to a tolerance. Only filters the precomputed
 * significance, so it is a single linear pass and fits into one frame.
 * @param {*} state layer state, prepared beforehand
 * @param {number} tolerance meters
 */
export function applyTolerance(state, tolerance) {
  const reduced = reduceAt(state.simplify, tolerance);

  state.simplify.tolerance = tolerance;
  state.simplify.processed = {
    ...reduced,
    geoJson: createGeoJson(reduced.coords),
  };
}

/**
 * Simplifies to a tolerance without storing anything, so publishing can ask
 * for a second reduction without disturbing what is on the map.
 * @param {*} simplify the prepared simplify slot of a state
 * @param {number} tolerance meters
 * @returns {{ coords: *, pointCount: number, aproxSize: string }}
 */
export function reduceAt({ coords, sig }, tolerance) {
  const reduced = coords.filter((_, index) => sig[index] >= tolerance);

  return {
    coords: reduced,
    pointCount: reduced.length,
    aproxSize: estimateGPXFilesize(reduced.length),
  };
}

/**
 * Radial distance: drops points closer than tolerance to the last kept one.
 * @param {[number, number][]} xy points in meters
 * @param {number} tolerance meters
 * @returns {number[]} indexes of the kept points
 */
export function radialDistance(xy, tolerance) {
  if (xy.length < 3) return xy.map((_, index) => index);

  const squared = tolerance * tolerance;
  const kept = [0];
  let anchor = xy[0];

  for (let i = 1; i < xy.length - 1; i++) {
    const dx = xy[i][0] - anchor[0];
    const dy = xy[i][1] - anchor[1];
    if (dx * dx + dy * dy < squared) continue;

    kept.push(i);
    anchor = xy[i];
  }

  kept.push(xy.length - 1);

  return kept;
}

/**
 * Douglas-Peucker turned inside out: instead of simplifying to one tolerance,
 * it records for every point the tolerance at which it would be dropped.
 * Filtering by that number then equals running the algorithm itself.
 * @param {[number, number][]} xy points in meters
 * @returns {Float64Array} significance per point, endpoints are Infinity
 */
export function pointSignificance(xy) {
  const sig = new Float64Array(xy.length);
  if (xy.length === 0) return sig;

  sig[0] = sig[xy.length - 1] = Infinity;

  const stack = [[0, xy.length - 1, Infinity]];

  while (stack.length) {
    const [first, last, parent] = stack.pop();
    if (last - first < 2) continue;

    let furthest = -1,
      index = -1;

    for (let i = first + 1; i < last; i++) {
      const distance = perpendicular(xy[i], xy[first], xy[last]);
      if (distance > furthest) {
        furthest = distance;
        index = i;
      }
    }

    // Clamped to the parent, so the hierarchy stays monotone and a plain
    // filter cannot keep a point whose enclosing point is already gone.
    sig[index] = Math.min(furthest, parent);

    stack.push([first, index, sig[index]], [index, last, sig[index]]);
  }

  return sig;
}

/**
 * Distance from a point to a segment. Clamped to the segment rather than to
 * its infinite line, which matters on tracks that loop back on themselves.
 * @param {[number, number]} point
 * @param {[number, number]} from
 * @param {[number, number]} to
 * @returns {number} meters
 */
function perpendicular([x, y], [x1, y1], [x2, y2]) {
  const dx = x2 - x1,
    dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) return Math.hypot(x - x1, y - y1);

  const along = Math.max(
    0,
    Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSquared),
  );

  return Math.hypot(x - (x1 + along * dx), y - (y1 + along * dy));
}
