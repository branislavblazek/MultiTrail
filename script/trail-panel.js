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
  openTrailDetail,
  closeTrailDetail,
  onTrailDetailClosed,
} from "./trail-detail.js";
import { SPORTS, COUNTRIES, PLACES, shape, plural } from "./labels.js";

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

/** Where the sheet may come to rest. */
const SNAPS = ["peek", "list", "full"];

const filter = { ...CLEAR };

let mapRef = null;
let trails = [];
let controls = null;
let matching = [];

/**
 * Builds the trails sheet: the handle, the summary, the filters and the list.
 * @param {*} map maplibre Map
 * @param {*[]} features everything trails.geojson holds
 */
export function initTrailPanel(map, features) {
  mapRef = map;
  trails = features;

  initSheet();
  initFilterSheet();

  onTrailDetailClosed(() => pick(null));

  controls = buildFilter(features);
  document.getElementById("filterGrid").replaceChildren(...controls.fields);

  // A click on the map opens the detail, the same as a tap in the list
  watchTrailClicks(map, (feature) => {
    if (pick(feature.properties.slug)) openTrailDetail(map, feature);
  });

  readHash();
  controls.write(filter);
  apply();

  openFromHash();
}

/**
 * Drag and tap on the handle, moving the sheet between its three stops.
 */
function initSheet() {
  const sheet = document.getElementById("sheet");
  const handle = document.getElementById("sheetHandle");

  let start = null;

  const snapTo = (name) => {
    sheet.classList.remove(...SNAPS, "dragging");
    sheet.style.height = "";
    sheet.classList.add(name);
  };

  // Desktop only: the chrome button folds the whole column away
  document.getElementById("trailsButton").addEventListener("click", () => {
    sheet.classList.toggle("closed");
  });

  handle.addEventListener("pointerdown", (evt) => {
    start = { y: evt.clientY, height: sheet.getBoundingClientRect().height };
    handle.setPointerCapture(evt.pointerId);
    sheet.classList.add("dragging");
  });

  handle.addEventListener("pointermove", (evt) => {
    if (!start) return;

    // Dragging up grows the sheet, so the delta is inverted
    const height = start.height - (evt.clientY - start.y);
    sheet.style.height = `${Math.max(80, Math.min(height, innerHeight * 0.95))}px`;
  });

  handle.addEventListener("pointerup", (evt) => {
    if (!start) return;

    const moved = Math.abs(evt.clientY - start.y);
    const height = sheet.getBoundingClientRect().height;

    start = null;

    // A tap cycles, a drag lands on whichever stop ended up closest
    snapTo(moved < 8 ? next(sheet) : nearest(height));
  });

  sheet.dataset.snap = "peek";
}

/**
 * The stop after the one the sheet is at, wrapping around.
 * @param {HTMLElement} sheet
 * @returns {string} snap name
 */
function next(sheet) {
  const at = SNAPS.findIndex((name) => sheet.classList.contains(name));

  return SNAPS[(at + 1) % SNAPS.length];
}

/**
 * The stop closest to a height the finger left the sheet at.
 * @param {number} height pixels
 * @returns {string} snap name
 */
function nearest(height) {
  const share = height / innerHeight;

  if (share < 0.3) return "peek";

  return share < 0.75 ? "list" : "full";
}

/**
 * Opens and closes the filter overlay.
 */
function initFilterSheet() {
  const sheet = document.getElementById("sheet");
  const panel = document.getElementById("filterSheet");

  const list = document.getElementById("trailList");
  const summary = document.getElementById("sheetSummary");

  const open = (visible) => {
    panel.hidden = !visible;
    list.hidden = visible;
    summary.hidden = visible;

    if (!visible) return;

    // Filters need room, so opening them pulls the sheet all the way up
    sheet.classList.remove(...SNAPS);
    sheet.style.height = "";
    sheet.classList.add("full");
  };

  open(false); // Not left to the hidden attribute surviving in the markup

  document
    .getElementById("filterButton")
    .addEventListener("click", () => open(panel.hidden));

  for (const id of ["filterClose", "filterApply"]) {
    document.getElementById(id).addEventListener("click", () => open(false));
  }

  for (const id of ["resetButton", "filterReset"]) {
    document.getElementById(id).addEventListener("click", () => {
      Object.assign(filter, { ...CLEAR, tags: [] });
      controls.write(filter);
      apply();
    });
  }
}

/**
 * Runs the filter, feeds both the map and the list, and records it in the url.
 */
function apply() {
  matching = trails.filter((feature) => matches(feature.properties));

  showTrails(mapRef, matching);
  renderList(matching);
  writeHash();

  document.getElementById("trailCount").textContent =
    matching.length === trails.length
      ? `${trails.length}`
      : `${matching.length} / ${trails.length}`;

  document.getElementById("filterApply").textContent =
    matching.length === 0
      ? "Žiadne výsledky"
      : `Zobraziť ${matching.length} ${plural(matching.length, "výsledok", "výsledky", "výsledkov")}`;
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
    within(
      properties.distance_m / 1000,
      filter.distanceMin,
      filter.distanceMax,
    ) &&
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
 * @returns {{ fields: HTMLElement[], write: (filter: *) => void }}
 */
function buildFilter(features) {
  const query = input("search", "Názov, región alebo tag");
  const sport = select([
    ["", "Všetky športy"],
    ...valuesIn(features, "sports")
      .map((key) => [key, SPORTS[key] ?? key])
      .sort(([, a], [, b]) => a.localeCompare(b, "sk")),
  ]);
  const country = select([
    ["", "Kdekoľvek"],
    ...valuesOf(features, "country").map((code) => [
      code,
      COUNTRIES[code] ?? code,
    ]),
  ]);

  const distanceMin = number("km");
  const distanceMax = number("km");
  const ascentMax = number("m");
  const durationMax = number("min");

  const bind = (element, key, event) =>
    element.addEventListener(event, () => {
      filter[key] = element.value.trim?.() ?? element.value;
      apply();
    });

  bind(query, "query", "input");
  bind(sport, "sport", "change");
  bind(country, "country", "change");
  bind(distanceMin, "distanceMin", "input");
  bind(distanceMax, "distanceMax", "input");
  bind(ascentMax, "ascentMax", "input");
  bind(durationMax, "durationMax", "input");

  const places = document.createElement("input");
  places.type = "checkbox";
  places.className = "filterToggle";
  places.checked = CLEAR.places;
  places.addEventListener("change", () => {
    filter.places = places.checked;
    apply();
  });

  const chips = valuesOf(features, "tags").map((tag) => {
    const chip = document.createElement("button");
    chip.className = "filterChip";
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

  const chipRow = document.createElement("div");
  chipRow.className = "filterChips";
  chipRow.append(...chips);

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
    fields: [
      field("Hľadať", query, true),
      field("Šport", sport),
      field("Krajina", country),
      field("Vzdialenosť od", distanceMin),
      field("do", distanceMax),
      field("Max. stúpanie", ascentMax),
      field("Max. čas", durationMax),
      toggleRow("Zobraziť miesta", places),
      ...(chips.length ? [chipRow] : []),
    ],
    write,
  };
}

/**
 * Draws the list under the summary.
 * @param {*[]} matched
 */
function renderList(matched) {
  const list = document.getElementById("trailList");

  if (!matched.length) {
    const empty = document.createElement("p");
    empty.className = "trailEmpty";
    empty.textContent = "Nič nevyhovuje tomuto filtru.";
    list.replaceChildren(empty);
    return;
  }

  list.replaceChildren(...matched.map(listItem));
}

/**
 * One row: the name and the headline number on top, the details under it.
 * @param {*} feature
 * @returns {HTMLElement}
 */
function listItem(feature) {
  const properties = feature.properties;
  const { slug, name, kind } = properties;
  const place = kind === "place";

  const item = document.createElement("button");
  item.className = "trailItem";
  item.dataset.slug = slug;
  item.classList.toggle("picked", slug === selectedTrail());

  item.append(
    span("trailItemDot"),
    span("trailItemName", name),
    span(
      "trailItemHeadline",
      place
        ? `${properties.ele_m} m`
        : `${(properties.distance_m / 1000).toFixed(1)} km`,
    ),
    span("trailItemWhere", where(properties)),
  );

  if (place) {
    item.append(span("trailItemNumbers", PLACES[properties.place] ?? ""));
  } else {
    item.append(
      span(
        "trailItemNumbers",
        `↑ ${properties.ascent_m} m · ↓ ${properties.descent_m} m`,
      ),
      span("trailItemSports", sportsLine(properties)),
    );
  }

  item.addEventListener("click", () => {
    if (pick(slug)) openTrailDetail(mapRef, feature);
  });
  item.addEventListener("pointerenter", () => hoverTrail(mapRef, slug));
  item.addEventListener("pointerleave", () => hoverTrail(mapRef, null));

  return item;
}

/**
 * "Žilina, SK · okruh"
 * @param {*} properties
 * @returns {string}
 */
function where(properties) {
  return [
    [properties.region, properties.country].filter(Boolean).join(", "),
    properties.kind === "place" ? null : shape(properties.loop),
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * "beh 1 h 10 · turistika 3 h 15"
 * @param {*} properties
 * @returns {string}
 */
function sportsLine(properties) {
  return Object.entries(properties.sports ?? {})
    .map(([sport, value]) =>
      value.duration_min
        ? `${SPORTS[sport] ?? sport} ${duration(value.duration_min)}`
        : (SPORTS[sport] ?? sport),
    )
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
 * Every key of an object valued property, across the data.
 * @param {*[]} features
 * @param {string} key
 * @returns {string[]}
 */
function valuesIn(features, key) {
  const keys = new Set();

  for (const feature of features) {
    Object.keys(feature.properties[key] ?? {}).forEach((entry) =>
      keys.add(entry),
    );
  }

  return [...keys].sort();
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

function field(label, control, wide = false) {
  const element = document.createElement("div");
  element.className = wide ? "filterField wide" : "filterField";

  const name = document.createElement("label");
  name.className = "filterLabel";
  name.textContent = label;
  name.append(control);

  element.append(name);

  return element;
}

function toggleRow(label, control) {
  const element = document.createElement("label");
  element.className = "filterToggleRow";

  const name = document.createElement("span");
  name.className = "filterToggleLabel";
  name.textContent = label;

  element.append(name, control);

  return element;
}

function span(className, text = "") {
  const element = document.createElement("span");
  element.className = className;
  element.textContent = text;

  return element;
}

function input(type, placeholder) {
  const element = document.createElement("input");
  element.type = type;
  element.className = "filterInput";
  element.placeholder = placeholder;

  return element;
}

function number(placeholder) {
  const element = document.createElement("input");
  element.type = "number";
  element.className = "filterInput";
  element.min = 0;
  element.placeholder = placeholder;

  return element;
}

function select(options) {
  const element = document.createElement("select");
  element.className = "filterSelect";

  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    element.append(option);
  }

  return element;
}
