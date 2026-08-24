/**
 * Extracts points from a LineString GeoJson.
 * Accepts a FeatureCollection, a Feature or a bare geometry,
 * always returns a single flat array of points.
 * @param {*} geoJSONcontent
 * @returns [[x1,y1], [x2,y2],...]
 */
export function geoJsonToPoints(geoJSONcontent) {
  const { type } = geoJSONcontent ?? {};

  if (type === "FeatureCollection")
    return (geoJSONcontent.features ?? []).flatMap((feature) =>
      geometryToPoints(feature?.geometry),
    );

  if (type === "Feature") return geometryToPoints(geoJSONcontent.geometry);

  return geometryToPoints(geoJSONcontent);
}

/**
 * Extracts points of a single LineString geometry.
 * @param {*} geometry
 * @returns [[x1,y1], [x2,y2],...]
 */
function geometryToPoints(geometry) {
  const { type, coordinates } = geometry ?? {};

  return type === "LineString"
    ? coordinates.map(([lng, lat]) => [lng, lat])
    : [];
}
