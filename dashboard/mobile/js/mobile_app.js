// SafeAR Mobile — Main App Orchestrator
// Wires auth, supervisor, worker, and stage views together

import { renderLogin } from "./auth.js";
import { renderSupervisor } from "./supervisor.js";
import { renderWorkerHub } from "./worker.js";
import { openStageModal } from "./stages.js";

const shell = document.querySelector(".app-shell");
const loginView = document.getElementById("login-view");
const supervisorView = document.getElementById("supervisor-view");
const workerView = document.getElementById("worker-view");
const stageOverlay = document.getElementById("stage-overlay");

function hideAllViews() {
  loginView.classList.remove("active");
  supervisorView.classList.remove("active");
  workerView.classList.remove("active");
}

function showLogin() {
  hideAllViews();
  loginView.classList.add("active");
  renderLogin(loginView, {
    onLogin: (user) => {
      if (user.role === "supervisor") {
        showSupervisor(user);
      } else {
        showWorker(user);
      }
    }
  });
}

function showSupervisor(user) {
  hideAllViews();
  supervisorView.classList.add("active");
  renderSupervisor(supervisorView, {
    user,
    onLogout: showLogin
  });
}

function showWorker(user) {
  hideAllViews();
  workerView.classList.add("active");
  renderWorkerHub(workerView, {
    user,
    onLogout: showLogin,
    onOpenModule: (moduleId) => {
      openStageModal(stageOverlay, moduleId, {
        onClose: () => {
          // Re-render worker hub to reflect updated progress
          showWorker(user);
        }
      });
    }
  });
}

// Boot
showLogin();
