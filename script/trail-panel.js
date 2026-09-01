import {
  showTrails,
  selectTrail,
  selectedTrail,
  hoverTrail,
  focusTrail,
  watchTrailClicks,
  trailBySlug,
} from "./trails.js";
import { slugify } from "./publish.js";
import {
  openTrailPopup,
  closeTrailPopup,
  openTrailDetail,
  closeTrailDetail,
} from "./trail-detail.js";

/** Nothing filtered out. Anything equal to this stays out of the url. */
const CLEAR = {
  query: "",
  sport: "",
  country: "",
  distanceMin: "",
  distanceMax: "",
  ascentMax: "",
  durationMax: "",
  tags: [],
  places: true,
};

const filter = { ...CLEAR };

let mapRef = null;
let trails = [];
let controls = null;

/**
 * Builds the trails panel: search, filters and the list under them.
 * @param {*} map maplibre Map
 * @param {*[]} features everything trails.geojson holds
 */
export function initTrailPanel(map, features) {
  mapRef = map;
  trails = features;

  const button = document.getElementById("trailButton");
  const panel = document.getElementById("trailPanel");

  button.addEventListener("click", () => panel.classList.toggle("active"));
  document
    .getElementById("trailClose")
    .addEventListener("click", () => panel.classList.remove("active"));

  controls = buildFilter(features);
  document.getElementById("trailFilter").replaceChildren(...controls.rows);

  // On the map a click gives the short popup, in the list it goes straight in
  watchTrailClicks(map, (feature, lngLat) => {
    if (pick(feature.properties.slug)) openTrailPopup(map, feature, lngLat);
  });

  readHash();
  controls.write(filter);
  apply();

  openFromHash();
}

/**
 * Opens whatever #trail= in the url points at, so a trail can be linked to.
 */
function openFromHash() {
  const slug = new URLSearchParams(location.hash.slice(1)).get("trail");
  const feature = slug && trailBySlug(slug);

  if (!feature) return;

  pick(slug);
  openTrailDetail(mapRef, feature);
}

/**
 * Runs the filter, feeds both the map and the list, and records it in the url.
 */
function apply() {
  const matched = trails.filter((feature) => matches(feature.properties));

  showTrails(mapRef, matched);
  renderList(matched);
  writeHash();

  document.getElementById("trailCount").textContent =
    matched.length === trails.length
      ? `${trails.length}`
      : `${matched.length} / ${trails.length}`;
}

/**
 * Whether one trail survives the current filter. Distance, ascent, duration
 * and sport only mean something for routes, so places answer to their own
 * switch instead of being silently dropped by a range they cannot have.
 * @param {*} properties of a feature
 * @returns {boolean}
 */
function matches(properties) {
  if (!textMatches(properties)) return false;
  if (filter.country && properties.country !== filter.country) return false;
  if (!tagsMatch(properties)) return false;

  if (properties.kind === "place") return filter.places;

  if (filter.sport && !properties.sports?.[filter.sport]) return false;

  const duration = filter.sport
    ? properties.sports?.[filter.sport]?.duration_min
    : shortestDuration(properties);

  return (
    within(properties.distance_m / 1000, filter.distanceMin, filter.distanceMax) &&
    within(properties.ascent_m, "", filter.ascentMax) &&
    within(duration, "", filter.durationMax)
  );
}

/**
 * Name, region and tags, all compared without accents so that typing
 * "ovciarsko" finds "Ovčiarsko".
 * @param {*} properties
 * @returns {boolean}
 */
function textMatches(properties) {
  if (!filter.query) return true;

  const haystack = slugify(
    [properties.name, properties.region, ...(properties.tags ?? [])].join(" "),
  );

  return haystack.includes(slugify(filter.query));
}

/**
 * Every picked tag has to be there, so picking more narrows the list.
 * @param {*} properties
 * @returns {boolean}
 */
function tagsMatch(properties) {
  const tags = properties.tags ?? [];

  return filter.tags.every((tag) => tags.includes(tag));
}

/**
 * Whether a value sits inside a bound. Empty bounds mean no bound, and a
 * missing value only passes when nothing was asked of it.
 * @param {number|null|undefined} value
 * @param {string|number} min
 * @param {string|number} max
 * @returns {boolean}
 */
function within(value, min, max) {
  if (min === "" && max === "") return true;
  if (value === null || value === undefined) return false;

  return (
    (min === "" || value >= Number(min)) && (max === "" || value <= Number(max))
  );
}

/**
 * The quickest way to do a route, used when no sport is picked.
 * @param {*} properties
 * @returns {number|null} minutes
 */
function shortestDuration(properties) {
  const minutes = Object.values(properties.sports ?? {})
    .map((sport) => sport.duration_min)
    .filter((value) => typeof value === "number");

  return minutes.length ? Math.min(...minutes) : null;
}

/**
 * Builds every filter control out of what the data actually contains.
 * @param {*[]} features
 * @returns {{ rows: HTMLElement[], write: (filter: *) => void }}
 */
function buildFilter(features) {
  const query = input("search", "Search name, region, tag");
  query.addEventListener("input", () => {
    filter.query = query.value.trim();
    apply();
  });

  const sport = select([["", "Any sport"], ...sportOptions(features)]);
  sport.addEventListener("change", () => {
    filter.sport = sport.value;
    apply();
  });

  const country = select([
    ["", "Anywhere"],
    ...valuesOf(features, "country").map((code) => [code, code]),
  ]);
  country.addEventListener("change", () => {
    filter.country = country.value;
    apply();
  });

  const distanceMin = number("min");
  const distanceMax = number("max");
  const ascentMax = number("max");
  const durationMax = number("max");

  const bind = (element, key) =>
    element.addEventListener("input", () => {
      filter[key] = element.value;
      apply();
    });

  bind(distanceMin, "distanceMin");
  bind(distanceMax, "distanceMax");
  bind(ascentMax, "ascentMax");
  bind(durationMax, "durationMax");

  const places = document.createElement("input");
  places.type = "checkbox";
  places.className = "trailCheck";
  places.checked = CLEAR.places;
  places.addEventListener("change", () => {
    filter.places = places.checked;
    apply();
  });

  const chips = valuesOf(features, "tags").map((tag) => {
    const chip = document.createElement("button");
    chip.className = "trailChip";
    chip.textContent = tag;
    chip.addEventListener("click", () => {
      const on = chip.classList.toggle("on");

      filter.tags = on
        ? [...filter.tags, tag]
        : filter.tags.filter((value) => value !== tag);

      apply();
    });

    return chip;
  });

  const tagRow = document.createElement("div");
  tagRow.className = "trailChips";
  tagRow.append(...chips);

  const reset = document.createElement("button");
  reset.className = "trailReset";
  reset.textContent = "Reset filters";
  reset.addEventListener("click", () => {
    Object.assign(filter, { ...CLEAR, tags: [] });
    write(filter);
    apply();
  });

  const write = (values) => {
    query.value = values.query;
    sport.value = values.sport;
    country.value = values.country;
    distanceMin.value = values.distanceMin;
    distanceMax.value = values.distanceMax;
    ascentMax.value = values.ascentMax;
    durationMax.value = values.durationMax;
    places.checked = values.places;

    for (const chip of chips) {
      chip.classList.toggle("on", values.tags.includes(chip.textContent));
    }
  };

  return {
    rows: [
      query,
      row("Sport", sport),
      row("Distance", distanceMin, unit("–"), distanceMax, unit("km")),
      row("Ascent", ascentMax, unit("m")),
      row("Time", durationMax, unit("min")),
      row("Country", country),
      row("Places", places),
      ...(chips.length ? [tagRow] : []),
      reset,
    ],
    write,
  };
}

/**
 * Draws the list under the filter.
 * @param {*[]} matched
 */
function renderList(matched) {
  const list = document.getElementById("trailList");

  if (!matched.length) {
    const empty = document.createElement("p");
    empty.className = "trailEmpty";
    empty.textContent = "Nothing matches this filter.";
    list.replaceChildren(empty);
    return;
  }

  list.replaceChildren(...matched.map(listItem));

  function listItem(feature) {
    const { slug, name } = feature.properties;

    const item = document.createElement("button");
    item.className = "trailItem";
    item.dataset.slug = slug;
    item.classList.toggle("picked", slug === selectedTrail());

    const title = document.createElement("span");
    title.className = "trailItemName";
    title.textContent = name;

    const meta = document.createElement("span");
    meta.className = "trailItemMeta";
    meta.textContent = describe(feature.properties);

    item.append(title, meta);
    item.addEventListener("click", () => {
      if (pick(slug)) openTrailDetail(mapRef, feature);
    });
    item.addEventListener("pointerenter", () => hoverTrail(mapRef, slug));
    item.addEventListener("pointerleave", () => hoverTrail(mapRef, null));

    return item;
  }
}

/**
 * The line under a name in the list.
 * @param {*} properties
 * @returns {string}
 */
function describe(properties) {
  if (properties.kind === "place") {
    return [properties.place, `${properties.ele_m} m`, properties.region]
      .filter(Boolean)
      .join(" · ");
  }

  const sport = filter.sport || Object.keys(properties.sports ?? {})[0];
  const minutes = properties.sports?.[sport]?.duration_min;

  return [
    `${(properties.distance_m / 1000).toFixed(1)} km`,
    `↑ ${properties.ascent_m} m`,
    minutes ? `${sport} ${duration(minutes)}` : sport,
    properties.region,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Selects a trail everywhere at once: map, list and url. Clicking the one
 * already selected lets go of it instead.
 * @param {string|null} slug
 * @returns {boolean} whether something ended up selected
 */
function pick(slug) {
  const previous = selectedTrail();
  const next = slug === previous ? null : slug;

  closeTrailPopup();
  if (previous && previous !== next) closeTrailDetail(previous);

  selectTrail(mapRef, next);

  if (next) focusTrail(mapRef, trailBySlug(next));

  for (const item of document.querySelectorAll(".trailItem")) {
    item.classList.toggle("picked", item.dataset.slug === next);
  }

  writeHash();

  return Boolean(next);
}

/**
 * Reads the filter and the selection out of the url, so a filtered view can
 * be shared as a link.
 */
function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));

  for (const key of Object.keys(CLEAR)) {
    if (key === "tags" || key === "places") continue;
    if (params.has(key)) filter[key] = params.get(key);
  }

  if (params.has("tags")) filter.tags = params.get("tags").split(",");
  if (params.has("places")) filter.places = params.get("places") !== "false";
}

/**
 * Writes the filter into the url, but not on every keystroke: Safari refuses
 * more than about a hundred replaceState calls in half a minute.
 */
function writeHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(writeHashNow, 300);
}

let hashTimer = 0;

/**
 * Puts the filter and the selection into the url, leaving out defaults.
 */
function writeHashNow() {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filter)) {
    if (key === "tags") {
      if (value.length) params.set("tags", value.join(","));
    } else if (value !== CLEAR[key]) {
      params.set(key, String(value));
    }
  }

  const trail = selectedTrail();
  if (trail) params.set("trail", trail);

  const hash = params.toString();
  history.replaceState(null, "", hash ? `#${hash}` : location.pathname);
}

/**
 * Every value a property holds across the data, sorted, without repeats.
 * @param {*[]} features
 * @param {string} key
 * @returns {string[]}
 */
function valuesOf(features, key) {
  const values = new Set();

  for (const feature of features) {
    const value = feature.properties[key];
    if (Array.isArray(value)) value.forEach((entry) => values.add(entry));
    else if (value) values.add(value);
  }

  return [...values].sort();
}

/**
 * Every sport mentioned in the data.
 * @param {*[]} features
 * @returns {[string, string][]} value and label pairs
 */
function sportOptions(features) {
  const sports = new Set();

  for (const feature of features) {
    Object.keys(feature.properties.sports ?? {}).forEach((sport) =>
      sports.add(sport),
    );
  }

  return [...sports].sort().map((sport) => [sport, sport]);
}

/**
 * Minutes as hours and minutes once it passes an hour.
 * @param {number} minutes
 * @returns {string}
 */
function duration(minutes) {
  if (minutes < 60) return `${minutes} min`;

  const rest = minutes % 60;

  return rest ? `${Math.floor(minutes / 60)} h ${rest}` : `${minutes / 60} h`;
}

function row(label, ...children) {
  const element = document.createElement("div");
  element.className = "trailRow";

  const name = document.createElement("span");
  name.className = "trailRowLabel";
  name.textContent = label;

  element.append(name, ...children);

  return element;
}

function input(type, placeholder) {
  const element = document.createElement("input");
  element.type = type;
  element.className = "trailSearch";
  element.placeholder = placeholder;

  return element;
}

function number(placeholder) {
  const element = document.createElement("input");
  element.type = "number";
  element.className = "trailNumber";
  element.min = 0;
  element.placeholder = placeholder;

  return element;
}

function select(options) {
  const element = document.createElement("select");
  element.className = "trailSelect";

  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    element.append(option);
  }

  return element;
}

function unit(text) {
  const element = document.createElement("span");
  element.className = "trailUnit";
  element.textContent = text;

  return element;
}
