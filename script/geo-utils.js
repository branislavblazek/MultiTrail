import { gpxToGeoJson } from "./gpx-to-geojson.js";

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
