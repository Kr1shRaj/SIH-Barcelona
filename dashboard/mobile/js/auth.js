// SafeAR Mobile — Auth / Login Window
// Branded login with SafeAR logo, role tabs, and quick-demo persona buttons

import { SUPERVISOR_PERSONA, WORKER_PERSONA } from "./state.js";

export function renderLogin(container, { onLogin }) {
  container.innerHTML = `
    <div class="login-card">
      <div class="login-logo-wrap">
        <img src="../img/logo.png" alt="SafeAR Logo" class="login-logo" id="login-logo-img">
        <div class="login-title">SafeAR</div>
        <div class="login-subtitle">Mine Safety Training Platform</div>
      </div>

      <div class="role-tabs" id="role-tabs">
        <button class="role-tab active" data-role="worker" type="button">👷 Mine Worker</button>
        <button class="role-tab" data-role="supervisor" type="button">📋 Supervisor</button>
      </div>

      <div class="login-error" id="login-error"></div>

      <form class="login-form" id="login-form" autocomplete="off">
        <div class="form-group">
          <label class="form-label" for="login-id" id="login-id-label">Worker ID</label>
          <input class="form-input" id="login-id" type="text" placeholder="e.g. WRK-9021" autocomplete="off">
        </div>
        <div class="form-group">
          <label class="form-label" for="login-pin">PIN / Password</label>
          <input class="form-input" id="login-pin" type="password" placeholder="Enter your PIN" autocomplete="off">
        </div>
        <button class="login-btn" type="submit" id="login-submit-btn">Sign In →</button>
      </form>

      <div class="login-divider"><span>Quick Demo Access</span></div>

      <div class="demo-buttons">
        <button class="demo-btn" id="demo-worker" type="button">
          <span class="demo-icon">👷</span>
          Login as Worker
        </button>
        <button class="demo-btn" id="demo-supervisor" type="button">
          <span class="demo-icon">📋</span>
          Login as Supervisor
        </button>
      </div>
    </div>
  `;

  // State
  let selectedRole = "worker";

  // Role tabs
  const tabs = container.querySelectorAll(".role-tab");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      selectedRole = tab.dataset.role;
      const label = container.querySelector("#login-id-label");
      const input = container.querySelector("#login-id");
      if (selectedRole === "supervisor") {
        label.textContent = "Supervisor ID";
        input.placeholder = "e.g. SUP-JH-0412";
      } else {
        label.textContent = "Worker ID";
        input.placeholder = "e.g. WRK-9021";
      }
    });
  });

  // Form submit
  const form = container.querySelector("#login-form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const id = container.querySelector("#login-id").value.trim();
    const pin = container.querySelector("#login-pin").value.trim();
    const errEl = container.querySelector("#login-error");

    if (!id) {
      errEl.textContent = "Please enter your ID.";
      errEl.classList.add("visible");
      return;
    }
    if (!pin) {
      errEl.textContent = "Please enter your PIN.";
      errEl.classList.add("visible");
      return;
    }

    errEl.classList.remove("visible");

    // For demo, accept any credentials
    if (selectedRole === "supervisor") {
      onLogin({ ...SUPERVISOR_PERSONA, id });
    } else {
      onLogin({ ...WORKER_PERSONA, id });
    }
  });

  // Quick demo buttons
  container.querySelector("#demo-worker").addEventListener("click", () => {
    onLogin({ ...WORKER_PERSONA });
  });

  container.querySelector("#demo-supervisor").addEventListener("click", () => {
    onLogin({ ...SUPERVISOR_PERSONA });
  });
}
