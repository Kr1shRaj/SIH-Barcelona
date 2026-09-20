import { t, getLocale } from "../js/i18n.js";
import { playNarration } from "../js/audio.js";
import { createLogger } from "../js/logger.js";
import { renderAppBar, bindAppBar } from "../screens/appbar.js";
import {
  ART_VIEWBOX,
  ACTIVE_EQUIPMENT,
  REQUIRED_EQUIPMENT_IDS,
  equipmentNameKey,
  equipmentPurposeKey
} from "./equipment-data.js";
import { renderArt } from "./equipment-art.js";
import { isTranslationPending } from "./translation-status.js";
import { narrationPath, probeNarration } from "./narration.js";
import { getPrerequisiteProgress, markEquipmentViewed } from "./progress.js";
import { openEquipmentDetail } from "./detail.js";

const logger = createLogger("EquipmentScreen");

const SCREEN_ROOT_ID = "prerequisite-screen";

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
  const text = t(key, {}, fallback);
  if (!isTranslationPending(getLocale(), key)) return _esc(text);
  const note = _esc(t("prerequisite.translation_pending", {}, "Santali translation pending"));
  return `<span class="eq-pending" data-translation-pending="true" title="${note}">${_esc(text)}</span>`;
}

// which modules need this item, as one short badge
function _moduleBadge(item) {
  const both = item.modules.length > 1;
  if (both) return _text("prerequisite.badge_both", "Both modules");
  if (item.modules.includes("fire-response")) return _text("prerequisite.badge_fire", "Fire & Explosion");
  return _text("prerequisite.badge_gas", "Gas Leak & Confined Space");
}

// card thumbnail: the photograph when the item has one, the drawn fallback otherwise.
// the photograph is masked by its own silhouette, so the thumbnail is the equipment
// rather than a white tile with equipment on it.
function renderCardArt(item) {
  if (item.image) {
    // the url has to sit on the element: a relative url routed through a custom
    // property would resolve against the stylesheet's folder, not the document's
    const mask = item.mask
      ? ' style="-webkit-mask-image:url(&quot;' + _esc(item.mask) + '&quot;);mask-image:url(&quot;' + _esc(item.mask) + '&quot;)"'
      : "";
    return '<img class="eq-card__photo" src="' + _esc(item.image) + '" alt="" decoding="async" loading="lazy"' + mask + " />";
  }
  return '<svg viewBox="' + ART_VIEWBOX + '" focusable="false">' + renderArt(item.art) + "</svg>";
}

// one equipment card
function renderCard(item, viewed) {
  const isViewed = viewed.includes(item.id);
  return `
    <li class="eq-card${isViewed ? " eq-card--viewed" : ""}" data-equipment-card="${_esc(item.id)}">
      <button type="button" class="eq-card__open" data-action="open" data-equipment-id="${_esc(item.id)}">
        <span class="eq-card__art${item.image ? "" : " eq-card__art--drawn"}" aria-hidden="true">${renderCardArt(item)}</span>
        <span class="eq-card__text">
          <span class="eq-card__badge">${_moduleBadge(item)}</span>
          <span class="eq-card__name">${_text(equipmentNameKey(item.id), item.id.replace(/_/g, " "))}</span>
          <span class="eq-card__purpose">${_text(equipmentPurposeKey(item.id), "")}</span>
          <span class="eq-card__hint">${_text("prerequisite.card_open_hint", "Tap to open")}</span>
        </span>
        <span class="eq-card__state" data-role="state" aria-hidden="true">${isViewed ? "&#10003;" : ""}</span>
      </button>
      <button type="button" class="eq-card__audio" data-action="listen" data-equipment-id="${_esc(item.id)}"
        disabled aria-disabled="true"
        aria-label="${_esc(t("prerequisite.btn_listen", {}, "Listen"))}">
        <span aria-hidden="true">&#9654;</span>
      </button>
    </li>
  `;
}

// the whole familiarization screen for the current progress state
function renderScreenHtml(progress) {
  const cards = ACTIVE_EQUIPMENT.map((item) => renderCard(item, progress.viewed)).join("");
  const percent = Math.round((progress.viewedCount / progress.requiredCount) * 100);

  const counter = _esc(t("prerequisite.progress", {
    viewed: progress.viewedCount,
    total: progress.requiredCount
  }, `${progress.viewedCount} of ${progress.requiredCount} viewed`));

  // A worker may move on as soon as one module's equipment has been read — the gas
  // kit is not a prerequisite for the fire module, and the module screen locks each
  // card on its own set anyway. The banner still waits for the whole set.
  const footer = progress.anyModuleReady
    ? `<div class="eq-complete" data-role="complete">
         <p class="eq-complete__title">${_text("prerequisite.complete_title", "Equipment Familiarization Complete")}</p>
         <p class="eq-complete__desc">${_text("prerequisite.complete_desc", "You may now begin training.")}</p>
       </div>
       <button type="button" class="eq-btn eq-btn--primary eq-btn--wide" data-action="continue">${_esc(t("app.start_training", {}, "Start Training"))}</button>`
    : `<p class="eq-locked" data-role="locked">${_text("prerequisite.locked_notice", "Open every item to unlock training")}</p>
       <button type="button" class="eq-btn eq-btn--primary eq-btn--wide" data-action="continue" disabled aria-disabled="true">${_esc(t("app.start_training", {}, "Start Training"))}</button>`;

  return `
    <section class="eq-screen" aria-labelledby="eq-screen-title">
      ${renderAppBar({
        title: _text("prerequisite.title", "Equipment Familiarization"),
        subtitle: _text("prerequisite.subtitle", "Learn the equipment before training begins"),
        titleId: "eq-screen-title"
      })}
      <header class="eq-screen__head">
        <div class="eq-progress" role="progressbar" aria-valuenow="${progress.viewedCount}" aria-valuemin="0" aria-valuemax="${progress.requiredCount}">
          <div class="eq-progress__bar" data-role="progress-bar" style="width:${percent}%"></div>
        </div>
        <p class="eq-progress__count" data-role="progress-count">${counter}</p>
      </header>

      <ul class="eq-grid" data-role="grid">${cards}</ul>

      <footer class="eq-screen__foot">${footer}</footer>
    </section>
  `;
}

// cards ship with the listen control off. this turns on only the ones a real
// recording exists for in the active locale — no clip, no button.
async function _syncNarrationButtons(root, fetchFn) {
  if (!root || typeof root.querySelector !== "function") return;
  const locale = getLocale();

  await Promise.all(REQUIRED_EQUIPMENT_IDS.map(async (equipmentId) => {
    const available = await probeNarration(narrationPath(locale, equipmentId), fetchFn);
    const button = root.querySelector(`.eq-card__audio[data-equipment-id="${equipmentId}"]`);
    if (!button) return;

    button.disabled = !available;
    button.setAttribute("aria-disabled", available ? "false" : "true");
    button.setAttribute(
      "title",
      available
        ? t("prerequisite.btn_listen", {}, "Listen")
        : t("prerequisite.audio_unavailable", {}, "Narration not yet recorded")
    );
  }));
}

// draw the screen and wire it up. onContinue only ever fires once the set is done.
function mountPrerequisiteScreen({ container, workerId, onContinue, fetchFn } = {}) {
  if (typeof document === "undefined" || !container) return null;

  const host = container;

  const paint = () => {
    const progress = getPrerequisiteProgress(workerId);
    host.innerHTML = renderScreenHtml(progress);
    _syncNarrationButtons(host, fetchFn).catch(() => {});
    return progress;
  };

  paint();

  // the bar's language selector redraws this screen in the new language. progress
  // is read from storage by paint(), so nothing a worker has done is lost.
  const appBar = bindAppBar(host, { onLocaleChange: () => paint() });

  const onClick = (event) => {
    const raw = event && event.target;
    if (!raw || typeof raw.closest !== "function") return;

    const trigger = raw.closest("[data-action]");
    if (!trigger || typeof trigger.getAttribute !== "function") return;

    const action = trigger.getAttribute("data-action");
    const equipmentId = trigger.getAttribute("data-equipment-id");

    if (action === "open" && equipmentId) {
      openEquipmentDetail({
        equipmentId,
        container: host,
        fetchFn,
        returnFocusTo: trigger,
        onViewed: (id) => {
          markEquipmentViewed(workerId, id);
        },
        // repaint on close so the tick and the unlock reflect what was just read
        onClose: () => {
          paint();
        }
      });
    } else if (action === "listen" && equipmentId) {
      playNarration({ moduleId: "equipment", stepKey: equipmentId });
    } else if (action === "continue") {
      // the same rule the button is drawn with: one module's worth is enough to
      // move on, and the module screen still locks each card on its own set
      if (!getPrerequisiteProgress(workerId).anyModuleReady) {
        logger.warn({ event: "prerequisite_continue_blocked", workerId }, "Continue pressed before set finished");
        return;
      }
      if (typeof onContinue === "function") onContinue();
    }
  };

  if (typeof host.addEventListener === "function") {
    host.addEventListener("click", onClick);
  }

  logger.info({ event: "prerequisite_screen_mounted", workerId }, "Equipment familiarization shown");

  return { repaint: paint, destroy: () => appBar && appBar.destroy() };
}

export {
  SCREEN_ROOT_ID,
  renderCardArt,
  renderCard,
  renderScreenHtml,
  mountPrerequisiteScreen
};
