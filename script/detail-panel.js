/** What the panel is showing: an id and what to undo when it goes away. */
let shown = null;

/**
 * Wires the close button and the escape key of the shared bottom sheet.
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
 * Fills the sheet and slides it up. Replacing what is shown runs the previous
 * onClose first, so nothing it left behind on the map stays there.
 * @param {*} detail
 * @param {string} detail.id what is being shown, to close it by
 * @param {string} detail.eyebrow the small line above the title
 * @param {string} detail.title
 * @param {HTMLElement[]} detail.body
 * @param {() => void} [detail.onClose]
 */
export function showDetail({ id, eyebrow, title, body, onClose }) {
  // Detached before the callback runs: an onClose that closes this panel
  // again would otherwise loop on itself
  const previous = shown;
  shown = null;
  previous?.onClose?.();

  shown = { id, onClose };

  document.getElementById("detailEyebrow").textContent = eyebrow;
  document.getElementById("detailTitle").textContent = title;
  document.getElementById("detailBody").replaceChildren(...body);
  document.getElementById("detailPanel").classList.add("active");

  // The trails sheet steps aside for it on a phone
  document.body.classList.add("detail-open");
}

/**
 * Closes the sheet.
 * @param {string} [id] close only when this is what is shown
 */
export function hideDetail(id) {
  if (!shown || (id !== undefined && id !== shown.id)) return;

  const closing = shown;
  shown = null;
  closing.onClose?.();

  document.getElementById("detailPanel").classList.remove("active");
  document.body.classList.remove("detail-open");
}

/**
 * What the sheet is showing.
 * @returns {string|null} id
 */
export function shownDetail() {
  return shown?.id ?? null;
}

/**
 * A row of big numbers with their units under them.
 * @param {{ value: string, label: string }[]} stats
 * @returns {HTMLElement}
 */
export function createStats(stats) {
  const row = document.createElement("div");
  row.className = "detailStats";

  for (const { value, label } of stats) {
    const stat = document.createElement("div");
    stat.className = "detailStat";

    const number = document.createElement("span");
    number.className = "detailStatValue";
    number.textContent = value;

    const unit = document.createElement("span");
    unit.className = "detailStatLabel";
    unit.textContent = label;

    stat.append(number, unit);
    row.append(stat);
  }

  return row;
}

/**
 * A section heading with a number on the right, like the elevation range next
 * to the profile.
 * @param {string} label
 * @returns {{ row: HTMLElement, aside: HTMLElement }}
 */
export function createSection(label) {
  const row = document.createElement("div");
  row.className = "detailSection";

  const name = document.createElement("span");
  name.className = "eyebrow detailSectionLabel";
  name.textContent = label;

  const aside = document.createElement("span");
  aside.className = "detailSectionAside";

  row.append(name, aside);

  return { row, aside };
}
