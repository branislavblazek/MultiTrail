import * as maplibregl from "https://unpkg.com/maplibre-gl@6.5.0/dist/maplibre-gl.mjs";
import { boundsOf } from "./geo-utils.js";

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
  });

  await new Promise((resolve) => map.on("load", resolve));

  return map;
}

/**
 * Adds the original track as its own source + line layer.
 * @param {*} map maplibre Map
 * @param {*} state layer state ({ id, geoJson, style })
 */
export function addTrackLayer(map, state) {
  map.addSource(state.id, { type: "geojson", data: state.geoJson });

  map.addLayer({
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
  });
}

/**
 * Pushes the current style of a state onto its layer.
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
}

/**
 * Removes a track from the map. The layer has to go before its source.
 * @param {*} map maplibre Map
 * @param {*} state layer state
 */
export function removeTrackLayer(map, state) {
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
