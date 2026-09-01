/** What the panel is showing: an id and what to undo when it goes away. */
let shown = null;

/**
 * Wires the close button and the escape key of the shared bottom panel.
 * Two things fill it: the profile of a layer and the detail of a trail.
 */
export function initDetailPanel() {
  document
    .getElementById("detailClose")
    .addEventListener("click", () => hideDetail());

  document.addEventListener("keydown", (evt) => {
    if (evt.key === "Escape") hideDetail();
  });
}

/**
 * Fills the panel and slides it up. Replacing what is shown runs the previous
 * onClose first, so nothing it left behind on the map stays there.
 * @param {*} detail
 * @param {string} detail.id what is being shown, to close it by
 * @param {string} detail.title
 * @param {string} [detail.meta] the line under the title
 * @param {HTMLElement[]} detail.body
 * @param {() => void} [detail.onClose]
 */
export function showDetail({ id, title, meta = "", body, onClose }) {
  shown?.onClose?.();
  shown = { id, onClose };

  document.getElementById("detailTitle").textContent = title;
  document.getElementById("detailMeta").textContent = meta;
  document.getElementById("detailBody").replaceChildren(...body);
  document.getElementById("detailPanel").classList.add("active");
}

/**
 * Rewrites part of what is on screen, for numbers that arrive late. Ignored
 * once something else took the panel over.
 * @param {string} id
 * @param {{ meta?: string, body?: HTMLElement[] }} parts
 */
export function updateDetail(id, { meta, body }) {
  if (shown?.id !== id) return;

  if (meta !== undefined) {
    document.getElementById("detailMeta").textContent = meta;
  }

  if (body) document.getElementById("detailBody").replaceChildren(...body);
}

/**
 * Closes the panel.
 * @param {string} [id] close only when this is what is shown
 */
export function hideDetail(id) {
  if (!shown || (id !== undefined && id !== shown.id)) return;

  shown.onClose?.();
  shown = null;

  document.getElementById("detailPanel").classList.remove("active");
}

/**
 * What the panel is showing.
 * @returns {string|null} id
 */
export function shownDetail() {
  return shown?.id ?? null;
}
