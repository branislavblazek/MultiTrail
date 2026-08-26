import { gpxToGeoJson } from "./gpx-to-geojson.js";

const EARTH_RADIUS = 6371008.8; // Mean earth radius in meters

/**
 * Treats GPX file or GeoJson file as GeoJson object.
 * @param {string} name filename
 * @param {*} content GeoJson/GPX file content
 * @returns GeoJson object
 */
export function parseTrack(name, content) {
  return name.toLowerCase().endsWith(".gpx")
    ? gpxToGeoJson(content)
    : JSON.parse(content);
}

/**
 * Get bounds of GeoJson file, either a Feature or a FeatureCollection.
 * @param {*} geoJSONcontent
 * @returns [[west, south], [east, north]]
 */
export function boundsOf(geoJSONcontent) {
  let west = Infinity,
    south = Infinity,
    east = -Infinity,
    north = -Infinity;

  for (const feature of featuresOf(geoJSONcontent)) {
    const { type, coordinates } = feature.geometry ?? {};
    const coords =
      type === "Point"
        ? [coordinates]
        : type === "LineString"
          ? coordinates
          : [];

    for (const [lng, lat] of coords) {
      if (lng < west) west = lng;
      if (lat < south) south = lat;
      if (lng > east) east = lng;
      if (lat > north) north = lat;
    }
  }

  return west === Infinity
    ? null
    : [
        [west, south],
        [east, north],
      ];
}

/**
 * Treats a Feature or a FeatureCollection as a list of features.
 * @param {*} geoJSONcontent
 * @returns array of Features
 */
function featuresOf(geoJSONcontent) {
  const { type, features } = geoJSONcontent ?? {};

  if (type === "FeatureCollection") return features ?? [];
  if (type === "Feature") return [geoJSONcontent];

  return [];
}

/**
 * Wraps points into a LineString GeoJson Feature.
 * @param {[number, number][]} points [[x1,y1], [x2,y2],...]
 * @returns GeoJson Feature
 */
export function createGeoJson(points) {
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: points,
    },
  };
}

/**
 * Length, ascent and descent of a track.
 * Ascent/descent need elevation in the third coordinate and use hysteresis,
 * so that GPS noise does not pile up into hundreds of false meters.
 * @param {[number, number, number?][]} coords [[lng, lat, ele?], ...]
 * @param {number} threshold meters of elevation change that count as real
 * @returns {{ distance: number, ascent: number|null, descent: number|null }}
 */
export function trackStats(coords, threshold = 3) {
  if (coords.length < 2) return { distance: 0, ascent: null, descent: null };

  const hasElevation = coords.every((coord) => Number.isFinite(coord[2]));

  let distance = 0,
    ascent = 0,
    descent = 0,
    reference = hasElevation ? coords[0][2] : 0;

  for (let i = 1; i < coords.length; i++) {
    distance += haversine(coords[i - 1], coords[i]);
    if (!hasElevation) continue;

    const delta = coords[i][2] - reference;

    if (delta > threshold) {
      ascent += delta;
      reference = coords[i][2];
    } else if (delta < -threshold) {
      descent -= delta;
      reference = coords[i][2];
    }
  }

  return {
    distance,
    ascent: hasElevation ? ascent : null,
    descent: hasElevation ? descent : null,
  };
}

/**
 * Projects coordinates onto a local plane in meters, so that distances along
 * both axes are comparable. Good enough over the span of a single track.
 * @param {[number, number, number?][]} coords [[lng, lat, ele?], ...]
 * @returns {[number, number][]} [[x, y], ...] in meters
 */
export function projectToMeters(coords) {
  const middleLat =
    coords.reduce((sum, coord) => sum + coord[1], 0) / coords.length;
  const kx = Math.cos((middleLat * Math.PI) / 180) * 111320;
  const ky = 110540;

  return coords.map(([lng, lat]) => [lng * kx, lat * ky]);
}

/**
 * Elevation of a track against the distance travelled, ready to be plotted.
 * @param {[number, number, number?][]} coords [[lng, lat, ele?], ...]
 * @returns {{ points: [number, number][], distance: number, minEle: number,
 *   maxEle: number }|null} null when the track carries no elevation
 */
export function elevationProfile(coords) {
  if (coords.length < 2) return null;
  if (!coords.every((coord) => Number.isFinite(coord[2]))) return null;

  const points = [[0, coords[0][2]]];

  let distance = 0,
    minEle = coords[0][2],
    maxEle = coords[0][2];

  for (let i = 1; i < coords.length; i++) {
    const ele = coords[i][2];

    distance += haversine(coords[i - 1], coords[i]);
    points.push([distance, ele]);

    if (ele < minEle) minEle = ele;
    if (ele > maxEle) maxEle = ele;
  }

  return { points, distance, minEle, maxEle };
}

/**
 * Great-circle distance between two points.
 * @param {[number, number]} from [lng, lat]
 * @param {[number, number]} to [lng, lat]
 * @returns {number} meters
 */
function haversine([lng1, lat1], [lng2, lat2]) {
  const rad = Math.PI / 180;
  const f1 = lat1 * rad,
    f2 = lat2 * rad;
  const df = f2 - f1,
    dl = (lng2 - lng1) * rad;

  const a =
    Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;

  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(a));
}

export function estimateGPXFilesize(pointCount) {
  const bytesPerPoint = 72; // Priemerná veľkosť 1 GPX bodu (<trkpt> + ele)
  const xmlOverhead = 600; // XML hlavička, metadata a uzatváracie tagy

  const totalBytes = pointCount * bytesPerPoint + xmlOverhead;

  if (totalBytes < 1024) {
    return totalBytes + " B";
  } else if (totalBytes < 1024 * 1024) {
    return (totalBytes / 1024).toFixed(1) + " KB";
  } else {
    return (totalBytes / (1024 * 1024)).toFixed(2) + " MB";
  }
}
