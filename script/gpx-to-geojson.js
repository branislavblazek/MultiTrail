const parser = new DOMParser();

/**
 * Convert GPX file into GeoJSON object
 * @param {*} gpxText content of GPX file
 * @returns GeoJSON (no file, object)
 */
export function gpxToGeoJson(gpxText) {
  const doc = parser.parseFromString(gpxText, "application/xml");

  const error = doc.querySelector("parsererror");
  if (error) {
    throw new Error(`Invalid GPX: ${error.textContent.trim()}`);
  }

  const features = [];

  for (const rte of doc.getElementsByTagName("rte")) {
    const coordinates = pointList(rte.getElementsByTagName("rtept"));
    if (coordinates.length < 2) continue;

    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates },
      properties: metadata(rte),
    });
  }

  for (const trk of doc.getElementsByTagName("trk")) {
    const properties = metadata(trk);

    for (const seg of trk.getElementsByTagName("trkseg")) {
      const points = seg.getElementsByTagName("trkpt");
      const coordinates = pointList(points);
      if (coordinates.length < 2) continue;

      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates },
        properties,
      });
    }
  }

  return { type: "FeatureCollection", features };
}

/** [lon, lat] or [lon, lat, ele] from a rtept/trkpt element. */
function pointCoordinates(el) {
  const lon = Number(el.getAttribute("lon"));
  const lat = Number(el.getAttribute("lat"));
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  const ele = Number(text(el, "ele"));
  return Number.isFinite(ele) ? [lon, lat, ele] : [lon, lat];
}

function pointList(elements) {
  const coordinates = [];
  for (const el of elements) {
    const coord = pointCoordinates(el);
    if (coord) coordinates.push(coord);
  }
  return coordinates;
}

/** Descriptive child tags shared by routes and tracks. */
function metadata(el) {
  const properties = {};
  for (const tag of ["name", "cmt", "desc", "type", "src", "link"]) {
    const value = text(el, tag);
    if (value) properties[tag] = value;
  }
  return properties;
}

/** Text of the first direct child with the given tag name. */
function text(el, tag) {
  for (const child of el.children) {
    if (child.tagName === tag) return child.textContent.trim();
  }
  return null;
}
