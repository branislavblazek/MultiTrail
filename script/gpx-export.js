/**
 * Wraps points into a GPX track.
 * @param {[number, number, number?][]} coords [[lng, lat, ele?], ...]
 * @param {string} name track name written into the file
 * @returns {string} GPX file content
 */
export function coordsToGpx(coords, name) {
  const points = coords.map(([lng, lat, ele]) => {
    const position = `lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"`;

    return Number.isFinite(ele)
      ? `      <trkpt ${position}><ele>${ele.toFixed(1)}</ele></trkpt>`
      : `      <trkpt ${position} />`;
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="MultiTrail"',
    '     xmlns="http://www.topografix.com/GPX/1/1">',
    "  <trk>",
    `    <name>${escapeXml(name)}</name>`,
    "    <trkseg>",
    ...points,
    "    </trkseg>",
    "  </trk>",
    "</gpx>",
    "",
  ].join("\n");
}

/**
 * Name for an exported simplification, next to the file it came from.
 * @param {string} filename name the track was loaded under
 * @param {number} tolerance meters the track was simplified with
 * @returns {string} filename to save under
 */
export function simplifiedName(filename, tolerance) {
  const base = filename
    .split("/")
    .pop()
    .replace(/\.(gpx|json|geojson)$/i, "");

  return `${base}-simplified-${tolerance}m.gpx`;
}

/**
 * Hands a file to the browser to save.
 * @param {string} filename name offered in the save dialog
 * @param {string} content file content
 */
export function saveGpx(filename, content) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "application/gpx+xml" }),
  );

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

/**
 * Escapes the five characters XML cannot carry raw.
 * @param {string} text
 * @returns {string}
 */
function escapeXml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
