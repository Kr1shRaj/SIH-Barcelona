import { createLogger } from "../js/logger.js";

const logger = createLogger("ScreenRouter");

// the flow a worker walks before any camera turns on
const SCREEN_ORDER = ["language", "prerequisite", "modules", "training"];

let _screens = {};
let _current = null;
let _container = null;

// which screen is showing
function getCurrentScreen() {
  return _current;
}

// register the render function for each screen once at boot
function registerScreens(container, screens) {
  _container = container;
  _screens = { ...screens };
  _current = null;
}

// swap to a screen, handing it the container and whatever the last screen passed on
function showScreen(name, params = {}) {
  if (!SCREEN_ORDER.includes(name)) {
    throw new Error(`unknown screen "${name}", must be one of: ${SCREEN_ORDER.join(", ")}`);
  }

  const render = _screens[name];
  if (typeof render !== "function") {
    throw new Error(`screen "${name}" has no render function registered`);
  }

  _current = name;
  logger.info({ event: "screen_shown", screen: name }, "Screen shown");

  // the training screen owns the ar shell and takes the container as it is
  if (name === "training" || !_container) {
    return render(_container, params);
  }

  // each screen gets a brand new host node rather than the container itself.
  // screens bind their click handler to whatever they are handed, and wiping
  // innerHTML would leave those handlers alive on the container — walk back and
  // forth twice and every click fires three stale screens' worth of listeners.
  // Replacing the node throws the listeners away with it.
  const host = document.createElement("div");
  host.className = "screen-host";
  _container.innerHTML = "";
  _container.appendChild(host);

  return render(host, params);
}

// the next screen in the flow, null at the end
function nextScreen(name) {
  const index = SCREEN_ORDER.indexOf(name);
  if (index === -1 || index >= SCREEN_ORDER.length - 1) return null;
  return SCREEN_ORDER[index + 1];
}

// drop all routing state, for tests and for a full restart
function resetRouter() {
  _screens = {};
  _current = null;
  _container = null;
}

export {
  SCREEN_ORDER,
  registerScreens,
  showScreen,
  getCurrentScreen,
  nextScreen,
  resetRouter
};
