import { t, getLocale } from "../js/i18n.js";
import { playNarration, stopNarration } from "../js/audio.js";
import { createLogger } from "../js/logger.js";
import {
  ART_VIEWBOX,
  ACTIVE_EQUIPMENT,
  IMAGE_INSET,
  IMAGE_SPAN,
  EXPLODED_BODY_SCALE,
  CALLOUT_GUTTER,
  PART_PLATE,
  getEquipmentById,
  equipmentNameKey,
  equipmentPurposeKey,
  componentLabelKey,
  componentDescKey,
  leaderEndX,
  explodeArrow,
  partAspect,
  partFrameAspect,
  fitInFrame
} from "./equipment-data.js";
import { renderArt } from "./equipment-art.js";
import { isTranslationPending } from "./translation-status.js";
import { narrationPath, probeNarration } from "./narration.js";

const logger = createLogger("EquipmentDetail");

const DETAIL_ROOT_ID = "equipment-detail";

// The states the stage moves through. A worker taps the card and the equipment
// travels to the middle of the screen, holds still long enough to be read as one
// object, and then comes apart — one continuous movement, no second button and no
// screen swap. Reassembling puts it back and brings the callouts with it, and
// tapping the equipment takes it apart again.
const PHASE_ZOOM = "zoom";
const PHASE_ASSEMBLED = "assembled";
const PHASE_EXPLODING = "exploding";
const PHASE_EXPLODED = "exploded";
const PHASE_REASSEMBLING = "reassembling";

// must match the transition durations in prerequisite.css
const ZOOM_MS = 600;
const SETTLE_MS = 180;
const CALLOUT_FADE_MS = 240;
const REASSEMBLE_MS = 440;

// There are two ways of showing this equipment — the assembled photograph with six
// callouts around it, and the six component plates laid out around a shrunken body —
// and they must never be on screen together. They were only ever cross-faded, so for
// the length of the fade a worker saw both: two "4 Valve Block"s, two leader systems,
// plates lying across the callouts. Worse, the plates were merely transparent, so in
// the assembled state they stayed clickable, focusable and in the screen reader's
// list, and tapping one of those invisible buttons threw the view back apart.
//
// So visibility is no longer a matter of opacity. Each phase below says outright
// which of the two groups is in the document at all — `hidden`, which is display:none
// — and only the group that is leaving keeps its fade. The two are handed over in
// sequence: the callouts finish going before the plates start arriving, and the
// plates are gone before the callouts come back.
//
//   hidden      the group is removed from rendering, hit-testing and the a11y tree
//   shown       the group is painted at full strength
//   leaving     the group is still in the document, fading, and not interactive
const STAGE_STATES = {
  // flying in from the card: the equipment and nothing else
  [PHASE_ZOOM]: {
    calloutsAllowed: false, callouts: false, parts: false, partsHidden: true, interactive: false
  },
  // settled, and the one state the six callouts belong to
  [PHASE_ASSEMBLED]: {
    calloutsAllowed: true, callouts: true, parts: false, partsHidden: true, interactive: false
  },
  // the callouts are on their way out; the plates have not arrived yet
  [PHASE_EXPLODING]: {
    calloutsAllowed: true, callouts: false, parts: false, partsHidden: true, interactive: false
  },
  [PHASE_EXPLODED]: {
    calloutsAllowed: false, callouts: false, parts: true, partsHidden: false, interactive: true
  },
  // the plates are travelling home; the callouts are not back yet
  [PHASE_REASSEMBLING]: {
    calloutsAllowed: false, callouts: false, parts: false, partsHidden: false, interactive: false
  }
};

// What is in the document, what is painted, and what may be touched. `callouts` is
// the one thing the phase does not decide on its own: the six labels belong to the
// state a worker reassembles into, and are deliberately not raised during the
// opening zoom only to be taken straight back down. The phase decides whether they
// are ALLOWED, which is what keeps the two views apart.
//
// The invariant this exists to guarantee, checked in the tests against every phase:
// `calloutsHidden` and `partsHidden` are never both false. The two ways of showing
// this equipment are never in the document at the same time, so they can never paint
// at the same time, and neither can be tabbed to while the other is on screen.
function stageState(phase, callouts = false) {
  const base = STAGE_STATES[phase] || STAGE_STATES[PHASE_ZOOM];
  const present = Boolean(callouts) && base.calloutsAllowed;
  return {
    callouts: present && base.callouts,
    calloutsHidden: !present,
    parts: base.parts,
    partsHidden: base.partsHidden,
    interactive: base.interactive
  };
}

// how big the equipment starts when there is no card rect to fly from
const FALLBACK_ZOOM_SCALE = 0.28;

// translate, and say whether what came back is really this locale or a fallback
function _label(key, fallback) {
  const locale = getLocale();
  return {
    text: t(key, {}, fallback),
    pending: isTranslationPending(locale, key)
  };
}

// escape anything that reaches innerHTML, locale files included
function _esc(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// render a translated string, flagged when it is standing in for a missing one
function _text(key, fallback) {
  const { text, pending } = _label(key, fallback);
  if (!pending) return _esc(text);
  const note = _esc(t("prerequisite.translation_pending", {}, "Santali translation pending"));
  return `<span class="eq-pending" data-translation-pending="true" title="${note}">${_esc(text)}</span>`;
}

// plain translated text, no markup, for attributes
function _plain(key, fallback) {
  return _esc(t(key, {}, fallback));
}

// The photograph is masked by its own silhouette, so the white paper it was shot on
// is never painted and the equipment sits straight on the dark background.
//
// The url goes on the element rather than into a custom property the stylesheet
// reads: a relative url inside a custom property resolves against the stylesheet
// that USES it, so ./assets/... written here would be looked for under /css/ and the
// mask would silently fail, taking the whole photograph with it. An inline style
// resolves against the document, the same as the src next to it.
//
// Both spellings are set: the unprefixed property is the standard one, the -webkit-
// one is what an older android webview understands.
function _maskStyle(mask) {
  if (!mask) return "";
  const url = `url(&quot;${_esc(mask)}&quot;)`;
  return `-webkit-mask-image:${url};mask-image:${url};`;
}

// the leader lines, in the same 0-100 space as the photo so they land on the part.
// each stops at the inner edge of its label box rather than running underneath it.
function renderLeaderLines(item) {
  const lines = item.components.map((component) => {
    const endX = leaderEndX(component.side);
    return `<line class="eq-leader" data-leader="${_esc(component.id)}" x1="${component.anchor.x}" y1="${component.anchor.y}" x2="${endX}" y2="${component.label.y}" />`
      + `<circle class="eq-leader__anchor" cx="${component.anchor.x}" cy="${component.anchor.y}" r="1.6" />`;
  }).join("");

  return `<svg class="eq-stage__leaders" viewBox="${ART_VIEWBOX}" aria-hidden="true" focusable="false">
      <g>${lines}</g>
    </svg>`;
}

// The labels around the assembled photograph. Each box is pinned to its own edge of
// the stage and grows inward, so however long a translated label turns out to be it
// cannot be clipped by the side of the phone.
function renderCallouts(item) {
  return item.components.map((component, index) => {
    const labelKey = componentLabelKey(item.id, component.id);
    const left = component.side === "left";
    const inset = left ? component.label.x : 100 - component.label.x;
    const edge = left ? "left" : "right";

    return `<div class="eq-callout eq-callout--${_esc(component.side)}" data-callout="${_esc(component.id)}" style="${edge}:${inset}%;top:${component.label.y}%;">
        <span class="eq-callout__index">${index + 1}</span>
        <span class="eq-callout__label">${_text(labelKey, component.id.replace(/_/g, " "))}</span>
      </div>`;
  }).join("");
}

// The assembled view — leader lines and labels — as one group, so a single `hidden`
// takes the whole of it out of rendering rather than leaving six transparent copies
// of the component names lying over the exploded view.
function renderCalloutLayer(item, { hidden = false } = {}) {
  return `<div class="eq-callouts" data-role="callouts"${hidden ? " hidden" : ""}>
      ${renderLeaderLines(item)}
      ${renderCallouts(item)}
    </div>`;
}

// A component close-up, framed out of its source photograph by `crop`.
//
// The image is blown up to 100/crop.w of the window and shifted, which shows just
// that component without ever writing a new file — the supplied photographs ship
// byte-identical and are never re-encoded. The window itself is sized to the crop's
// real proportions first, so nothing is stretched to fit a box it does not suit.
function renderPartFrame(part, alt) {
  const { x, y, w, h } = part.crop;
  // mask-size is 100% 100% of the element it is set on, so the mask has to go on the
  // image itself — the same box the photograph fills — and not on the window that
  // crops it, where it would be scaled to the window and show the wrong region
  const style = [
    `width:${(100 / w) * 100}%`,
    `height:${(100 / h) * 100}%`,
    `left:${(-x / w) * 100}%`,
    `top:${(-y / h) * 100}%`,
    _maskStyle(part.mask)
  ].join(";");

  const fit = fitInFrame(partAspect(part), partFrameAspect());
  const box = `width:${fit.w}%;height:${fit.h}%`;

  return `<span class="eq-partbox">
      <span class="eq-partframe" style="${box}">
        <img class="eq-partframe__img" src="${_esc(part.image)}" alt="${alt}" style="${style}" decoding="async" loading="lazy" />
      </span>
    </span>`;
}

// direction the plate travels when the view comes apart: outward from the middle.
// expressed in the plate's OWN size so it needs no stage measurement, which keeps
// the whole movement a plain transform on every browser.
function explodeVector(explode) {
  const dx = 50 - explode.x;
  const dy = 50 - explode.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return { tx: +((dx / len) * 70).toFixed(1), ty: +((dy / len) * 70).toFixed(1) };
}

// One selectable component in the exploded view. It ships `disabled` unless the
// exploded view is the one a worker is actually looking at: a plate that is merely
// transparent is still a button, and tabbing onto an invisible one and pressing it
// used to throw the assembled view back apart.
function renderPartPlate(item, component, index, selected = null, interactive = true) {
  const { part } = component;
  if (!part || !part.image) return "";

  const label = _plain(componentLabelKey(item.id, component.id), component.id.replace(/_/g, " "));
  const { tx, ty } = explodeVector(part.explode);
  const isSelected = selected === component.id;
  // once one part is chosen the rest step back, so the eye goes to the right place
  const dim = selected && !isSelected ? " eq-piece--dim" : "";
  const on = isSelected ? " eq-piece--on" : "";

  const box = [
    `left:${part.explode.x}%`,
    `top:${part.explode.y}%`,
    `width:${PART_PLATE.width}%`,
    `height:${PART_PLATE.height}%`,
    `--eq-frame-h:${((PART_PLATE.frameHeight / PART_PLATE.height) * 100).toFixed(2)}%`,
    `--eq-tx:${tx}%`,
    `--eq-ty:${ty}%`,
    `--eq-delay:${index * 70}ms`
  ].join(";");

  return `<button type="button" class="eq-piece${on}${dim}" data-piece="${_esc(component.id)}" data-action="select-part"
      style="${box};" aria-pressed="${isSelected ? "true" : "false"}"${interactive ? "" : " disabled"}>
      ${renderPartFrame(part, "")}
      <span class="eq-piece__foot">
        <span class="eq-piece__index" aria-hidden="true">${index + 1}</span>
        <span class="eq-piece__label">${_text(componentLabelKey(item.id, component.id), component.id.replace(/_/g, " "))}</span>
      </span>
      <span class="eq-sr-only">${label}</span>
    </button>`;
}

// The arrows from where each part sat on the body to where it came to rest. They
// live inside the plates' layer, so they are in the document exactly when the plates
// are — never in the assembled view — and they draw out alongside the plates as the
// unit comes apart and wind back in as it goes together. Each one is a quiet
// annotation: a hairline, an open chevron, and a dot on the part's old place.
//
// This answers "where did it move from". What the part is called stays on its
// plate, and what it does stays in the panel under the stage.
function renderExplodeArrows(item, selected = null) {
  if (!item.explodeArrows) return "";

  const arrows = item.components.map((component, index) => {
    const arrow = explodeArrow(component);
    if (!arrow) return "";
    const { origin, start, c1, c2, tip, head } = arrow;
    const mode = !selected ? "" : selected === component.id ? " eq-arrow--on" : " eq-arrow--dim";
    return `<g class="eq-arrow${mode}" data-arrow="${_esc(component.id)}" style="--eq-delay:${index * 70}ms">
        <circle class="eq-arrow__origin" cx="${origin.x}" cy="${origin.y}" r="0.55" />
        <path class="eq-arrow__line" d="M ${start.x} ${start.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${tip.x} ${tip.y}" pathLength="1" />
        <polyline class="eq-arrow__head" points="${head.map((p) => `${p.x},${p.y}`).join(" ")}" />
      </g>`;
  }).join("");

  return `<svg class="eq-arrows" data-role="arrows" viewBox="${ART_VIEWBOX}" aria-hidden="true" focusable="false">${arrows}</svg>`;
}

// the component explanations, which carry the detail the floating labels cannot
function renderComponentList(item) {
  const rows = item.components.map((component, index) => {
    const labelKey = componentLabelKey(item.id, component.id);
    const descKey = componentDescKey(item.id, component.id);
    return `<li class="eq-part" data-part-row="${_esc(component.id)}">
        <span class="eq-part__index">${index + 1}</span>
        <div class="eq-part__body">
          <span class="eq-part__name">${_text(labelKey, component.id.replace(/_/g, " "))}</span>
          <span class="eq-part__desc">${_text(descKey, "")}</span>
        </div>
      </li>`;
  }).join("");

  return `<ul class="eq-parts">${rows}</ul>`;
}

// what the chosen part is, in words. the existing component strings, verbatim.
function renderSelectionPanel(item, componentId) {
  const component = item.components.find((entry) => entry.id === componentId);
  if (!component) {
    return `<div class="eq-selection eq-selection--empty" data-selected="">
        <p class="eq-selection__hint">${_text("prerequisite.explode_hint", "Tap a part to read about it")}</p>
      </div>`;
  }

  const index = item.components.indexOf(component) + 1;
  return `<div class="eq-selection" data-selected="${_esc(component.id)}">
      <span class="eq-selection__index">${index}</span>
      <div class="eq-selection__body">
        <h4 class="eq-selection__name">${_text(componentLabelKey(item.id, component.id), component.id.replace(/_/g, " "))}</h4>
        <p class="eq-selection__desc">${_text(componentDescKey(item.id, component.id), "")}</p>
      </div>
    </div>`;
}

// The stage. Every state lives in the same markup and the phase on the stage decides
// which one is showing, so zooming in and coming apart are transforms on elements
// that were already there — never a re-render, which would restart the images and
// make one continuous movement look like two screens.
function renderStage(item, { phase = PHASE_ZOOM, selected = null, callouts = false } = {}) {
  const view = stageState(phase, callouts);
  const exploded = view.parts;

  if (!item.image) {
    return `<div class="eq-stage" data-role="stage" data-phase="${_esc(phase)}" data-callouts="on">
        <svg class="eq-stage__art" viewBox="${ART_VIEWBOX}" role="img" aria-labelledby="eq-dialog-title" focusable="false">
          <g>${renderArt(item.art)}</g>
        </svg>
        ${renderCalloutLayer(item)}
      </div>`;
  }

  const name = _plain(equipmentNameKey(item.id), item.id.replace(/_/g, " "));
  const hint = _plain("prerequisite.tap_to_dismantle", "Tap the equipment to take it apart");
  const body = [
    `left:${IMAGE_INSET}%`,
    `top:${IMAGE_INSET}%`,
    `width:${IMAGE_SPAN}%`,
    `height:${IMAGE_SPAN}%`,
    `--eq-body-scale:${EXPLODED_BODY_SCALE}`,
    `--eq-zoom-scale:${FALLBACK_ZOOM_SCALE}`
  ].join(";");

  const pieces = item.components
    .map((component, index) => renderPartPlate(item, component, index, selected, view.interactive))
    .join("");

  return `<div class="eq-stage" data-role="stage" data-phase="${_esc(phase)}" data-exploded="${exploded ? "true" : "false"}" data-callouts="${view.callouts ? "on" : "off"}" data-parts="${view.parts ? "out" : "in"}">
      <button type="button" class="eq-object" data-role="object" data-action="${exploded ? "reassemble" : "explode"}"
        style="${body}" aria-label="${name} — ${hint}">
        <img class="eq-photo" src="${_esc(item.image)}" alt="${name}" style="${_maskStyle(item.mask)}" decoding="async" />
      </button>
      ${renderCalloutLayer(item, { hidden: view.calloutsHidden })}
      <div class="eq-pieces" data-role="pieces"${view.partsHidden ? " hidden" : ""}>${renderExplodeArrows(item, view.interactive ? selected : null)}${pieces}</div>
    </div>`;
}

// full modal markup for one item, position in the set drives prev/next
function renderDetailHtml(equipmentId, state = {}) {
  const item = getEquipmentById(equipmentId);
  if (!item) return "";

  const phase = state.phase || PHASE_ZOOM;
  const selected = state.selected || null;
  const callouts = Boolean(state.callouts);
  const view = stageState(phase, callouts);
  // the reassemble control and the explanation belong to the exploded view, so they
  // come and go with it rather than lingering behind the assembled photograph
  const exploded = view.interactive;

  // only active equipment is walkable; a pending item is not in the flow at all
  const index = ACTIVE_EQUIPMENT.findIndex((entry) => entry.id === equipmentId);
  const isFirst = index <= 0;
  const isLast = index >= ACTIVE_EQUIPMENT.length - 1;

  const position = _esc(t("prerequisite.item_position", {
    current: index + 1,
    total: ACTIVE_EQUIPMENT.length
  }, `${index + 1} / ${ACTIVE_EQUIPMENT.length}`));

  const canExplode = item.components.some((component) => component.part && component.part.image);

  // one control, and only while there is something to put back together
  const reassemble = canExplode
    ? `<div class="eq-stage__controls" data-role="controls"${exploded ? "" : " hidden"}>
        <button type="button" class="eq-btn eq-btn--ghost eq-btn--reassemble" data-role="reassemble" data-action="reassemble"${exploded ? "" : " hidden"}>
          ${_esc(t("prerequisite.btn_reassemble", {}, "Reassemble"))}
        </button>
      </div>`
    : "";

  const selection = canExplode
    ? `<div data-role="selection" aria-live="polite"${exploded ? "" : " hidden"}>${exploded ? renderSelectionPanel(item, selected) : ""}</div>`
    : "";

  return `
    <div class="eq-scrim" data-role="scrim"></div>
    <div class="eq-dialog" role="dialog" aria-modal="true" aria-labelledby="eq-dialog-title" data-equipment-id="${_esc(item.id)}" tabindex="-1">
      <header class="eq-dialog__head">
        <h2 class="eq-dialog__title" id="eq-dialog-title">${_text(equipmentNameKey(item.id), item.id.replace(/_/g, " "))}</h2>
        <button type="button" class="eq-icon-btn" data-action="close" aria-label="${_plain("prerequisite.btn_close", "Close")}">&times;</button>
      </header>

      <p class="eq-dialog__purpose">${_text(equipmentPurposeKey(item.id), "")}</p>

      ${renderStage(item, { phase, selected, callouts })}

      ${reassemble}
      ${selection}

      <div class="eq-audio">
        <button type="button" class="eq-btn eq-btn--audio" data-action="listen" disabled aria-disabled="true">
          <span aria-hidden="true">&#9654;</span>
          <span data-role="listen-label">${_esc(t("prerequisite.btn_listen", {}, "Listen"))}</span>
        </button>
        <span class="eq-audio__note" data-role="audio-note" hidden>${_text("prerequisite.audio_unavailable", "Narration not yet recorded")}</span>
      </div>

      <h3 class="eq-dialog__subhead">${_text("prerequisite.detail_components", "Key parts")}</h3>
      ${renderComponentList(item)}

      <footer class="eq-dialog__foot">
        <button type="button" class="eq-btn eq-btn--ghost" data-action="prev"${isFirst ? " disabled" : ""}>${_esc(t("prerequisite.btn_prev", {}, "Previous"))}</button>
        <span class="eq-dialog__position" data-role="position">${position}</span>
        <button type="button" class="eq-btn eq-btn--primary" data-action="${isLast ? "done" : "next"}">${_esc(isLast
          ? t("prerequisite.btn_done", {}, "Done")
          : t("prerequisite.btn_next", {}, "Next"))}</button>
      </footer>
    </div>
  `;
}

// the item before/after this one within the active set, null at the ends
function neighbourId(equipmentId, direction) {
  const index = ACTIVE_EQUIPMENT.findIndex((entry) => entry.id === equipmentId);
  if (index === -1) return null;
  const target = index + (direction === "prev" ? -1 : 1);
  if (target < 0 || target >= ACTIVE_EQUIPMENT.length) return null;
  return ACTIVE_EQUIPMENT[target].id;
}

// the component before/after this one, wrapping, for arrow-key part navigation
function neighbourComponentId(equipmentId, currentId, direction) {
  const item = getEquipmentById(equipmentId);
  if (!item) return null;
  const ids = item.components.filter((c) => c.part && c.part.image).map((c) => c.id);
  if (ids.length === 0) return null;
  if (!currentId) return direction === "prev" ? ids[ids.length - 1] : ids[0];
  const at = ids.indexOf(currentId);
  if (at === -1) return ids[0];
  const next = (at + (direction === "prev" ? -1 : 1) + ids.length) % ids.length;
  return ids[next];
}

// a worker who has asked for less movement gets the finished state, not the journey
function prefersReducedMotion() {
  try {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return Boolean(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch (_err) {
    return false;
  }
}

// The equipment flies in from the card the worker just tapped: the card's thumbnail
// and the middle of the stage are measured, and the difference becomes one transform.
// No layout is animated. Without a measurable card it simply scales up from the
// middle, which is what happens in a test environment with no layout.
//
// The destination is worked out from the STAGE and the geometry the equipment is laid
// out with, never from the equipment's own box: by the time this runs the equipment is
// already carrying the zoom transform, and measuring it would feed a transformed box
// back into the transform — which put the extinguisher on screen at nearly five times
// its size and shrank it, the exact opposite of moving closer to look at something.
function _zoomFrom(stage, card) {
  if (!stage || !card || typeof stage.getBoundingClientRect !== "function") return null;

  const art = typeof card.querySelector === "function"
    ? (card.querySelector(".eq-card__photo") || card.querySelector(".eq-card__art"))
    : null;
  const source = art && typeof art.getBoundingClientRect === "function" ? art : card;
  if (typeof source.getBoundingClientRect !== "function") return null;

  const from = source.getBoundingClientRect();
  const box = stage.getBoundingClientRect();
  if (!from.width || !box.width) return null;

  const size = box.width * (IMAGE_SPAN / 100);
  const centreX = box.left + box.width * ((IMAGE_INSET + IMAGE_SPAN / 2) / 100);
  const centreY = box.top + box.height * ((IMAGE_INSET + IMAGE_SPAN / 2) / 100);

  return {
    x: Math.round((from.left + from.width / 2) - centreX),
    y: Math.round((from.top + from.height / 2) - centreY),
    // the zoom only ever grows: a card bigger than the stage would otherwise start
    // the equipment oversized and pull it back
    scale: +Math.min(1, Math.max(0.08, from.width / size)).toFixed(3)
  };
}

let _openState = null;

// is a detail view currently open
function isDetailOpen() {
  return _openState !== null;
}

// which item the open detail view is showing
function getOpenEquipmentId() {
  return _openState ? _openState.equipmentId : null;
}

// which of the three states the stage is in
function getPhase() {
  return _openState ? _openState.phase : null;
}

// is the open view taken apart
function isExploded() {
  return Boolean(_openState && _openState.phase === PHASE_EXPLODED);
}

// which component is currently selected, or null
function getSelectedComponentId() {
  return _openState ? _openState.selected : null;
}

// timers come off the global the same way api.js reaches them, so this file runs
// unchanged in a browser, in an android webview and in a node test
function _timers() {
  const host = typeof globalThis !== "undefined" ? globalThis : null;
  if (!host || typeof host.setTimeout !== "function") return null;
  return { set: host.setTimeout.bind(host), clear: host.clearTimeout.bind(host) };
}

// drop any pending step of the opening sequence
function _clearTimers(state) {
  if (!state || !state.timers) return;
  const timers = _timers();
  if (timers) state.timers.forEach((id) => timers.clear(id));
  state.timers = [];
}

// tear the modal down and hand focus back to the card that opened it
function closeEquipmentDetail() {
  if (!_openState) return;

  const { root, onClose, keyHandler, returnFocusTo } = _openState;
  stopNarration();
  _clearTimers(_openState);

  if (typeof document !== "undefined" && document.removeEventListener && keyHandler) {
    document.removeEventListener("keydown", keyHandler);
  }
  if (root && typeof root.remove === "function") {
    root.remove();
  }

  _openState = null;

  if (returnFocusTo && typeof returnFocusTo.focus === "function") {
    returnFocusTo.focus();
  }
  if (typeof onClose === "function") {
    onClose();
  }
}

// the control ships disabled and is switched on only once a file is confirmed, so a
// worker never taps a button that was never going to play anything
async function _refreshNarrationState(root, equipmentId, fetchFn) {
  if (!root || typeof root.querySelector !== "function") return false;

  const button = root.querySelector('[data-action="listen"]');
  const note = root.querySelector('[data-role="audio-note"]');
  const path = narrationPath(getLocale(), equipmentId);
  const available = await probeNarration(path, fetchFn);

  if (button) {
    button.disabled = !available;
    button.setAttribute("aria-disabled", available ? "false" : "true");
  }
  if (note) {
    note.hidden = available;
  }
  return available;
}

// everything inside the dialog a keyboard can land on
function _focusables(root) {
  if (!root || typeof root.querySelectorAll !== "function") return [];
  const found = root.querySelectorAll("button, [href], input, select, textarea, [tabindex]");
  return [...found].filter((el) => !el.disabled && !el.hidden && el.getAttribute("tabindex") !== "-1");
}

// keep Tab inside the dialog while it is open
function _trapTab(root, event) {
  const items = _focusables(root);
  if (items.length === 0) return;

  const first = items[0];
  const last = items[items.length - 1];
  const active = typeof document !== "undefined" ? document.activeElement : null;

  if (event.shiftKey && (active === first || !root.contains || !root.contains(active))) {
    if (typeof last.focus === "function") last.focus();
    if (typeof event.preventDefault === "function") event.preventDefault();
  } else if (!event.shiftKey && active === last) {
    if (typeof first.focus === "function") first.focus();
    if (typeof event.preventDefault === "function") event.preventDefault();
  }
}

// Push the current state onto the markup that is already on screen. Nothing is
// re-rendered: the phase moves on the stage, the plates change class, and only the
// words in the selection panel are rewritten. That is what makes the zoom and the
// dismantling read as one movement of one object.
//
// The order matters. A group that is about to be shown has to come out of `hidden`
// BEFORE the phase moves, or there is nothing on screen for the browser to animate
// from — and since display and transition changing in the same frame is not a
// transition, the layout is flushed in between. A group that has finished leaving is
// hidden afterwards, which is what actually takes it out of rendering, hit-testing
// and the accessibility tree rather than just making it transparent.
function _applyState(root, item, state) {
  if (!root || typeof root.querySelector !== "function") return;

  const view = stageState(state.phase, state.callouts);
  const stage = root.querySelector('[data-role="stage"]');
  const callouts = root.querySelector('[data-role="callouts"]');
  const pieces = root.querySelector('[data-role="pieces"]');

  // 1. whatever this phase needs on screen comes back first
  let revealed = false;
  if (callouts && callouts.hidden && !view.calloutsHidden) {
    callouts.hidden = false;
    revealed = true;
  }
  if (pieces && pieces.hidden && !view.partsHidden) {
    pieces.hidden = false;
    revealed = true;
  }

  // 2. flush that, so the transition below has a starting frame
  if (revealed && stage && typeof stage.offsetHeight === "number") {
    void stage.offsetHeight;
  }

  // 3. the phase itself, which is what the stylesheet animates on
  if (stage && typeof stage.setAttribute === "function") {
    stage.setAttribute("data-phase", state.phase);
    stage.setAttribute("data-exploded", view.parts ? "true" : "false");
    stage.setAttribute("data-callouts", view.callouts ? "on" : "off");
    stage.setAttribute("data-parts", view.parts ? "out" : "in");
  }

  const object = root.querySelector('[data-role="object"]');
  if (object && typeof object.setAttribute === "function") {
    object.setAttribute("data-action", view.parts ? "reassemble" : "explode");
  }

  // A plate is only a button while the exploded view is the one being looked at.
  // Disabled is what keeps it off the tab order and out of reach of a stray tap
  // while it is travelling, on top of the hidden container once it has gone.
  item.components.forEach((component) => {
    const piece = root.querySelector(`[data-piece="${component.id}"]`);
    if (!piece) return;
    const isSelected = state.selected === component.id;
    const dim = state.selected && !isSelected;
    piece.className = `eq-piece${isSelected ? " eq-piece--on" : ""}${dim ? " eq-piece--dim" : ""}`;
    piece.setAttribute("aria-pressed", isSelected ? "true" : "false");
    piece.disabled = !view.interactive;

    // the chosen part's arrow comes forward with it; the rest step back
    const arrow = root.querySelector(`[data-arrow="${component.id}"]`);
    if (arrow && typeof arrow.setAttribute === "function") {
      const mode = !state.selected ? "" : isSelected ? " eq-arrow--on" : " eq-arrow--dim";
      arrow.setAttribute("class", `eq-arrow${mode}`);
    }
  });

  const controls = root.querySelector('[data-role="controls"]');
  if (controls) controls.hidden = !view.interactive;
  const reassemble = root.querySelector('[data-role="reassemble"]');
  if (reassemble) reassemble.hidden = !view.interactive;

  const selection = root.querySelector('[data-role="selection"]');
  if (selection) {
    selection.hidden = !view.interactive;
    selection.innerHTML = view.interactive ? renderSelectionPanel(item, state.selected) : "";
  }

  // 4. and whatever has finished leaving goes out of the document for good
  if (callouts) callouts.hidden = view.calloutsHidden;
  if (pieces) pieces.hidden = view.partsHidden;
}

// open the detail view for one item, replacing any view already open
function openEquipmentDetail({
  equipmentId,
  container,
  onViewed,
  onClose,
  fetchFn,
  returnFocusTo = null
} = {}) {
  if (typeof document === "undefined") return null;

  const item = getEquipmentById(equipmentId);
  if (!item) {
    logger.warn({ event: "detail_unknown_equipment", equipmentId }, "No such equipment");
    return null;
  }

  // stepping between items reuses one root, so focus and scroll do not jump
  const previousReturnFocus = _openState ? _openState.returnFocusTo : null;
  if (_openState) {
    const keep = _openState.root;
    _openState.root = null;
    closeEquipmentDetail();
    if (keep && typeof keep.remove === "function") keep.remove();
  }

  const reduced = prefersReducedMotion();
  const startPhase = reduced ? PHASE_EXPLODED : PHASE_ZOOM;

  const host = container || document.body;
  const root = document.createElement("div");
  root.id = DETAIL_ROOT_ID;
  root.className = "eq-detail-root";
  root.innerHTML = renderDetailHtml(equipmentId, { phase: startPhase, selected: null, callouts: false });

  if (host && typeof host.appendChild === "function") {
    host.appendChild(root);
  }

  // opening it is what counts as having seen it
  if (typeof onViewed === "function") {
    onViewed(equipmentId);
  }

  // every phase change goes through here, so one place decides what is in the
  // document and nothing can put the two views up at once
  const setPhase = (phase, { callouts } = {}) => {
    if (!_openState) return;
    _openState.phase = phase;
    if (callouts !== undefined) _openState.callouts = callouts;
    // a selection only means anything while the parts are what is being looked at
    if (!stageState(phase, _openState.callouts).interactive) _openState.selected = null;
    _applyState(root, item, _openState);
  };

  const timers = _timers();
  const after = (ms, fn) => {
    if (!_openState) return;
    if (!timers) {
      fn();
      return;
    }
    const owner = _openState;
    owner.timers.push(timers.set(() => {
      if (_openState !== owner) return;
      fn();
    }, ms));
  };

  // Take it apart. If the callouts are up they get out of the way first and only
  // then do the plates arrive, so the two ways of showing this equipment are handed
  // over in sequence rather than crossfaded through each other.
  const explode = () => {
    if (!_openState) return;
    _clearTimers(_openState);
    const showing = !stageState(_openState.phase, _openState.callouts).calloutsHidden;
    if (showing) {
      setPhase(PHASE_EXPLODING, { callouts: true });
      after(CALLOUT_FADE_MS, () => setPhase(PHASE_EXPLODED, { callouts: false }));
    } else {
      setPhase(PHASE_EXPLODED, { callouts: false });
    }
  };

  // Put it back. The plates travel home and leave the document before the callouts
  // come back, so the assembled state a worker lands on is the assembled state and
  // nothing else.
  const reassemble = () => {
    if (!_openState) return;
    _clearTimers(_openState);
    setPhase(PHASE_REASSEMBLING, { callouts: false });
    after(REASSEMBLE_MS, () => setPhase(PHASE_ASSEMBLED, { callouts: true }));
  };

  const selectPart = (componentId) => {
    if (!_openState || !componentId) return;
    // A plate on its way out, or gone, is not something to select. This used to force
    // the phase back to exploded, so a stray tap or tab onto one of the invisible
    // buttons left behind in the assembled view threw the whole thing apart again.
    if (!stageState(_openState.phase, _openState.callouts).interactive) return;
    _clearTimers(_openState);
    _openState.selected = componentId;
    _applyState(root, item, _openState);
    const piece = root.querySelector(`[data-piece="${componentId}"]`);
    if (piece && typeof piece.focus === "function") piece.focus();
  };

  const step = (direction) => {
    const target = neighbourId(equipmentId, direction);
    if (!target) return;
    openEquipmentDetail({
      equipmentId: target,
      container,
      onViewed,
      onClose,
      fetchFn,
      returnFocusTo: returnFocusTo || previousReturnFocus
    });
  };

  const onClick = (event) => {
    const raw = event && event.target;
    if (!raw) return;
    const trigger = typeof raw.closest === "function" ? raw.closest("[data-action],[data-role]") : raw;
    if (!trigger || typeof trigger.getAttribute !== "function") return;

    const action = trigger.getAttribute("data-action") || trigger.getAttribute("data-role");

    if (action === "close" || action === "done" || action === "scrim") {
      closeEquipmentDetail();
    } else if (action === "prev") {
      step("prev");
    } else if (action === "next") {
      step("next");
    } else if (action === "explode") {
      explode();
    } else if (action === "reassemble") {
      reassemble();
    } else if (action === "select-part") {
      selectPart(trigger.getAttribute("data-piece"));
    } else if (action === "listen") {
      playNarration({
        moduleId: "equipment",
        stepKey: equipmentId,
        onError: () => _refreshNarrationState(root, equipmentId, fetchFn)
      });
    }
  };

  if (typeof root.addEventListener === "function") {
    root.addEventListener("click", onClick);
  }

  const keyHandler = (event) => {
    if (!event) return;

    if (event.key === "Escape") {
      // taking the unit apart is a step a worker can back out of before closing
      const phase = _openState ? _openState.phase : null;
      if (phase === PHASE_EXPLODED || phase === PHASE_EXPLODING) {
        reassemble();
      } else if (phase === PHASE_REASSEMBLING) {
        // already on the way back; do not make them sit through it twice
        _clearTimers(_openState);
        setPhase(PHASE_ASSEMBLED, { callouts: true });
      } else {
        closeEquipmentDetail();
      }
      return;
    }

    if (event.key === "Tab") {
      _trapTab(root, event);
      return;
    }

    const forward = event.key === "ArrowRight";
    const back = event.key === "ArrowLeft";
    if (!forward && !back) return;

    // while apart, the arrows walk the parts; assembled, they walk the equipment set
    if (_openState && stageState(_openState.phase, _openState.callouts).interactive) {
      selectPart(neighbourComponentId(equipmentId, _openState.selected, forward ? "next" : "prev"));
    } else {
      step(forward ? "next" : "prev");
    }
  };

  if (typeof document.addEventListener === "function") {
    document.addEventListener("keydown", keyHandler);
  }

  _openState = {
    equipmentId,
    root,
    onClose,
    keyHandler,
    phase: startPhase,
    selected: null,
    callouts: false,
    timers: [],
    returnFocusTo: returnFocusTo || previousReturnFocus
  };

  const state = _openState;
  const stage = typeof root.querySelector === "function" ? root.querySelector('[data-role="stage"]') : null;
  const object = typeof root.querySelector === "function" ? root.querySelector('[data-role="object"]') : null;

  // measure the card and hand the difference to css as one transform
  const zoom = _zoomFrom(stage, returnFocusTo || previousReturnFocus);
  if (zoom && object && object.style && typeof object.style.setProperty === "function") {
    object.style.setProperty("--eq-zoom-x", `${zoom.x}px`);
    object.style.setProperty("--eq-zoom-y", `${zoom.y}px`);
    object.style.setProperty("--eq-zoom-scale", String(zoom.scale));
  }

  // zoom in, hold still, come apart. one movement of one object.
  if (!reduced) {
    // One frame has to be painted at the card's size first, or there is nothing to
    // travel from and the equipment just appears at full size. Two frames of grace
    // does that — but a tab that is not on screen never gets a frame at all, so a
    // timer backs it up: without one, a phone that was put in a pocket during the
    // zoom comes back to an extinguisher stopped at thumbnail size forever.
    const raf = typeof globalThis !== "undefined" && typeof globalThis.requestAnimationFrame === "function"
      ? globalThis.requestAnimationFrame.bind(globalThis)
      : null;
    const startZoom = () => {
      if (_openState !== state || state.phase !== PHASE_ZOOM) return;
      // The zoom lands on the settled body with its callouts still down. Raising six
      // labels for a tenth of a second only to fade them again is a flicker, not a
      // transition, so the opening goes straight on to come apart.
      setPhase(PHASE_ASSEMBLED, { callouts: false });
    };

    if (raf) raf(() => raf(startZoom));
    after(80, startZoom);

    after(ZOOM_MS + SETTLE_MS, explode);
  }

  const dialog = typeof root.querySelector === "function" ? root.querySelector(".eq-dialog") : null;
  if (dialog && typeof dialog.focus === "function") {
    dialog.focus();
  }

  _refreshNarrationState(root, equipmentId, fetchFn).catch(() => {});

  logger.info({ event: "equipment_detail_opened", equipmentId, reduced }, "Equipment detail opened");
  return root;
}

export {
  DETAIL_ROOT_ID,
  PHASE_ZOOM,
  PHASE_ASSEMBLED,
  PHASE_EXPLODING,
  PHASE_EXPLODED,
  PHASE_REASSEMBLING,
  STAGE_STATES,
  stageState,
  renderExplodeArrows,
  ZOOM_MS,
  SETTLE_MS,
  CALLOUT_FADE_MS,
  REASSEMBLE_MS,
  CALLOUT_GUTTER,
  renderCalloutLayer,
  renderDetailHtml,
  renderStage,
  renderLeaderLines,
  renderCallouts,
  renderComponentList,
  renderPartPlate,
  renderPartFrame,
  renderSelectionPanel,
  explodeVector,
  neighbourId,
  neighbourComponentId,
  openEquipmentDetail,
  closeEquipmentDetail,
  isDetailOpen,
  isExploded,
  getPhase,
  getSelectedComponentId,
  getOpenEquipmentId
};
