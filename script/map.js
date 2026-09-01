import * as maplibregl from "https://unpkg.com/maplibre-gl@6.5.0/dist/maplibre-gl.mjs";
import { boundsOf } from "./geo-utils.js";

const CURSOR_SOURCE = "source-cursor";

/** Exported so other layers can stack themselves under the cursor point. */
export const CURSOR_LAYER = "source-cursor--point";

/** Dark dashes read as "the reduced one" over any track color. */
const SIMPLIFIED_COLOR = "#292d3c";

/**
 * Creates the map and waits until it is ready to take sources and layers.
 * @param {string} container id of the container element
 * @returns Promise of a maplibre Map
 */
export async function createMap(container) {
  const map = new maplibregl.Map({
    container,
    style: "https://tiles.openfreemap.org/styles/bright",
    center: [18, 49],
    zoom: 8,
    attributionControl: { compact: true },
  });

  map.addControl(
    new maplibregl.NavigationControl({ visualizePitch: true }),
    "bottom-right",
  );

  map.addControl(
    new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
    }),
    "bottom-right",
  );

  await new Promise((resolve) => map.on("load", resolve));

  addCursorLayer(map);

  return map;
}

/**
 * Opens a popup with content built elsewhere. The only place that touches
 * maplibre directly, so nothing else has to import it.
 * @param {*} map maplibre Map
 * @param {*} lngLat where to anchor it
 * @param {HTMLElement} content
 * @returns {*} the popup, to remove later
 */
export function showPopup(map, lngLat, content) {
  return new maplibregl.Popup({
    closeButton: false,
    offset: 12,
    maxWidth: "260px",
  })
    .setLngLat(lngLat)
    .setDOMContent(content)
    .addTo(map);
}

/**
 * Adds the empty layer that later marks the graph cursor.
 * @param {*} map maplibre Map
 */
function addCursorLayer(map) {
  map.addSource(CURSOR_SOURCE, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addLayer({
    id: CURSOR_LAYER,
    type: "circle",
    source: CURSOR_SOURCE,
    layout: { visibility: "none" },
    paint: {
      "circle-radius": 5,
      "circle-color": "#ffffff",
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
    },
  });
}

/**
 * Puts the cursor point on a coordinate.
 * @param {*} map maplibre Map
 * @param {[number, number]} coord [lng, lat]
 * @param {string} color color of the track being hovered
 */
export function showCursor(map, coord, color) {
  map.getSource(CURSOR_SOURCE).setData({
    type: "Feature",
    geometry: { type: "Point", coordinates: coord },
    properties: {},
  });

  map.setPaintProperty(CURSOR_LAYER, "circle-color", color);
  map.setLayoutProperty(CURSOR_LAYER, "visibility", "visible");
}

/**
 * Hides the cursor point.
 * @param {*} map maplibre Map
 */
export function hideCursor(map) {
  map.setLayoutProperty(CURSOR_LAYER, "visibility", "none");
}

/**
 * Adds the original track as its own source + line layer.
 * @param {*} map maplibre Map
 * @param {*} state layer state ({ id, geoJson, style })
 */
export function addTrackLayer(map, state) {
  map.addSource(state.id, { type: "geojson", data: state.geoJson });

  map.addLayer(
    {
      id: lineLayerId(state.id),
      type: "line",
      source: state.id,
      layout: {
        "line-cap": "round",
        "line-join": "round",
        visibility: state.style.visible ? "visible" : "none",
      },
      paint: {
        "line-color": state.style.color,
        "line-width": state.style.width,
        "line-opacity": state.style.opacity,
      },
      filter: ["==", "$type", "LineString"],
    },
    CURSOR_LAYER, // Tracks stack under the cursor point, never over it
  );
}

/**
 * Adds the simplified track as a second, dashed layer over the original.
 * @param {*} map maplibre Map
 * @param {*} state layer state with a filled simplify slot
 */
export function addSimplifiedLayer(map, state) {
  map.addSource(simplifiedSourceId(state.id), {
    type: "geojson",
    data: state.simplify.processed.geoJson,
  });

  map.addLayer(
    {
      id: simplifiedLayerId(state.id),
      type: "line",
      source: simplifiedSourceId(state.id),
      layout: { "line-join": "round" },
      paint: {
        "line-color": SIMPLIFIED_COLOR,
        "line-width": 2,
        "line-dasharray": [2, 1.5],
      },
    },
    CURSOR_LAYER,
  );
}

/**
 * Feeds a new simplification to the map. The only call on the slider path.
 * @param {*} map maplibre Map
 * @param {*} state layer state
 */
export function updateSimplifiedData(map, state) {
  map
    .getSource(simplifiedSourceId(state.id))
    .setData(state.simplify.processed.geoJson);
}

/**
 * Whether the simplified layer of a state is already on the map.
 * @param {*} map maplibre Map
 * @param {*} state layer state
 * @returns {boolean}
 */
export function hasSimplifiedLayer(map, state) {
  return Boolean(map.getLayer(simplifiedLayerId(state.id)));
}

/**
 * Pushes the current style of a state onto its layers.
 * @param {*} map maplibre Map
 * @param {*} state layer state
 */
export function updateTrackStyle(map, state) {
  const id = lineLayerId(state.id);
  const { color, width, opacity, visible } = state.style;

  map.setPaintProperty(id, "line-color", color);
  map.setPaintProperty(id, "line-width", width);
  map.setPaintProperty(id, "line-opacity", opacity);
  map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");

  if (!hasSimplifiedLayer(map, state)) return;

  // The reduced track only shows while the layer is shown and asked for
  map.setLayoutProperty(
    simplifiedLayerId(state.id),
    "visibility",
    visible && state.simplify?.active ? "visible" : "none",
  );
}

/**
 * Removes a track from the map. The layer has to go before its source.
 * @param {*} map maplibre Map
 * @param {*} state layer state
 */
export function removeTrackLayer(map, state) {
  if (hasSimplifiedLayer(map, state)) {
    map.removeLayer(simplifiedLayerId(state.id));
    map.removeSource(simplifiedSourceId(state.id));
  }

  map.removeLayer(lineLayerId(state.id));
  map.removeSource(state.id);
}

/**
 * Zooms the map to fit a whole track.
 * @param {*} map maplibre Map
 * @param {*} geoJSONcontent GeoJson object
 */
export function fitToTrack(map, geoJSONcontent) {
  const bounds = boundsOf(geoJSONcontent);

  if (bounds) map.fitBounds(bounds, { padding: 40 });
}

/**
 * Id of the line layer belonging to a layer state.
 * @param {string} stateId
 * @returns {string} maplibre layer id
 */
function lineLayerId(stateId) {
  return `${stateId}--lines`;
}

/**
 * Ids of the simplified twin of a layer.
 * @param {string} stateId
 * @returns {string}
 */
function simplifiedSourceId(stateId) {
  return `${stateId}--simplified`;
}

function simplifiedLayerId(stateId) {
  return `${stateId}--simplified-lines`;
}
