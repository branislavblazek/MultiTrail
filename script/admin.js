/** Where the app runs when it is opened from the machine it is authored on. */
const LOCAL = ["localhost", "127.0.0.1", "[::1]"];

/**
 * Turns admin mode on when there is something to write through: the local
 * tools/admin-server.mjs, which answers under ./api. Any other server has no
 * such address, and away from localhost the question is not even asked, so
 * a visitor pays for none of this.
 *
 * Nothing is guarded here, and nothing has to be: the editor is useless
 * without the server, and the server only listens on the author's machine.
 * @param {*} map maplibre Map
 * @param {*[]} trails everything trails.geojson holds
 */
export async function initAdmin(map, trails) {
  if (!LOCAL.includes(location.hostname)) return;

  try {
    const response = await fetch("./api/admin");
    if (!response.ok) return;

    const { admin } = await response.json();
    if (!admin) return;
  } catch {
    return; // A plain static server, or one that answers with a page
  }

  // The editor is the heavy half, fetched only once it has a server to talk to
  const { startAdmin } = await import("./admin-editor.js");

  startAdmin(map, trails);
}
