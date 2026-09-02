/** Sport keys in the data are English, what the reader sees is not. */
export const SPORTS = {
  run: "beh",
  hike: "turistika",
  bike: "bicykel",
  ski: "skialp",
};

/** Kinds of place. */
export const PLACES = {
  peak: "vrchol",
  hut: "chata",
  spring: "pramen",
  view: "výhľad",
};

/** Country codes stay ISO in the data, so the list can grow without a rename. */
export const COUNTRIES = {
  SK: "Slovensko",
  CZ: "Česko",
  AT: "Rakúsko",
  PL: "Poľsko",
  HU: "Maďarsko",
  SI: "Slovinsko",
  HR: "Chorvátsko",
  IT: "Taliansko",
  DE: "Nemecko",
  CH: "Švajčiarsko",
  FR: "Francúzsko",
  ES: "Španielsko",
  NO: "Nórsko",
};

/**
 * Whether a route comes back to its start.
 * @param {boolean} loop
 * @returns {string}
 */
export function shape(loop) {
  return loop ? "okruh" : "prejazd";
}

/**
 * Slovak counting: one, a few, then the genitive for everything else.
 * @param {number} count
 * @param {string} one for 1
 * @param {string} few for 2 to 4
 * @param {string} many for 0 and 5 up
 * @returns {string}
 */
export function plural(count, one, few, many) {
  if (count === 1) return one;

  return count >= 2 && count <= 4 ? few : many;
}
