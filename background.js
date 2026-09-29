importScripts("dial.js");
const phoneUrl = chrome.runtime.getURL("phone.html");
const offscreenUrl = chrome.runtime.getURL("offscreen.html");
let creating;
let takingDial = false;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "dial-selection", title: "Call %s with PV Phone", contexts: ["selection"] });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "dial-selection") return;
  const number = normalizeDialTarget(info.selectionText);
  if (!number) return;
  await chrome.storage.session.set({ dialIntent: { number, id: crypto.randomUUID() } });
  await openPhone();
  chrome.runtime.sendMessage({ target: "dial-pending" }).catch(() => {});
});

async function takeDialIntent() {
  if (takingDial) return { ok: true, intent: null };
  takingDial = true;
  try {
    const { dialIntent } = await chrome.storage.session.get("dialIntent");
    if (dialIntent) await chrome.storage.session.remove("dialIntent");
    return { ok: true, intent: dialIntent || null };
  } finally { takingDial = false; }
}

async function openPhone() {
  const windows = await chrome.windows.getAll({ populate: true });
  const existing = windows.find(w => w.tabs?.some(t => t.url === phoneUrl));
  if (existing) return chrome.windows.update(existing.id, { focused: true });
  return chrome.windows.create({ url: phoneUrl, type: "popup", width: 380, height: 520 });
}

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [offscreenUrl]
  });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  if (!creating) {
    creating = chrome.offscreen.createDocument({
      url: "offscreen.html", reasons: ["USER_MEDIA", "WEB_RTC"],
      justification: "Keep the WebRTC phone active after its control window closes."
    }).finally(() => { creating = null; });
  }
  await creating;
}

chrome.action.onClicked.addListener(() => { openPhone().catch(console.error); });
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === "background-event" && message.event === "incoming") {
    openPhone().catch(console.error);
    return false;
  }
  if (message?.target === "background" && message.command === "take-dial-intent") {
    takeDialIntent().then(sendResponse, error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.target !== "background" ||
      !["state", "connect", "disconnect", "call", "answer", "hangup", "mute", "dtmf", "ring", "dnd", "autoanswer", "transfer", "park"].includes(message.command)) return false;

  (async () => {
    if (message.command === "call" && !normalizeCallTarget(message.number))
      return { ok: false, error: "Invalid dial number" };
    if (message.command === "transfer" && !normalizeTransferTarget(message.number))
      return { ok: false, error: "Invalid transfer destination" };
    if (message.command === "dtmf" && !/^[0-9*#]$/.test(message.number || ""))
      return { ok: false, error: "Invalid keypad tone" };
    if (message.command === "connect") await ensureOffscreen();
    else if (!(await hasOffscreen())) {
      if (message.command !== "state") return { ok: false, error: "Register the phone first" };
      const { localDnd, autoAnswer } = await chrome.storage.local.get(["localDnd", "autoAnswer"]);
      return { ok: true, state: { status: "Disconnected", connected: false,
        registered: false, activeCall: false, incoming: false, answered: false,
        muted: false, busy: false, peer: "", host: "", extension: "", ringEnabled: true,
        dndEnabled: localDnd === true, autoAnswerEnabled: autoAnswer === true,
        autoAnswerPending: false, handoffPending: false } };
    }
    const result = await chrome.runtime.sendMessage({
      target: "offscreen", command: message.command,
      password: message.command === "connect" ? message.password : undefined,
      number: message.number,
      settings: message.command === "connect" ? message.settings : undefined
    });
    if (!result || typeof result.ok !== "boolean")
      return { ok: false, error: "Phone engine did not reply. Reload PV Phone in chrome://extensions and register again." };
    if (message.command === "disconnect" && result?.ok) await chrome.offscreen.closeDocument();
    return result;
  })().then(sendResponse, error => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});
