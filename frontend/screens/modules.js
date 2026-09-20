import { t, getLocale } from "../js/i18n.js";
import { createLogger } from "../js/logger.js";
import { renderAppBar, bindAppBar } from "./appbar.js";
import { getEquipmentForModule, equipmentNameKey } from "../prerequisite/equipment-data.js";
import { isTranslationPending } from "../prerequisite/translation-status.js";
import { isPrerequisiteComplete } from "../prerequisite/progress.js";

const logger = createLogger("ModuleScreen");

// the two training modules, in the order a worker meets them
const TRAINING_MODULES = [
  {
    id: "fire-response",
    icon: "🔥",
    titleKey: "modules.fire_response.title",
    titleFallback: "Fire & Explosion Response",
    tone: "fire"
  },
  {
    id: "gas-leak",
    icon: "☣",
    titleKey: "modules.gas_leak.title",
    titleFallback: "Gas Leak & Confined Space Protocol",
    tone: "gas"
  }
];

// escape anything that reaches innerHTML
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

// plain translated text, no markup, for attributes like aria-label
function _plainText(key, fallback) {
  return _esc(t(key, {}, fallback));
}

// the equipment this module expects the worker to already know
function _equipmentLine(moduleId) {
  return getEquipmentForModule(moduleId)
    .map((item) => _text(equipmentNameKey(item.id), item.id.replace(/_/g, " ")))
    .join(" &middot; ");
}

// Module selection. Each card is inert until ITS OWN equipment has been read: the
// fire module waits on the extinguisher, the gas module on the detector, the
// breathing set and the harness. Reading one module's kit does not open the other's.
//
// `unlocked` is a map of module id to boolean. A plain boolean still works and means
// the same answer for every module.
function _isUnlocked(unlocked, moduleId) {
  if (typeof unlocked === "boolean") return unlocked;
  return Boolean(unlocked && unlocked[moduleId]);
}

function renderModulesHtml(unlocked) {
  const cards = TRAINING_MODULES.map((module) => `
    <li class="mod-card mod-card--${_esc(module.tone)}${_isUnlocked(unlocked, module.id) ? "" : " mod-card--locked"}">
      <button type="button" class="mod-card__btn" data-action="start-module" data-module-id="${_esc(module.id)}"
        ${_isUnlocked(unlocked, module.id) ? "" : 'disabled aria-disabled="true"'}>
        <span class="mod-card__icon" aria-hidden="true">${module.icon}</span>
        <span class="mod-card__body">
          <span class="mod-card__title">${_text(module.titleKey, module.titleFallback)}</span>
          <span class="mod-card__equipment">${_equipmentLine(module.id)}</span>
        </span>
      </button>
    </li>`).join("");

  // the notice stands while anything is still locked
  const anyLocked = TRAINING_MODULES.some((module) => !_isUnlocked(unlocked, module.id));
  const notice = anyLocked
    ? `<p class="mod-locked" data-role="locked-notice">${_text("modules.locked", "Complete equipment familiarization first")}</p>`
    : "";

  return `
    <section class="mod-screen" aria-labelledby="mod-title">
      ${renderAppBar({
        title: _text("modules.select_title", "Choose Your Training"),
        subtitle: _text("modules.select_subtitle", "Pick a module to begin"),
        titleId: "mod-title",
        back: { action: "back-to-equipment", label: _plainText("prerequisite.title", "Equipment Familiarization") }
      })}
      ${notice}
      <ul class="mod-list">${cards}</ul>
    </section>
  `;
}

// draw module selection and wire it. the gate is checked here and again in loadModule.
function mountModulesScreen({ container, workerId, onStart, onBack } = {}) {
  if (typeof document === "undefined" || !container) return null;

  // gating is re-read on every paint rather than captured once, so a redraw can
  // never show a stale lock
  const paint = () => {
    const unlocked = {};
    TRAINING_MODULES.forEach((module) => {
      unlocked[module.id] = isPrerequisiteComplete(workerId, module.id);
    });
    container.innerHTML = renderModulesHtml(unlocked);
  };

  paint();

  const appBar = bindAppBar(container, { onLocaleChange: () => paint() });

  const onClick = (event) => {
    const raw = event && event.target;
    if (!raw || typeof raw.closest !== "function") return;

    const trigger = raw.closest("[data-action]");
    if (!trigger || typeof trigger.getAttribute !== "function") return;

    const action = trigger.getAttribute("data-action");

    if (action === "back-to-equipment") {
      if (typeof onBack === "function") onBack();
      return;
    }

    if (action !== "start-module") return;

    const moduleId = trigger.getAttribute("data-module-id");
    if (!moduleId) return;

    // the button is already disabled when locked; this is the second look, in case
    // the dom was poked at or progress was cleared in another tab
    if (!isPrerequisiteComplete(workerId, moduleId)) {
      logger.warn({ event: "module_start_blocked", moduleId, workerId }, "Module start blocked, equipment not read");
      return;
    }

    if (typeof onStart === "function") onStart(moduleId);
  };

  if (typeof container.addEventListener === "function") {
    container.addEventListener("click", onClick);
  }

  // log what the gate says at mount time, read fresh rather than from a captured map
  logger.info({
    event: "module_screen_mounted",
    unlocked: TRAINING_MODULES.reduce((acc, module) => {
      acc[module.id] = isPrerequisiteComplete(workerId, module.id);
      return acc;
    }, {})
  }, "Module selection shown");
  return { repaint: paint, destroy: () => appBar && appBar.destroy() };
}

export {
  TRAINING_MODULES,
  renderModulesHtml,
  mountModulesScreen
};
