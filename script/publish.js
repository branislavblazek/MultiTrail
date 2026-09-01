/** Letters NFD does not split into a base plus an accent. */
const SPECIAL = {
  \u0111: "d",
  \u0142: "l",
  \u00f8: "o",
  \u00df: "ss",
  \u00e6: "ae",
  \u0153: "oe",
  \u00f0: "d",
  \u00fe: "th",
};

/** Decimals kept in published coordinates. Five is about 1.1 m. */
const PRECISION = 5;

/**
 * Turns a track name into a slug. The slug is the single identifier of a
 * recommended trail: the name of its GPX file, its key in trails.geojson,
 * its feature id on the map and its value in the url. Once published it
 * must not change.
 * @param {string} text
 * @returns {string} lowercase, ascii, dash separated
 */
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\u0000-\u007f]/g, (char) => SPECIAL[char] ?? char)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Drop the accents NFD split off
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Builds the feature block to paste into trails.geojson. Everything that can
 * be measured is filled in; everything authored is left empty on purpose, so
 * that a half filled trail is obvious rather than plausible.
 * @param {*} trail
 * @param {string} trail.slug
 * @param {string} trail.name
 * @param {[number, number, number?][]} trail.coords reduced, for the map
 * @param {*} trail.stats distance, ascent and descent of the published track
 * @param {boolean} trail.loop
 * @returns {string} pretty printed json, coordinates on a single line
 */
export function featureBlock({ slug, name, coords, stats, loop }) {
  const properties = {
    slug,
    kind: "route",
    name,
    country: "",
    region: "",
    distance_m: Math.round(stats.distance),
    ascent_m: stats.ascent === null ? null : Math.round(stats.ascent),
    descent_m: stats.descent === null ? null : Math.round(stats.descent),
    loop,
    sports: { run: { duration_min: null, difficulty: "" } },
    tags: [],
    description: { sk: "" },
  };

  const flat = coords.map(([lng, lat]) => [
    +lng.toFixed(PRECISION),
    +lat.toFixed(PRECISION),
  ]);

  return [
    "{",
    '  "type": "Feature",',
    `  "properties": ${indent(JSON.stringify(properties, null, 2))},`,
    `  "geometry": { "type": "LineString", "coordinates": ${JSON.stringify(flat)} }`,
    "}",
  ].join("\n");
}

/**
 * Copies text to the clipboard. Needs a secure context, so over plain http
 * on anything but localhost it will fail and the caller has to fall back.
 * @param {string} text
 * @returns {Promise<boolean>} whether it landed
 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Shifts every line but the first, so a nested json block lines up.
 * @param {string} json
 * @returns {string}
 */
function indent(json) {
  return json.split("\n").join("\n  ");
}
