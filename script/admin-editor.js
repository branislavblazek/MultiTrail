import {
  addTrackLayer,
  removeTrackLayer,
  addSimplifiedLayer,
  updateSimplifiedData,
  fitToTrack,
} from "./map.js";
import { createGeoJson, isLoop, parseTrack, trackStats } from "./geo-utils.js";
import {
  prepare,
  applyTolerance,
  reduceAt,
  DEFAULT_TOLERANCE,
} from "./simplify.js";
import { coordsToGpx } from "./gpx-export.js";
import {
  slugify,
  measured,
  emptyProperties,
  publishedCoordinates,
} from "./publish.js";
import {
  createStats,
  createSection,
  hideDetail,
  shownDetail,
} from "./detail-panel.js";
import { addTrailDetailAction } from "./trail-detail.js";
import { trailBySlug } from "./trails.js";
import { SPORTS, COUNTRIES, DIFFICULTY } from "./labels.js";

const API = "./api/trails";
const STRAVA = "./api/strava";

/** The page that ends the Strava consent says here that it went through. */
const STRAVA_CHANNEL = "multitrail-strava";

/** Every write carries it, and the server refuses the ones that do not. */
const WRITE_HEADERS = { "X-MultiTrail-Admin": "1" };

/** The shape the server and tools/reduce-photo.sh insist on as well. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Most trails are at home, so a new one starts there. */
const HOME_COUNTRY = "SK";

/**
 * The track being authored, on the map: the picked gpx in the accent green,
 * and over it, in dark dashes, the reduced line that will be published. The
 * same pair the simplify fold of a layer draws.
 */
const PREVIEW = "admin-preview";
const PREVIEW_STYLE = { width: 6, color: "#56e39f", opacity: 1, visible: true };

/** Carries a message across the reload that follows a save. */
const TOAST_KEY = "multitrail-admin-toast";

let mapRef = null;
let trails = [];

/** The panel, built once. */
let ui = null;

/** What is being edited: a trail, or null in feature for a new one. */
let session = null;

/** Takes the delete question back when it is left unanswered. */
let deleteTimer = 0;

/**
 * Starts admin mode: the badge, the way to a new trail, the edit button on
 * every trail card, and the editor behind both.
 * @param {*} map maplibre Map
 * @param {*[]} features everything trails.geojson holds
 */
export async function startAdmin(map, features) {
  mapRef = map;
  trails = features;

  await loadStyles();

  buildChrome();
  buildPanel();

  addTrailDetailAction(editButton);

  // A card opened from the url was built before admin mode got this far
  const open = trailBySlug(shownDetail() ?? "");
  const button = open && editButton(open);
  if (button) document.getElementById("detailBody").append(button);

  // Strava got connected in its own window: carry on with what waited for it
  new BroadcastChannel(STRAVA_CHANNEL).addEventListener("message", () => {
    if (session?.form.track.connect.done()) loadFromStrava();
  });

  showPendingToast();
}

/**
 * Admin styles live in a file of their own, so a visitor never downloads
 * them. Waited for, so nothing is drawn unstyled first.
 * @returns {Promise<void>}
 */
function loadStyles() {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./admin.css";

  const loaded = new Promise((resolve) => {
    link.addEventListener("load", resolve);
    link.addEventListener("error", resolve);
  });

  document.head.append(link);

  return loaded;
}

/**
 * Marks the brand, so admin mode is never mistaken for the public app, and
 * adds the button that starts a new trail.
 */
function buildChrome() {
  document.getElementById("brand").append(el("span", "adminBadge", "admin"));

  const button = el("button", "chromeButton");
  button.id = "adminNewButton";
  button.title = "Pridať novú trasu";
  button.append(
    el("span", "chromeIcon", "＋"),
    el("span", "chromeLabel", "Nová trasa"),
  );
  button.addEventListener("click", () => openEditor(null));

  document.getElementById("chrome").prepend(button);
}

/**
 * The edit button of a trail card. Places are not edited here yet.
 * @param {*} feature
 * @returns {HTMLElement|null}
 */
function editButton(feature) {
  if (feature.properties.kind !== "route") return null;

  const button = el("button", "adminEdit", "Upraviť trasu");
  button.addEventListener("click", () => openEditor(feature));

  return button;
}

/**
 * Builds the empty editor: a head, a scrolling body the form goes into, and
 * a foot that keeps the save button in reach however long the form is.
 */
function buildPanel() {
  const panel = el("section", "");
  panel.id = "adminPanel";
  panel.inert = true; // Off screen, so out of the tab order as well

  const eyebrow = el("span", "eyebrow");
  const title = el("h2", "");
  title.id = "adminTitle";

  const close = el("button", "", "✕");
  close.id = "adminClose";
  close.title = "Zavrieť editor";
  close.addEventListener("click", () => closeEditor());

  const head = el("div", "");
  head.id = "adminHead";
  head.append(eyebrow, title, close);

  const body = el("div", "");
  body.id = "adminBody";
  body.addEventListener("input", touch);

  const status = el("p", "adminHint");
  status.id = "adminStatus";
  status.setAttribute("role", "status");

  const save = el("button", "adminPrimary");
  save.addEventListener("click", saveTrail);

  const remove = el("button", "resetLink");
  remove.id = "adminDelete";
  remove.addEventListener("click", deleteTrail);

  const foot = el("div", "");
  foot.id = "adminFoot";
  foot.append(status, save, remove);

  panel.append(head, body, foot);
  document.body.append(panel);

  // The shortcut every editor answers to
  document.addEventListener("keydown", (evt) => {
    if (!session || evt.key !== "s" || !(evt.metaKey || evt.ctrlKey)) return;

    evt.preventDefault();
    saveTrail();
  });

  ui = { panel, eyebrow, title, body, status, save, remove };
}

/**
 * Opens the editor on a trail, or empty for a new one.
 * @param {*|null} feature
 */
function openEditor(feature) {
  if (!closeEditor()) return;

  // A new trail belongs to no card. An edited one keeps its card open
  // underneath, which is also what keeps it picked out on the map.
  if (!feature) hideDetail();

  session = { feature, track: null, photo: null, dirty: false, form: null };
  session.form = buildForm(feature);

  ui.eyebrow.textContent = feature
    ? "Admin · úprava trasy"
    : "Admin · nová trasa";
  ui.save.textContent = feature ? "Uložiť zmeny" : "Pridať trasu";
  ui.save.disabled = false;
  ui.remove.hidden = !feature;
  disarmDelete();
  say("");

  ui.body.replaceChildren(...session.form.nodes);
  ui.body.scrollTop = 0;
  session.form.paint();

  ui.panel.inert = false;
  ui.panel.classList.add("active");

  // The editor is wider than the card the trail was fitted around
  if (feature) fitToTrack(mapRef, feature, previewPadding());
}

/**
 * Closes the editor and takes its preview off the map.
 * @returns {boolean} false when the author chose to keep editing
 */
function closeEditor() {
  if (!session) return true;

  if (session.dirty && !confirm("Zahodiť neuložené zmeny?")) return false;

  clearPreview();
  session.form.release();
  session = null;

  ui.panel.classList.remove("active");
  ui.panel.inert = true;

  return true;
}

/**
 * Notes that something in the form was changed. A complaint about the form
 * is taken back with it, since it may no longer be true.
 */
function touch() {
  if (!session) return;

  session.dirty = true;
  if (ui.status.textContent.startsWith("⚠️")) say("");
}

/**
 * Shows a line above the save button: what is going on, or what is wrong.
 * @param {string} text
 */
function say(text) {
  ui.status.textContent = text;
  ui.status.hidden = !text;
}

/* ---------------------------------------------------------------- the form */

/**
 * Builds the form of one trail. Sections keep their own controls and hand
 * back what saving needs to read from them.
 * @param {*|null} feature the trail being edited, null for a new one
 * @returns {*} the nodes to show and the sections to read
 */
function buildForm(feature) {
  const properties = feature?.properties ?? {};

  const track = trackFields(feature);
  const basics = basicFields(properties, Boolean(feature));
  const sports = sportFields(properties.sports ?? {}, Boolean(feature));
  const text = textFields(properties);
  const tags = tagFields(properties.tags ?? []);
  const photo = photoFields(properties);
  const links = linkFields(properties);

  return {
    nodes: [
      ...track.nodes,
      ...basics.nodes,
      ...sports.nodes,
      ...text.nodes,
      ...tags.nodes,
      ...photo.nodes,
      ...links.nodes,
    ],
    track,
    basics,
    sports,
    text,
    tags,
    links,
    paint: track.paint,
    release: photo.release,
  };
}

/**
 * The track: what is measured from it, the two places it can come from (a
 * gpx file or the Strava activity), and the tolerance of the line that goes
 * on the map.
 * @param {*|null} feature
 * @returns {*}
 */
function trackFields(feature) {
  const head = createSection("Trasa");
  const stats = el("div", "adminStats");
  const meta = el("p", "adminHint");

  const tolerance = sliderRow("Tolerancia", {
    min: 0,
    max: 50,
    step: 1,
    value: DEFAULT_TOLERANCE,
    format: (value) => `${value} m`,
  });

  const pick = filePick(".gpx,.json,.geojson", loadTrack);

  const strava = el("button", "adminPick", "Načítať zo Stravy");
  strava.type = "button";
  strava.addEventListener("click", loadFromStrava);

  const sources = el("div", "adminSources");
  sources.append(pick.label, strava);

  const connect = stravaConnect();
  const count = (value) => value.toLocaleString("sk-SK");

  const paint = () => {
    const { track } = session;

    tolerance.row.hidden = !track;
    pick.caption.textContent =
      track || feature ? "Vymeniť GPX" : "Vybrať GPX súbor";

    if (track) {
      head.aside.textContent = track.filename;
      stats.replaceChildren(statsRow(measured(track.stats)));
      meta.textContent =
        `GPX ${count(track.original.pointCount)} bodov · ` +
        `na mape ${count(track.simplify.processed.pointCount)} bodov` +
        (track.trackCount > 1
          ? ` · prvá z ${track.trackCount} stôp v súbore`
          : "");
    } else if (feature) {
      head.aside.textContent = `${feature.properties.slug}.gpx`;
      stats.replaceChildren(statsRow(feature.properties));
      meta.textContent =
        `Na mape ${count(feature.geometry.coordinates.length)} bodov. ` +
        `GPX aj čísla ostávajú, kým nenahráš novú trasu.`;
    } else {
      head.aside.textContent = "";
      stats.replaceChildren();
      meta.textContent =
        "Dĺžka, prevýšenie aj línia na mape sa zmerajú z GPX súboru alebo " +
        "zo záznamu aktivity na Strave.";
    }
  };

  // One redraw per frame at most, since this one rewrites the line geometry
  let frame = 0;
  tolerance.input.addEventListener("input", () => {
    if (frame || !session.track) return;

    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!session?.track) return;

      applyTolerance(session.track, Number(tolerance.input.value));
      updateSimplifiedData(mapRef, session.track);
      paint();
    });
  });

  return {
    nodes: [head.row, stats, meta, tolerance.row, sources, connect.box],
    paint,
    tolerance: () => Number(tolerance.input.value),
    connect,
    reveal: () => head.row.scrollIntoView({ block: "start" }),
    // One download at a time, however it was asked for
    downloading: () => strava.disabled,
    busy(downloading) {
      strava.disabled = downloading;
    },
  };
}

/**
 * What stands between the editor and Strava the first time: the author's own
 * API application, and their consent to read activities through it. Shown
 * when the server asks for either, gone once Strava is connected.
 * @returns {{ box: HTMLElement, ask: (needs: string) => void, done: () => boolean }}
 */
function stravaConnect() {
  const box = el("div", "adminConnect");
  box.hidden = true;

  // Setting Strava up changes nothing about the trail
  box.addEventListener("input", (evt) => evt.stopPropagation());

  const text = el("p", "adminHint");

  const clientId = input("text", "napr. 123456");
  clientId.inputMode = "numeric";
  clientId.spellcheck = false;

  const clientSecret = input("password", "40 znakov");
  clientSecret.autocomplete = "off";

  const fields = el("div", "adminGrid");
  fields.append(
    field("Client ID", clientId),
    field("Client Secret", clientSecret),
  );

  const button = el("button", "", "Pripojiť Stravu");
  button.type = "button";

  button.addEventListener("click", async () => {
    // Opened in the click itself, later the browser would block it
    const popup = window.open("", STRAVA_CHANNEL, "popup,width=560,height=760");

    try {
      if (!fields.hidden) {
        await send(
          "PUT",
          `${STRAVA}/credentials`,
          JSON.stringify({
            client_id: clientId.value,
            client_secret: clientSecret.value,
          }),
          { "Content-Type": "application/json" },
        );
      }

      if (!popup) {
        say("⚠️ Prehliadač zablokoval okno Stravy. Povoľ mu ho a skús to znova.");
        return;
      }

      popup.location = new URL(`${STRAVA}/connect`, location.href).href;
      say("Dokonči pripojenie v okne Stravy…");
    } catch (err) {
      popup?.close();
      say(`⚠️ ${err.message}`);
    }
  });

  // A way back to the two fields, should the application ever change
  const other = el("button", "resetLink", "Zadať iné Client ID a Secret");
  other.type = "button";
  other.addEventListener("click", () => ask("credentials"));

  box.append(text, fields, button, other);

  return { box, ask, done };

  /**
   * Shows what is missing.
   * @param {string} needs "credentials" for the application, anything else
   *   for the consent alone
   */
  function ask(needs) {
    const setup = needs === "credentials";

    fields.hidden = !setup;
    other.hidden = setup;

    if (setup) {
      const link = el("a", "", "strava.com/settings/api");
      link.href = "https://www.strava.com/settings/api";
      link.target = "_blank";
      link.rel = "noopener";

      text.replaceChildren(
        "Embed kód trasu neobsahuje, Strava ju vydá len cez svoje API. " +
          "Raz si na ",
        link,
        " vytvor aplikáciu (Authorization Callback Domain: localhost) a " +
          "vlož sem jej Client ID a Client Secret. Ostanú len v tomto počítači.",
      );
    } else {
      text.textContent =
        "Ešte Strave potvrď, že tento editor smie čítať tvoje aktivity.";
    }

    box.hidden = false;
  }

  /** @returns {boolean} whether it was being asked for */
  function done() {
    const asked = !box.hidden;
    box.hidden = true;

    return asked;
  }
}

/**
 * Reads a picked gpx and takes its first track.
 * @param {File} file
 */
async function loadTrack(file) {
  const { form } = session;
  let lines = [];

  try {
    const geoJson = parseTrack(file.name, await file.text());

    lines = (geoJson.features ?? []).filter(
      (feature) => feature.geometry?.type === "LineString",
    );
  } catch (err) {
    console.error(`Could not read ${file.name}:`, err);
  }

  if (!session || session.form !== form) return; // Closed while reading

  if (!lines.length) {
    say(`⚠️ V súbore ${file.name} nie je žiadna trasa.`);
    return;
  }

  useTrack(lines[0].geometry.coordinates, {
    filename: file.name,
    name:
      lines[0].properties?.name ||
      file.name.replace(/\.(gpx|json|geojson)$/i, ""),
    // All of them are in the file, but only the first one is used
    trackCount: lines.length,
  });
}

/**
 * Fetches the recorded track of the Strava activity the form names, so its
 * gpx does not have to be downloaded and picked by hand. The first time
 * round Strava has to be connected, which the track section then asks for.
 */
async function loadFromStrava() {
  const { form } = session;
  const id = stravaId(form.links.stravaId.value.trim());

  if (form.track.downloading()) return;

  if (!/^\d+$/.test(id)) {
    say("⚠️ Najprv vlož do odkazov embed kód alebo ID aktivity zo Stravy.");
    form.links.stravaId.focus();
    return;
  }

  form.track.busy(true);
  say("Sťahujem trasu zo Stravy…");

  try {
    const { name, coords } = await send("GET", `${STRAVA}/activities/${id}`);

    if (session?.form !== form) return; // Closed while downloading

    form.track.connect.done();
    useTrack(coords, { filename: `Strava ${id}`, name });
  } catch (err) {
    if (session?.form !== form) return;

    say(`⚠️ ${err.message}`);

    if (err.needs) {
      form.track.connect.ask(err.needs);
      form.track.reveal(); // The embed code is pasted far below it
    }
  } finally {
    form.track.busy(false);
  }
}

/**
 * Takes a track into the form: measures it and puts it on the map next to
 * its reduced twin. The form follows: the name when it is still empty, and
 * whether the track is a loop.
 * @param {number[][]} coords [[lng, lat, ele?], ...]
 * @param {*} source
 * @param {string} source.filename what the track section calls it
 * @param {string} [source.name] the name the track came with
 * @param {number} [source.trackCount] tracks its file held
 */
function useTrack(coords, { filename, name, trackCount = 1 }) {
  const { form } = session;

  clearPreview();

  const track = {
    id: PREVIEW,
    filename,
    trackCount,
    coords,
    geoJson: createGeoJson(coords),
    style: PREVIEW_STYLE,
    simplify: null,
  };

  prepare(track);
  applyTolerance(track, form.track.tolerance());

  // What gets saved as the gpx, and so what every number describes
  track.original = reduceAt(track.simplify, 0);
  track.stats = trackStats(track.original.coords);

  addTrackLayer(mapRef, track);
  addSimplifiedLayer(mapRef, track);
  fitToTrack(mapRef, track.geoJson, previewPadding());

  session.track = track;

  const { name: title, loop } = form.basics;

  if (!title.value.trim() && name) {
    title.value = name;
    title.dispatchEvent(new Event("input", { bubbles: true }));
  }

  loop.checked = isLoop(track.original.coords);

  say("");
  touch();
  form.paint();
}

/** Takes the previewed track off the map. */
function clearPreview() {
  if (!session?.track) return;

  removeTrackLayer(mapRef, session.track);
  session.track = null;
}

/**
 * Room to leave around a previewed track, so it lands in the part of the map
 * the panels do not cover.
 * @returns {{ top: number, right: number, bottom: number, left: number }}
 */
function previewPadding() {
  const padding = { top: 40, right: 40, bottom: 40, left: 40 };

  if (innerWidth < 760) return padding; // The editor covers the map anyway

  padding.right += ui.panel.offsetWidth + 20;

  const sheet = document.getElementById("sheet");
  const room = innerWidth - padding.left - padding.right;

  // The list is only stepped around while that leaves something to look at
  if (!sheet.classList.contains("closed") && room - sheet.offsetWidth > 240) {
    padding.left += sheet.offsetWidth + 20;
  }

  return padding;
}

/**
 * Name, slug, where the trail is and whether it comes back to its start.
 * @param {*} properties of the trail, empty for a new one
 * @param {boolean} published whether the trail is already in the data
 * @returns {*}
 */
function basicFields(properties, published) {
  const head = createSection("Základ");

  const name = input("text", "Názov trasy");
  name.value = properties.name ?? "";

  const slug = input("text", "sk-nazov-trasy");
  slug.value = properties.slug ?? "";
  slug.spellcheck = false;
  slug.autocapitalize = "off";
  slug.disabled = published;

  const country = select([["", "—"], ...Object.entries(COUNTRIES)]);
  addMissingOption(country, properties.country);
  country.value = properties.country ?? HOME_COUNTRY;

  const region = input("text", "napr. Malá Fatra");
  region.value = properties.region ?? "";
  region.setAttribute("list", "adminRegions");

  const regions = document.createElement("datalist");
  regions.id = "adminRegions";
  regions.append(
    ...valuesOf("region").map((value) => {
      const option = document.createElement("option");
      option.value = value;

      return option;
    }),
  );

  const loop = document.createElement("input");
  loop.type = "checkbox";
  loop.className = "filterToggle";
  loop.checked = Boolean(properties.loop);

  // Until the slug is written by hand it follows the country and the name,
  // the way every slug in the data is put together
  let slugEdited = false;

  const follow = () => {
    ui.title.textContent = name.value.trim() || "Nová trasa";

    if (published || slugEdited) return;

    const base = slugify(name.value);

    slug.value = base
      ? [country.value.toLowerCase(), base].filter(Boolean).join("-")
      : "";
  };

  name.addEventListener("input", follow);
  country.addEventListener("change", follow);

  slug.addEventListener("input", () => {
    slugEdited = slug.value !== ""; // Emptied, it goes back to following
  });
  slug.addEventListener("blur", () => {
    slug.value = slugify(slug.value);
    follow();
  });

  follow();

  const grid = el("div", "adminGrid");
  grid.append(
    field("Názov", name, true),
    field(
      "Slug",
      slug,
      true,
      published
        ? "Meno GPX súboru aj adresa trasy, po zverejnení sa už nemení."
        : "Meno GPX súboru aj adresa trasy. Po uložení sa už nemení.",
    ),
    field("Krajina", country),
    field("Región", region),
    toggleRow("Okruh, trasa sa vracia na štart", loop),
    regions,
  );

  return { nodes: [head.row, grid], name, slug, country, region, loop };
}

/**
 * One row per sport: a chip that switches it on, how long it takes and how
 * hard it is.
 * @param {*} sports the sports of the trail, by key
 * @param {boolean} published a new trail starts as a run, like the template
 * @returns {*}
 */
function sportFields(sports, published) {
  const head = createSection("Športy");

  // The known ones first, then whatever else the data already uses
  const keys = [...new Set([...Object.keys(SPORTS), ...keysOf("sports")])];

  const rows = keys.map((key) => {
    const value = sports[key];

    const chip = el("button", "filterChip", SPORTS[key] ?? key);
    chip.type = "button";

    const minutes = input("number", "min");
    minutes.min = 1;
    minutes.value = value?.duration_min ?? "";
    minutes.title = "Čas v minútach";

    const difficulty = select([["", "náročnosť"], ...Object.entries(DIFFICULTY)]);
    addMissingOption(difficulty, value?.difficulty);
    difficulty.value = value?.difficulty ?? "";

    const row = { key, on: value !== undefined, minutes, difficulty };

    const paint = () => {
      chip.classList.toggle("on", row.on);
      chip.setAttribute("aria-pressed", row.on);
      minutes.disabled = difficulty.disabled = !row.on;
    };

    chip.addEventListener("click", () => {
      row.on = !row.on;
      paint();
      touch();

      if (row.on) minutes.focus();
    });

    row.node = el("div", "adminSport");
    row.node.append(chip, minutes, difficulty);
    row.paint = paint;

    return row;
  });

  if (!published) rows[0].on = true;
  rows.forEach((row) => row.paint());

  /** The first sport whose time is not a number of minutes, if any. */
  const invalid = () =>
    rows.find(
      (row) =>
        row.on && row.minutes.value !== "" && !(Number(row.minutes.value) > 0),
    );

  const read = () => {
    const result = {};

    // The order the trail already had, then the ones switched on now
    const order = [
      ...Object.keys(sports),
      ...keys.filter((key) => !(key in sports)),
    ];

    for (const key of order) {
      const row = rows.find((candidate) => candidate.key === key);
      if (!row?.on) continue;

      result[key] = {
        ...sports[key],
        duration_min:
          row.minutes.value === "" ? null : Number(row.minutes.value),
        difficulty: row.difficulty.value,
      };
    }

    return result;
  };

  return { nodes: [head.row, ...rows.map((row) => row.node)], read, invalid };
}

/**
 * The description. Slovak for now, like everywhere else.
 * @param {*} properties
 * @returns {*}
 */
function textFields(properties) {
  const head = createSection("Popis");

  const description = document.createElement("textarea");
  description.className = "filterInput adminText";
  description.rows = 9;
  description.placeholder =
    "Čo na trase čaká, kadiaľ vedie a na čo si dať pozor. " +
    "Prázdny riadok oddelí odseky.";
  description.value = properties.description?.sk ?? "";

  return { nodes: [head.row, description], description };
}

/**
 * Tags as chips: every tag the data already knows, plus a field for a new
 * one, so the same thing does not end up spelled three ways.
 * @param {string[]} tags the tags of the trail
 * @returns {*}
 */
function tagFields(tags) {
  const head = createSection("Tagy");
  const row = el("div", "filterChips");

  // The order the trail already had, new picks after it
  let picked = [...tags];

  const addChip = (tag) => {
    const chip = el("button", "filterChip", tag);
    chip.type = "button";
    chip.classList.toggle("on", picked.includes(tag));

    chip.addEventListener("click", () => {
      const on = chip.classList.toggle("on");

      picked = on ? [...picked, tag] : picked.filter((value) => value !== tag);
      touch();
    });

    row.append(chip);

    return chip;
  };

  const known = [...new Set([...valuesOf("tags"), ...tags])].sort((a, b) =>
    a.localeCompare(b, "sk"),
  );
  const chips = new Map(known.map((tag) => [tag, addChip(tag)]));

  const fresh = input("text", "Nový tag, potvrď Enterom");
  fresh.addEventListener("keydown", (evt) => {
    if (evt.key !== "Enter") return;

    evt.preventDefault();

    const tag = fresh.value.trim();
    if (!tag) return;

    fresh.value = "";

    if (!chips.has(tag)) {
      picked.push(tag);
      chips.set(tag, addChip(tag));
    } else if (!picked.includes(tag)) {
      chips.get(tag).click();
    }

    touch();
  });

  return {
    nodes: [head.row, row, el("div", "adminGap"), fresh],
    read: () => [...picked],
  };
}

/**
 * The photo above the trail page. Picking one only previews it; it is sent
 * and reduced when the trail is saved.
 * @param {*} properties
 * @returns {*}
 */
function photoFields(properties) {
  const head = createSection("Fotka");

  const preview = el("img", "adminPhoto");
  preview.alt = "";
  preview.hidden = true;

  // Shown only once it loads, so a missing file leaves no broken frame
  preview.addEventListener("load", () => {
    preview.hidden = false;
  });

  if (properties.image) {
    preview.src =
      `./data/images/${encodeURIComponent(properties.slug)}/` +
      encodeURIComponent(properties.image);
    head.aside.textContent = properties.image;
  }

  let objectUrl = null;

  const release = () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  };

  const pick = filePick("image/jpeg,image/png,image/webp", (file) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      say("⚠️ Fotka má byť JPEG, PNG alebo WebP.");
      return;
    }

    release();
    objectUrl = URL.createObjectURL(file);

    session.photo = file;
    preview.src = objectUrl;
    head.aside.textContent = file.name;
    pick.caption.textContent = "Vymeniť fotku";
    touch();
  });

  pick.caption.textContent = properties.image ? "Vymeniť fotku" : "Vybrať fotku";

  const hint = el(
    "p",
    "adminHint",
    "Pri uložení sa oreže na 3:2, zmenší na 2000 px a uloží ako image.webp, " +
      "rovnako ako cez tools/reduce-photo.sh.",
  );

  return { nodes: [head.row, preview, pick.label, hint], release };
}

/**
 * Strava, parking and the weather anchor.
 * @param {*} properties
 * @returns {*}
 */
function linkFields(properties) {
  const head = createSection("Odkazy");

  const stravaId = input("text", "ID aktivity");
  stravaId.value = properties.strava_id ?? "";
  stravaId.spellcheck = false;

  const stravaToken = input("text", "token");
  stravaToken.value = properties.strava_token ?? "";
  stravaToken.spellcheck = false;

  // Strava hands both over as one embed snippet, so take it as it comes
  for (const control of [stravaId, stravaToken]) {
    control.addEventListener("paste", (evt) => {
      const text = evt.clipboardData?.getData("text") ?? "";
      const id = /data-embed-id="(\d+)"/.exec(text)?.[1];
      const token = /data-token="([^"]+)"/.exec(text)?.[1];

      if (!id && !token) return;

      evt.preventDefault();
      if (id) stravaId.value = id;
      if (token) stravaToken.value = token;
      touch();

      // A new trail with no track yet is after the one of this activity. A
      // published one keeps its gpx until the author asks for another.
      if (id && !session.feature && !session.track) loadFromStrava();
    });
  }

  const parking = input("text", "https://maps.app.goo.gl/…");
  parking.value = asText(properties.parking);
  parking.spellcheck = false;

  const weather = input("text", "napr. zilina_slovensko_3056508");
  weather.value = asText(properties.weather_point);
  weather.spellcheck = false;

  const grid = el("div", "adminGrid");
  grid.append(
    field("Strava ID", stravaId),
    field("Strava token", stravaToken),
    el(
      "p",
      "adminHint adminWide",
      "Stačí vložiť celý embed kód zo Stravy, ID aj token sa vyplnia samé. " +
        "Novej trase bez GPX sa zo Stravy rovno stiahne aj trasa.",
    ),
    field("Parkovanie", parking, true),
    field(
      "Počasie",
      weather,
      true,
      "Meteoblue miesto alebo jeho adresa. Prázdne znamená najvyšší bod trasy.",
    ),
  );

  return { nodes: [head.row, grid], stravaId, stravaToken, parking, weather };
}

/* ------------------------------------------------------------------ saving */

/**
 * Checks the form, sends the photo and the trail, and reloads onto the saved
 * trail, so what comes up is what a visitor will get.
 */
async function saveTrail() {
  if (!session || ui.save.disabled) return;

  const { feature, form, track, photo } = session;
  const problem = problemIn(form, feature, track);

  if (problem) {
    say(`⚠️ ${problem.text}`);
    problem.control?.focus();
    return;
  }

  const slug = feature ? feature.properties.slug : form.basics.slug.value;

  ui.save.disabled = true;

  try {
    let properties = readProperties(form, feature, track, slug);

    if (photo) {
      say("Spracúvam fotku…");

      const { image } = await send("PUT", `${API}/${slug}/image`, photo, {
        "Content-Type": photo.type || "application/octet-stream",
      });

      properties = withKey(properties, "image", image, [
        "weather_point",
        "sports",
      ]);
    }

    say("Ukladám…");

    const body = {
      create: !feature,
      feature: {
        type: "Feature",
        properties,
        geometry: track
          ? {
              type: "LineString",
              coordinates: publishedCoordinates(
                reduceAt(track.simplify, form.track.tolerance()).coords,
              ),
            }
          : feature.geometry,
      },
    };

    if (track) body.gpx = coordsToGpx(track.original.coords, properties.name);

    await send("PUT", `${API}/${slug}`, JSON.stringify(body), {
      "Content-Type": "application/json",
    });

    reloadOnto(slug, feature ? "Trasa uložená" : "Trasa pridaná");
  } catch (err) {
    say(`⚠️ ${err.message}`);
    ui.save.disabled = false;
  }
}

/**
 * What stops the form from being saved, if anything.
 * @param {*} form
 * @param {*|null} feature
 * @param {*|null} track
 * @returns {{ text: string, control?: HTMLElement }|null}
 */
function problemIn(form, feature, track) {
  const { name, slug } = form.basics;

  if (!name.value.trim()) return { text: "Trase chýba názov.", control: name };

  if (!feature) {
    if (!track) {
      return { text: "Novej trase chýba trasa: vyber GPX alebo ju načítaj zo Stravy." };
    }

    if (!SLUG.test(slug.value)) {
      return {
        text: "Slug môže mať len malé písmená, čísla a spojovníky.",
        control: slug,
      };
    }

    if (trails.some((trail) => trail.properties.slug === slug.value)) {
      return { text: `Slug „${slug.value}“ už má iná trasa.`, control: slug };
    }
  }

  const sport = form.sports.invalid();
  if (sport) {
    return { text: "Čas športu má byť počet minút.", control: sport.minutes };
  }

  return null;
}

/**
 * The properties to store. They start from what the trail already has, so
 * the keys keep their order and anything this form knows nothing about
 * survives; a field that was not touched is written back exactly as it was.
 * @param {*} form
 * @param {*|null} feature
 * @param {*|null} track a freshly picked gpx, if any
 * @param {string} slug
 * @returns {*}
 */
function readProperties(form, feature, track, slug) {
  const { basics, links } = form;
  const before = feature?.properties ?? {};
  const name = keep(before.name, basics.name.value);

  let properties = feature
    ? { ...before }
    : emptyProperties({ slug, name, stats: track.stats, loop: false });

  Object.assign(properties, {
    name,
    country: basics.country.value,
    region: keep(before.region, basics.region.value),
    // Measured again only when the track itself was replaced
    ...(track ? measured(track.stats) : {}),
    loop: basics.loop.checked,
    strava_id: keep(before.strava_id, links.stravaId.value, stravaId),
    strava_token: keep(before.strava_token, links.stravaToken.value),
    parking: keep(before.parking, links.parking.value, coordsOrText),
    sports: form.sports.read(),
    tags: form.tags.read(),
    description: {
      ...before.description,
      sk: keep(before.description?.sk, form.text.description.value),
    },
  });

  const weather = keep(before.weather_point, links.weather.value, weatherPoint);

  if (weather === null) delete properties.weather_point;
  else properties = withKey(properties, "weather_point", weather, ["sports"]);

  return properties;
}

/**
 * The value of a text field: the stored one when the field still shows it,
 * tidied up when it was edited. Keeps an untouched field out of the diff.
 * @param {*} stored what the trail holds now
 * @param {string} typed what the field holds
 * @param {(text: string) => *} [tidy] turns edited text into a value
 * @returns {*}
 */
function keep(stored, typed, tidy = (text) => text) {
  return stored !== undefined && typed === asText(stored)
    ? stored
    : tidy(typed.trim());
}

/**
 * Sets a key. A key the object does not have yet goes in front of the first
 * anchor that is there, rather than to the very end, which is how the
 * optional ones sit in trails.geojson.
 * @param {*} object
 * @param {string} key
 * @param {*} value
 * @param {string[]} anchors keys to go in front of, in order of preference
 * @returns {*} the object, rebuilt when the key had to be slotted in
 */
function withKey(object, key, value, anchors) {
  const anchor = anchors.find((candidate) => candidate in object);

  if (key in object || !anchor) return { ...object, [key]: value };

  return Object.fromEntries(
    Object.entries(object).flatMap((entry) =>
      entry[0] === anchor ? [[key, value], entry] : [entry],
    ),
  );
}

/**
 * A Strava activity id. A pasted activity url is forgiven, the digits are
 * all that is kept.
 * @param {string} text
 * @returns {string}
 */
function stravaId(text) {
  return /(\d{5,})/.exec(text)?.[1] ?? text;
}

/**
 * A weather anchor: nothing, [lng, lat, ele] coordinates, or a meteoblue
 * location id, for which a pasted meteoblue url is cut down to its last
 * path segment.
 * @param {string} text
 * @returns {string|number[]|null}
 */
function weatherPoint(text) {
  const coords = coordsOrText(text);
  if (typeof coords !== "string") return coords;

  const id = text.split("?")[0].split("/").filter(Boolean).at(-1);

  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

/**
 * Text as a value: null when empty, coordinates when it is a json list of
 * numbers, the text itself otherwise.
 * @param {string} text
 * @returns {string|number[]|null}
 */
function coordsOrText(text) {
  if (!text) return null;

  try {
    const value = JSON.parse(text);

    if (
      Array.isArray(value) &&
      value.length >= 2 &&
      value.every((entry) => typeof entry === "number")
    ) {
      return value;
    }
  } catch {
    // Not json, so not coordinates
  }

  return text;
}

/**
 * A stored value as the text a field shows for it.
 * @param {*} value
 * @returns {string}
 */
function asText(value) {
  if (value === null || value === undefined) return "";

  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * Asks twice, then deletes the trail with its gpx and its photos.
 */
async function deleteTrail() {
  if (!session?.feature) return;

  if (!ui.remove.classList.contains("armed")) {
    ui.remove.classList.add("armed");
    ui.remove.textContent =
      "Naozaj zmazať aj s GPX a fotkou? Klikni ešte raz.";
    deleteTimer = setTimeout(disarmDelete, 5000);
    return;
  }

  const { slug } = session.feature.properties;

  try {
    await send("DELETE", `${API}/${slug}`);
    reloadOnto(null, "Trasa zmazaná");
  } catch (err) {
    disarmDelete();
    say(`⚠️ ${err.message}`);
  }
}

function disarmDelete() {
  clearTimeout(deleteTimer);
  ui.remove.classList.remove("armed");
  ui.remove.textContent = "Zmazať trasu";
}

/**
 * Talks to the admin server.
 * @param {string} method
 * @param {string} url
 * @param {*} [body]
 * @param {*} [headers]
 * @returns {Promise<*>} the json it answered with
 */
async function send(method, url, body, headers = {}) {
  let response;

  try {
    response = await fetch(url, {
      method,
      body,
      headers: { ...WRITE_HEADERS, ...headers },
    });
  } catch {
    throw new Error("Admin server neodpovedá. Beží ešte tools/admin-server.mjs?");
  }

  const answer = await response.json().catch(() => ({}));

  if (!response.ok) {
    // "needs" names what the server has to be given before it can do this
    throw Object.assign(new Error(answer.error ?? `HTTP ${response.status}`), {
      needs: answer.needs,
    });
  }

  return answer;
}

/**
 * Reloads the app with a trail selected. Everything is read again from the
 * files that were just written, so the list, the filters and the map cannot
 * disagree with what is on the disk.
 * @param {string|null} slug the trail to land on, null for none
 * @param {string} message shown once the app is back
 */
function reloadOnto(slug, message) {
  sessionStorage.setItem(TOAST_KEY, message);
  session = null; // Saved, so there is nothing left to ask about

  const base = location.pathname + location.search;

  history.replaceState(null, "", slug ? `${base}#trail=${slug}` : base);
  location.reload();
}

/** Shows the message a save left behind before it reloaded the app. */
function showPendingToast() {
  const message = sessionStorage.getItem(TOAST_KEY);
  if (!message) return;

  sessionStorage.removeItem(TOAST_KEY);

  const toast = el("div", "", message);
  toast.id = "adminToast";
  toast.setAttribute("role", "status");
  document.body.append(toast);

  requestAnimationFrame(() => toast.classList.add("shown"));
  setTimeout(() => toast.classList.remove("shown"), 3500);
  setTimeout(() => toast.remove(), 4000);
}

/* ----------------------------------------------------------------- helpers */

/**
 * The three numbers a route is judged by, as the trail card shows them.
 * @param {*} numbers distance_m, ascent_m and descent_m
 * @returns {HTMLElement}
 */
function statsRow({ distance_m, ascent_m, descent_m }) {
  const meters = (value) =>
    value === null || value === undefined ? "—" : String(value);

  return createStats([
    { value: ((distance_m ?? 0) / 1000).toFixed(1), label: "km" },
    { value: meters(ascent_m), label: "↑ m" },
    { value: meters(descent_m), label: "↓ m" },
  ]);
}

/**
 * Every value a property holds across the data, sorted, without repeats.
 * @param {string} key
 * @returns {string[]}
 */
function valuesOf(key) {
  const values = new Set();

  for (const { properties } of trails) {
    const value = properties[key];

    if (Array.isArray(value)) value.forEach((entry) => values.add(entry));
    else if (value) values.add(value);
  }

  return [...values].sort((a, b) => a.localeCompare(b, "sk"));
}

/**
 * Every key of an object valued property, across the data.
 * @param {string} key
 * @returns {string[]}
 */
function keysOf(key) {
  return [
    ...new Set(trails.flatMap(({ properties }) => Object.keys(properties[key] ?? {}))),
  ];
}

/**
 * Makes sure a select can show a value the labels do not list, instead of
 * quietly dropping it on the next save.
 * @param {HTMLSelectElement} control
 * @param {string} [value]
 */
function addMissingOption(control, value) {
  if (!value || [...control.options].some((option) => option.value === value)) {
    return;
  }

  const option = document.createElement("option");
  option.value = option.textContent = value;
  control.append(option);
}

/**
 * A labelled control, the same one the filters use.
 * @param {string} label
 * @param {HTMLElement} control
 * @param {boolean} [wide] whether it takes the whole row
 * @param {string} [hint] a line of help under it
 * @returns {HTMLElement}
 */
function field(label, control, wide = false, hint = "") {
  const element = el("div", wide ? "filterField wide" : "filterField");

  const name = el("label", "filterLabel", label);
  name.append(control);
  element.append(name);

  if (hint) element.append(el("p", "adminHint", hint));

  return element;
}

function toggleRow(label, control) {
  const element = el("label", "filterToggleRow");
  element.append(el("span", "filterToggleLabel", label), control);

  return element;
}

function input(type, placeholder) {
  const element = el("input", "filterInput");
  element.type = type;
  element.placeholder = placeholder;

  return element;
}

function select(options) {
  const element = el("select", "filterSelect");

  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    element.append(option);
  }

  return element;
}

/**
 * A labelled slider that shows its own value, the one a layer card has.
 * @param {string} label
 * @param {*} options min, max, step, value and a format(value) for the readout
 * @returns {{ row: HTMLElement, input: HTMLInputElement }}
 */
function sliderRow(label, { min, max, step, value, format }) {
  const control = el("input", "layerRowInput");
  control.type = "range";
  Object.assign(control, { min, max, step, value });

  const readout = el("span", "layerRowValue", format(value));

  control.addEventListener("input", () => {
    readout.textContent = format(Number(control.value));
  });

  const row = el("div", "layerRow adminSlider");
  row.append(el("span", "layerRowLabel", label), control, readout);

  return { row, input: control };
}

/**
 * A button that picks a file, and takes one dropped on it as well.
 * @param {string} accept what the picker offers
 * @param {(file: File) => void} onFile
 * @returns {{ label: HTMLElement, caption: HTMLElement }}
 */
function filePick(accept, onFile) {
  const label = el("label", "adminPick");
  const caption = el("span", "");

  const control = document.createElement("input");
  control.type = "file";
  control.accept = accept;
  control.hidden = true;

  control.addEventListener("change", () => {
    const file = control.files[0];

    control.value = ""; // So picking the same file again still fires
    if (file) onFile(file);
  });

  label.addEventListener("dragover", (evt) => {
    evt.preventDefault();
    label.classList.add("over");
  });
  label.addEventListener("dragleave", () => label.classList.remove("over"));
  label.addEventListener("drop", (evt) => {
    evt.preventDefault();
    label.classList.remove("over");

    const file = evt.dataTransfer.files[0];
    if (file) onFile(file);
  });

  label.append(caption, control);

  return { label, caption };
}

/**
 * Creates an element with a class and, when given, a text.
 * @param {string} tag
 * @param {string} className
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function el(tag, className, text) {
  const element = document.createElement(tag);

  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;

  return element;
}
