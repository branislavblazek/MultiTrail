import { CURSOR_LAYER, fitToTrack } from "./map.js";

const SOURCE = "source-trails";

const LAYER = {
  routes: `${SOURCE}--routes`,
  places: `${SOURCE}--places`,
  routeHits: `${SOURCE}--route-hits`,
  placeHits: `${SOURCE}--place-hits`,
};

/** Recommended trails get one colour of their own, whatever layers do. */
export const COLOR = "#0f766e";

/** How much unselected trails fade once one of them is picked. */
const OPACITY = { plain: 0.85, faded: 0.2 };

/** Everything loaded, so filtering can pick from it without fetching again. */
let all = [];

/** What is drawn right now, and the one trail drawn in full resolution. */
let drawn = [];
let detailed = null;

/** The slug now selected, and the one under the pointer. */
let selected = null;
let hovered = null;

/**
 * Loads the recommended trails and draws them.
 * @param {*} map maplibre Map
 * @param {string} url where trails.geojson lives
 * @returns {Promise<*[]>} the features, for the panel to filter
 */
export async function loadTrails(map, url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const collection = await response.json();
  all = collection.features ?? [];

  map.addSource(SOURCE, {
    type: "geojson",
    data: collection,
    promoteId: "slug", // Lets feature-state key on the slug we authored
  });

  // Fat transparent copies first: they are the click and hover targets,
  // because a 3px line is not something a finger can hit.
  map.addLayer(
    {
      id: LAYER.routeHits,
      type: "line",
      source: SOURCE,
      filter: ["==", ["get", "kind"], "route"],
      paint: { "line-width": 14, "line-opacity": 0 },
    },
    CURSOR_LAYER,
  );

  map.addLayer(
    {
      id: LAYER.placeHits,
      type: "circle",
      source: SOURCE,
      filter: ["==", ["get", "kind"], "place"],
      paint: { "circle-radius": 12, "circle-opacity": 0 },
    },
    CURSOR_LAYER,
  );

  map.addLayer(
    {
      id: LAYER.routes,
      type: "line",
      source: SOURCE,
      filter: ["==", ["get", "kind"], "route"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": COLOR,
        "line-width": liftedOr(5, 3),
        "line-opacity": liftedOr(1, OPACITY.plain),
      },
    },
    CURSOR_LAYER,
  );

  map.addLayer(
    {
      id: LAYER.places,
      type: "circle",
      source: SOURCE,
      filter: ["==", ["get", "kind"], "place"],
      paint: {
        "circle-color": COLOR,
        "circle-radius": liftedOr(7, 5),
        "circle-opacity": liftedOr(1, OPACITY.plain),
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    },
    CURSOR_LAYER,
  );

  return all;
}

/**
 * Shows only these trails. The panel hands over what its filter kept.
 * @param {*} map maplibre Map
 * @param {*[]} features
 */
export function showTrails(map, features) {
  drawn = features;
  paint(map);

  // A trail that got filtered out cannot stay selected
  if (selected && !features.some((f) => f.properties.slug === selected)) {
    selectTrail(map, null);
  }
}

/**
 * Swaps one trail for its full resolution geometry, or takes it back with a
 * null slug. Overview geometry is simplified to 10 m, which is invisible from
 * far away but shows once the detail zooms in on it.
 * @param {*} map maplibre Map
 * @param {string|null} slug
 * @param {[number, number, number?][]} [coordinates]
 */
export function showDetailedGeometry(map, slug, coordinates) {
  detailed = slug ? { slug, coordinates } : null;
  paint(map);
}

/**
 * Feeds the source: what the filter kept, with the detailed geometry patched
 * in. One source, so no second layer and no doubled line to keep in order.
 * @param {*} map maplibre Map
 */
function paint(map) {
  const features = drawn.map((feature) =>
    feature.properties.slug === detailed?.slug
      ? {
          ...feature,
          geometry: { ...feature.geometry, coordinates: detailed.coordinates },
        }
      : feature,
  );

  map.getSource(SOURCE).setData({ type: "FeatureCollection", features });
}

/**
 * Picks a trail out, or clears the pick with null. The picked one is drawn
 * thicker and the rest fade back.
 * @param {*} map maplibre Map
 * @param {string|null} slug
 */
export function selectTrail(map, slug) {
  if (selected) {
    map.setFeatureState({ source: SOURCE, id: selected }, { picked: false });
  }

  selected = slug;

  if (slug) {
    map.setFeatureState({ source: SOURCE, id: slug }, { picked: true });
  }

  const plain = slug ? OPACITY.faded : OPACITY.plain;

  map.setPaintProperty(LAYER.routes, "line-opacity", liftedOr(1, plain));
  map.setPaintProperty(LAYER.places, "circle-opacity", liftedOr(1, plain));
}

/**
 * The trail now selected.
 * @returns {string|null} slug
 */
export function selectedTrail() {
  return selected;
}

/**
 * Lifts a trail while the pointer is on its row in the panel.
 * @param {*} map maplibre Map
 * @param {string|null} slug
 */
export function hoverTrail(map, slug) {
  if (hovered) {
    map.setFeatureState({ source: SOURCE, id: hovered }, { hovered: false });
  }

  hovered = slug;

  if (slug) {
    map.setFeatureState({ source: SOURCE, id: slug }, { hovered: true });
  }
}

/**
 * Moves the map onto a trail. Lines get their bounds, single points a zoom.
 * @param {*} map maplibre Map
 * @param {*} feature
 */
export function focusTrail(map, feature) {
  if (feature.geometry.type === "Point") {
    map.flyTo({ center: feature.geometry.coordinates, zoom: 14 });
    return;
  }

  fitToTrack(map, feature);
}

/**
 * Runs a handler when a trail is clicked, and shows a pointer over one.
 * @param {*} map maplibre Map
 * @param {(feature: *) => void} onPick
 */
export function watchTrailClicks(map, onPick) {
  const targets = [LAYER.routeHits, LAYER.placeHits];

  map.on("click", targets, (evt) => onPick(evt.features[0], evt.lngLat));

  map.on("mouseenter", targets, () => {
    map.getCanvas().style.cursor = "pointer";
  });

  map.on("mouseleave", targets, () => {
    map.getCanvas().style.cursor = "";
  });
}

/**
 * Finds a loaded trail by its slug.
 * @param {string} slug
 * @returns {*} feature, or undefined
 */
export function trailBySlug(slug) {
  return all.find((feature) => feature.properties.slug === slug);
}

/**
 * Expression picking one value for the trail that is selected or under the
 * pointer, and another for the rest.
 * @param {*} lifted
 * @param {*} rest
 * @returns {*[]} maplibre expression
 */
function liftedOr(lifted, rest) {
  return [
    "case",
    ["boolean", ["feature-state", "picked"], false],
    lifted,
    ["boolean", ["feature-state", "hovered"], false],
    lifted,
    rest,
  ];
}
