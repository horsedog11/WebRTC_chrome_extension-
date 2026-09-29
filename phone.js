const byId = id => document.getElementById(id);
let state = { status: "Disconnected", connected: false, registered: false,
  activeCall: false, incoming: false, answered: false, muted: false, busy: false, ringEnabled: true,
  dndEnabled: false, autoAnswerEnabled: false };
let pending = false;
let lastDialIntent = null;
let resizeScheduled = false;
let controls = { direction: "out", ready: false };
let controlsTouched = false;
let controlSave = Promise.resolve();
let settingsTouched = false;
let settingsSave = Promise.resolve();

function showExtension() {
  const extension = state.connected ? state.extension : byId("sip-extension").value.trim();
  const displayName = state.connected ? state.displayName : byId("sip-display-name").value.trim();
  const label = [displayName, extension].filter(Boolean).join(" - ") || "—";
  byId("extension-badge").textContent = label;
  byId("extension-badge").title = label;
}

async function loadSettings() {
  if (!chrome.storage?.local) return;
  const { sipSettings } = await chrome.storage.local.get("sipSettings");
  if (settingsTouched || !sipSettings || state.connected) return;
  byId("sip-host").value = sipSettings.host || "";
  byId("sip-extension").value = sipSettings.extension || "";
  byId("sip-display-name").value = sipSettings.displayName || "";
  showExtension();
}

function saveSettings() {
  settingsTouched = true;
  showExtension();
  if (!chrome.storage?.local || state.connected) return;
  const sipSettings = { host: byId("sip-host").value.trim(), extension: byId("sip-extension").value.trim(),
    displayName: byId("sip-display-name").value.trim() };
  settingsSave = settingsSave.then(() => chrome.storage.local.set({ sipSettings })).catch(() => {});
}

function refreshControls() {
  for (const direction of ["in", "out"]) {
    const selected = controls.direction === direction;
    byId("mode-" + direction).classList.toggle("is-selected", selected);
    byId("mode-" + direction).setAttribute("aria-pressed", String(selected));
  }
  byId("ready").classList.toggle("is-ready", controls.ready);
  byId("ready").setAttribute("aria-pressed", String(controls.ready));
  byId("ready").textContent = controls.ready ? "Pause" : "Ready";
}

async function loadControls() {
  if (!chrome.storage?.session) return;
  const stored = (await chrome.storage.session.get("uiControls")).uiControls;
  if (!controlsTouched && stored && typeof stored === "object") {
    controls = {
      direction: stored.direction === "in" ? "in" : "out",
      ready: stored.ready === true
    };
    refreshControls();
  }
}

function setControl(change) {
  controlsTouched = true;
  controls = { ...controls, ...change };
  refreshControls();
  if (chrome.storage?.session) {
    const snapshot = { ...controls };
    controlSave = controlSave.then(() => chrome.storage.session.set({ uiControls: snapshot })).catch(() => {});
  }
}

function scheduleResize() {
  if (resizeScheduled || typeof requestAnimationFrame !== "function" || !chrome.windows?.getCurrent) return;
  resizeScheduled = true;
  requestAnimationFrame(async () => {
    resizeScheduled = false;
    const frameHeight = window.outerHeight - window.innerHeight;
    const contentHeight = document.querySelector("main").scrollHeight;
    const height = Math.max(340, Math.min(screen.availHeight - 24, Math.ceil(contentHeight + frameHeight + 8)));
    if (Math.abs(window.outerHeight - height) < 8) return;
    try {
      const current = await chrome.windows.getCurrent();
      await chrome.windows.update(current.id, { height });
    } catch (_) { /* Chrome may decline a resize near the screen edge. */ }
  });
}

async function checkMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error("Chrome cannot access a microphone in this window");
  try {
    // Ask while the control window is visible. The offscreen SIP session shares
    // this extension origin, but cannot display a dismissed permission prompt.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    stream.getTracks().forEach(track => track.stop());
  } catch (error) {
    if (error.name === "NotAllowedError" || error.name === "PermissionDismissedError")
      throw new Error("Microphone permission dismissed or blocked. Allow this extension to use the microphone, then retry.");
    if (error.name === "NotFoundError") throw new Error("No microphone found. Connect one and retry.");
    throw error;
  }
}

function refresh() {
  byId("status").textContent = state.status;
  byId("session").disabled = state.busy || pending;
  byId("session").textContent = state.connected ? "Disconnect" : "Register";
  byId("session").classList.toggle("is-disconnect", state.connected);
  byId("sip-secret").required = !state.connected;
  for (const id of ["sip-host", "sip-extension", "sip-display-name"]) byId(id).disabled = state.connected || state.busy || pending;
  showExtension();
  const canCall = state.registered && !state.activeCall && Boolean(normalizeCallTarget(byId("destination").value));
  const canHangup = state.activeCall;
  const disableDialAction = state.busy || pending || (!canCall && !canHangup);
  byId("call").disabled = disableDialAction;
  byId("keypad-call").disabled = disableDialAction;
  for (const id of ["call", "keypad-call"]) byId(id).classList.toggle("is-hangup", canHangup);
  byId("call").setAttribute("aria-label", canHangup ? "Hang up" : "Call number");
  byId("call").title = canHangup ? "Hang up" : "Call number";
  byId("keypad-call").textContent = canHangup ? "Hang up" : "Call number";
  byId("answer").disabled = !state.registered || !state.incoming || state.autoAnswerPending || state.busy || pending;
  byId("answer").hidden = !state.incoming || Boolean(state.autoAnswerPending);
  byId("mute").disabled = !state.answered || state.busy || pending;
  byId("mute").hidden = !state.answered;
  byId("call-bar").hidden = !state.activeCall;
  byId("caller").textContent = state.incoming ? "From " + (state.peer || "unknown caller") : "Call with " + (state.peer || "outgoing number");
  byId("mute").classList.toggle("is-muted", state.muted);
  byId("mute").setAttribute("aria-label", state.muted ? "Unmute microphone" : "Mute microphone");
  byId("mute").title = state.muted ? "Unmute microphone" : "Mute microphone";
  byId("mute").setAttribute("aria-pressed", String(state.muted));
  byId("transfer").disabled = !state.answered || state.handoffPending || state.busy || pending || !normalizeTransferTarget(byId("transfer-target").value);
  byId("park").disabled = !state.answered || state.handoffPending || state.busy || pending;
  byId("transfer-target").disabled = !state.answered || state.busy || pending;
  byId("sip-secret").disabled = state.connected || state.busy || pending;
  byId("dnd").disabled = !state.registered || state.activeCall || state.busy || pending;
  byId("dnd").classList.toggle("is-on", state.dndEnabled === true);
  byId("dnd").setAttribute("aria-pressed", String(state.dndEnabled === true));
  byId("dnd").title = state.dndEnabled === true ? "Accept incoming calls" : "Reject incoming calls as busy";
  byId("auto-answer").disabled = !state.registered || state.busy || pending;
  byId("auto-answer").classList.toggle("is-on", state.autoAnswerEnabled === true);
  byId("auto-answer").setAttribute("aria-pressed", String(state.autoAnswerEnabled === true));
  byId("auto-answer").setAttribute("aria-label", state.autoAnswerEnabled ? "Turn Auto Answer off" : "Turn Auto Answer on");
  byId("auto-answer").title = state.autoAnswerEnabled ? "Auto Answer on — beep before answering" : "Auto Answer off";
  byId("ring").disabled = !state.connected || state.busy || pending;
  byId("ring").classList.toggle("is-off", state.ringEnabled === false);
  byId("ring").setAttribute("aria-pressed", String(state.ringEnabled !== false));
  byId("ring").setAttribute("aria-label", state.ringEnabled === false ? "Turn ringer on" : "Turn ringer off");
  byId("ring").title = state.ringEnabled === false ? "Ringer off" : "Ringer on";
  for (const button of document.querySelectorAll("[data-tone]")) {
    const tone = button.dataset.tone;
    button.disabled = state.busy || pending || (state.activeCall && !state.answered) ||
      (!state.answered && (tone === "*" || tone === "#"));
  }
  scheduleResize();
}

async function command(name, password, number, settings) {
  if (pending) return;
  pending = true; refresh();
  try {
    if (["connect", "call", "answer"].includes(name)) {
      state.status = "Checking microphone permission…"; refresh();
      await checkMicrophone();
    }
    const response = await chrome.runtime.sendMessage({ target: "background", command: name, password, number, settings });
    if (!response || typeof response.ok !== "boolean")
      throw new Error("Phone worker did not reply. Reload PV Phone in chrome://extensions, then reopen it and register again.");
    if (response?.state) state = response.state;
    if (!response.ok) state.status = "Operation failed: " + (response.error || "Phone worker returned no details. Reload PV Phone in chrome://extensions.");
    if (name === "connect" && response?.ok) byId("sip-secret").value = "";
  } catch (error) {
    state.status = "Operation failed: " + (error.message || String(error));
  } finally {
    pending = false; refresh();
  }
}

chrome.runtime.onMessage.addListener(message => {
  if (message?.target === "phone-state") { state = message.state; refresh(); }
  if (message?.target === "dial-pending") takeDialIntent();
});
byId("credentials").addEventListener("submit", event => {
  event.preventDefault();
  if (state.connected) { command("disconnect"); return; }
  const password = byId("sip-secret").value;
  const settings = { host: byId("sip-host").value.trim(), extension: byId("sip-extension").value.trim(),
    displayName: byId("sip-display-name").value.trim() };
  if (!settings.host || !settings.extension || !settings.displayName || !password) {
    state.status = "Enter Host, Extension, Display Name, and Password."; refresh(); return;
  }
  saveSettings();
  command("connect", password, undefined, settings);
});
for (const id of ["sip-host", "sip-extension", "sip-display-name"]) byId(id).addEventListener("input", saveSettings);
function dialOrHangup() {
  if (state.activeCall) { command("hangup"); return; }
  const number = normalizeCallTarget(byId("destination").value);
  if (!number) { state.status = "Enter a valid extension or telephone number."; refresh(); return; }
  command("call", undefined, number);
}
for (const name of ["answer", "mute", "ring"])
  byId(name).addEventListener("click", () => command(name));
byId("dnd").addEventListener("click", () => command("dnd"));
byId("auto-answer").addEventListener("click", () => command("autoanswer"));
byId("transfer-target").addEventListener("input", refresh);
byId("transfer").addEventListener("click", () => {
  const target = normalizeTransferTarget(byId("transfer-target").value);
  if (target) command("transfer", undefined, target);
});
byId("park").addEventListener("click", () => command("park"));
for (const direction of ["in", "out"])
  byId("mode-" + direction).addEventListener("click", () => setControl({ direction }));
byId("ready").addEventListener("click", () => setControl({ ready: !controls.ready }));
byId("call").addEventListener("click", dialOrHangup);
byId("keypad-call").addEventListener("click", dialOrHangup);
byId("destination").addEventListener("input", refresh);
byId("destination").addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    if (!state.activeCall && !byId("call").disabled) dialOrHangup();
  }
});
for (const button of document.querySelectorAll("[data-tone]")) {
  button.addEventListener("click", () => {
    const tone = button.dataset.tone;
    if (state.answered) command("dtmf", undefined, tone);
    else {
      byId("destination").value += tone;
      refresh();
    }
  });
}
for (const panel of document.querySelectorAll("details")) panel.addEventListener("toggle", scheduleResize);

async function takeDialIntent() {
  const response = await chrome.runtime.sendMessage({ target: "background", command: "take-dial-intent" });
  const intent = response?.intent;
  if (!intent || intent.id === lastDialIntent) return;
  lastDialIntent = intent.id;
  byId("destination").value = intent.number;
  refresh();
  if (state.registered && !state.activeCall && !pending) command("call", undefined, intent.number);
  else {
    state.status = state.activeCall ? "Number ready after the current call." : "Number ready. Register the phone to call it.";
    refresh();
  }
}
refreshControls();
loadControls().catch(() => {});
loadSettings().catch(() => {});
refresh();
command("state").then(takeDialIntent);
