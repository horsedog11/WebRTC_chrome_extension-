import { Web, Invitation } from "sip.js";

const remoteAudio = document.getElementById("remote-audio");
let phone = null;
let registered = false, busy = false, activeCall = false, incoming = false, answered = false;
let status = "Disconnected", ringTimer = null, audioContext = null, ringEnabled = true, micMuted = false;
let peer = "", sipHost = "", sipExtension = "", sipDisplayName = "";
let dndEnabled = false, rejectingDnd = false, handoff = null, handoffCompleted = "";
let autoAnswerEnabled = false, autoAnswerSession = null, parkResumeMute = false;

function callerIdentity(session) {
  const identity = session?.remoteIdentity;
  const clean = value => typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 80) : "";
  const name = clean(identity?.displayName);
  const number = clean(identity?.uri?.user);
  if (name && number && name !== number) return `${name} (${number})`;
  return name || number || "unknown caller";
}

function parseSettings(settings) {
  const host = settings?.host;
  const extension = settings?.extension;
  const displayName = settings?.displayName;
  if (typeof displayName !== "string" || !displayName.trim() || displayName.length > 64 ||
      /[\x00-\x1f\x7f]/.test(displayName))
    throw new Error("Enter a Display Name of 1–64 characters");
  if (typeof host !== "string" || typeof extension !== "string" ||
      !/^[0-9]{1,10}$/.test(extension) || !/^[a-z0-9.-]+(?::[0-9]{1,5})?$/i.test(host))
    throw new Error("Enter a valid PBX Host and numeric Extension");
  const [domain, port = "8089"] = host.split(":");
  if (!domain || domain.startsWith(".") || domain.endsWith(".") || domain.includes("..") ||
      !domain.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)) ||
      Number(port) < 1 || Number(port) > 65535)
    throw new Error("Enter a valid PBX Host and WebSocket port");
  return { host: domain.toLowerCase(), extension, displayName: displayName.trim(), wsUrl: `wss://${domain}:${port}/ws` };
}

function snapshot() {
  return { status, connected: Boolean(phone), registered, activeCall, incoming, answered, peer, ringEnabled,
    host: sipHost, extension: sipExtension, displayName: sipDisplayName, dndEnabled,
    autoAnswerEnabled, autoAnswerPending: Boolean(autoAnswerSession),
    handoffPending: Boolean(handoff),
    muted: Boolean(phone && answered && phone.isMuted()), busy };
}
function update(message) {
  status = message;
  chrome.runtime.sendMessage({ target: "phone-state", state: snapshot() }).catch(() => {});
}
function stopRing() {
  if (ringTimer !== null) clearInterval(ringTimer);
  ringTimer = null;
}
function ringOnce() {
  if (!ringEnabled || !audioContext || audioContext.state !== "running") return;
  const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
  oscillator.frequency.value = 440;
  gain.gain.value = 0.05;
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.32);
}
function startRing() {
  stopRing();
  if (!ringEnabled) return;
  ringOnce(); ringTimer = setInterval(ringOnce, 1400);
}
async function beepBeforeAnswer() {
  if (!audioContext) throw new Error("Audio unavailable");
  if (audioContext.state !== "running") await audioContext.resume();
  if (audioContext.state !== "running") throw new Error("Chrome blocked the notification beep");
  const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
  oscillator.frequency.value = 880;
  gain.gain.value = 0.08;
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.25);
  await new Promise(resolve => setTimeout(resolve, 5000));
}
remoteAudio.addEventListener("loadedmetadata", () => {
  remoteAudio.play().catch(() => update("Call connected; Chrome blocked automatic audio playback"));
});

async function handoffCall(destination, kind) {
  if (!answered || !phone?.session) throw new Error("Answer a call before " + kind.toLowerCase());
  if (handoff) throw new Error("A transfer is already in progress");
  const session = phone.session;
  const marker = { session, kind, destination };
  handoff = marker;
  update(kind === "Park" ? "Sending caller to parking entry 70; waiting for PBX result…" :
    "Transferring to " + destination + "; waiting for PBX result…");
  try {
    await phone.sessionManager.transfer(session, `sip:${encodeURIComponent(destination)}@${sipHost}`, {
      requestDelegate: {
        onAccept: () => {
          if (handoff === marker) update(kind + " accepted by PBX; waiting for completion…");
        },
        onReject: () => {
          if (handoff !== marker) return;
          handoff = null;
          update(kind + " rejected by PBX; caller remains connected");
        }
      },
      onNotify: notification => {
        notification.accept().catch(() => {});
        if (handoff !== marker) return;
        const match = /^SIP\/2\.0\s+(\d{3})\b/i.exec(String(notification.request.body || "").trim());
        const code = match && Number(match[1]);
        if (code >= 200 && code < 300) {
          handoffCompleted = kind === "Park" ?
            "Park transfer completed; dial the assigned slot (often 71–78), not 70" :
            "Transfer to " + destination + " completed";
          if (kind === "Park") parkResumeMute = micMuted;
          handoff = null;
          update(handoffCompleted + "; releasing this call…");
          if (phone?.session === session) phone.hangup().catch(error => update("Transfer completed; hang up manually: " + error.message));
        } else if (code >= 300) {
          handoff = null;
          update(kind + " failed (SIP " + code + "); caller remains connected");
        }
      }
    });
  } catch (error) {
    if (handoff === marker) handoff = null;
    throw error;
  }
}

async function connect(password, settings) {
  if (phone) throw new Error("Phone is already connected");
  const config = parseSettings(settings);
  if (typeof password !== "string" || !password) throw new Error("Enter the SIP password");
  if (chrome.storage?.local) {
    const saved = await chrome.storage.local.get(["localDnd", "autoAnswer"]);
    dndEnabled = saved.localDnd === true;
    autoAnswerEnabled = saved.autoAnswer === true;
  }
  sipHost = config.host; sipExtension = config.extension; sipDisplayName = config.displayName;
  audioContext = new AudioContext();
  audioContext.resume().catch(() => {});
  update("Connecting to SIP WebSocket…");
  const instance = new Web.SimpleUser(config.wsUrl, {
    aor: `sip:${sipExtension}@${sipHost}`,
    sendDTMFUsingSessionDescriptionHandler: true,
    userAgentOptions: {
      authorizationUsername: sipExtension, authorizationPassword: password,
      displayName: sipDisplayName, logLevel: "error"
    },
    media: { remote: { audio: remoteAudio } },
    delegate: {
      onServerConnect: () => update("WebSocket connected; registering…"),
      onServerDisconnect: () => { registered = false; stopRing(); update("WebSocket disconnected"); },
      onRegistered: () => { registered = true; update("Registered as " + sipExtension); },
      onUnregistered: () => { registered = false; update("Unregistered"); },
      onCallReceived: () => {
        if (dndEnabled && phone?.session instanceof Invitation) {
          rejectingDnd = true;
          update("DND: rejecting incoming call with SIP 486 Busy Here");
          phone.session.reject({ statusCode: 486, reasonPhrase: "Busy Here" }).catch(error => {
            rejectingDnd = false;
            update("DND rejection failed: " + (error.message || String(error)));
          });
          return;
        }
        incoming = activeCall = true; answered = false;
        peer = callerIdentity(phone?.session);
        chrome.runtime.sendMessage({ target: "background-event", event: "incoming" }).catch(() => {});
        if (autoAnswerEnabled) {
          const session = phone.session;
          autoAnswerSession = session;
          update("Incoming from " + peer + " — beep before Auto Answer…");
          beepBeforeAnswer().then(async () => {
            if (autoAnswerSession !== session || !incoming || !autoAnswerEnabled || phone?.session !== session) return;
            await phone.answer();
          }).catch(error => {
            if (autoAnswerSession !== session || !incoming) return;
            update("Auto Answer failed: " + (error.message || String(error)) + "; answer manually");
            startRing();
          }).finally(() => {
            if (autoAnswerSession === session) { autoAnswerSession = null; update(status); }
          });
        } else {
          update("Incoming from " + peer + " — answer or hang up");
          startRing();
        }
      },
      onCallCreated: () => { activeCall = true; answered = false; update("Call started; waiting for answer…"); },
      onCallAnswered: () => {
        incoming = false; answered = true; stopRing();
        if (micMuted) phone?.mute();
        update(micMuted ? "Connected — microphone remains muted" : "Connected — check audio both ways");
      },
      onCallHangup: () => {
        const finalStatus = rejectingDnd ? "DND sent Busy Here; still registered" :
          handoffCompleted || "Call ended; still registered";
        rejectingDnd = false; handoff = null; handoffCompleted = ""; autoAnswerSession = null;
        incoming = activeCall = answered = false; peer = ""; stopRing();
        micMuted = false;
        update(finalStatus);
      }
    }
  });
  phone = instance;
  try {
    await instance.connect();
    await instance.register();
    if (!registered) update("REGISTER sent; waiting for confirmation…");
  } catch (error) {
    phone = null; registered = false;
    try { await instance.disconnect(); } catch (_) { /* best effort */ }
    if (audioContext) { await audioContext.close(); audioContext = null; }
    throw error;
  }
}

async function run(command, password, number, settings) {
  if (command === "state") return { ok: true, state: snapshot() };
  if (busy) return { ok: false, error: "Phone is busy", state: snapshot() };
  busy = true; update(status);
  let errorMessage = null;
  try {
    switch (command) {
      case "connect": await connect(password, settings); break;
      case "disconnect":
        if (phone) {
          stopRing();
          if (activeCall) await phone.hangup();
          if (registered) await phone.unregister();
          await phone.disconnect();
          phone = null;
        }
        registered = activeCall = incoming = answered = false; peer = "";
        rejectingDnd = false; handoff = null; handoffCompleted = ""; autoAnswerSession = null;
        micMuted = parkResumeMute = false;
        if (audioContext) { await audioContext.close(); audioContext = null; }
        update("Disconnected");
        break;
      case "call":
        if (!registered || activeCall || !phone) throw new Error("Register before calling");
        if (typeof number !== "string" || !(/^\+?[0-9]{2,15}$/.test(number) || /^\*7[89]$/.test(number)))
          throw new Error("Invalid dial number");
        micMuted = parkResumeMute && /^7[1-8]$/.test(number);
        parkResumeMute = false;
        peer = number;
        update("Calling " + number + "…");
        await phone.call("sip:" + (/^\*7[89]$/.test(number) ? number : encodeURIComponent(number)) + "@" + sipHost);
        break;
      case "dnd":
        if (!registered || activeCall || !phone) throw new Error("Register and finish the call before changing DND");
        if (chrome.storage?.local) await chrome.storage.local.set({ localDnd: !dndEnabled });
        dndEnabled = !dndEnabled;
        update(dndEnabled ? "DND on: incoming calls receive Busy Here" : "DND off: incoming calls ring");
        break;
      case "autoanswer":
        if (!registered || !phone) throw new Error("Register before changing Auto Answer");
        if (chrome.storage?.local) await chrome.storage.local.set({ autoAnswer: !autoAnswerEnabled });
        autoAnswerEnabled = !autoAnswerEnabled;
        if (!autoAnswerEnabled && autoAnswerSession) {
          autoAnswerSession = null;
          if (incoming) startRing();
        }
        update(autoAnswerEnabled ? "Auto Answer on — beep before incoming calls connect" : "Auto Answer off");
        break;
      case "transfer":
        if (typeof number !== "string" || !/^(?:\*[0-9]{2,15}|\+?[0-9]{2,15})$/.test(number))
          throw new Error("Invalid transfer destination");
        await handoffCall(number, "Transfer");
        break;
      case "park":
        await handoffCall("70", "Park");
        break;
      case "dtmf":
        if (!answered || !phone || !/^[0-9*#]$/.test(number || "")) throw new Error("No active call or invalid tone");
        await phone.sendDTMF(number); update("Sent keypad tone " + number);
        break;
      case "answer":
        if (!incoming || !phone) throw new Error("No incoming call");
        stopRing(); await phone.answer(); break;
      case "hangup":
        if (!activeCall || !phone) throw new Error("No active call");
        stopRing(); await phone.hangup(); break;
      case "mute":
        if (!answered || !phone) throw new Error("No answered call");
        micMuted = !micMuted;
        if (micMuted) { phone.mute(); update("Microphone muted"); }
        else { phone.unmute(); update("Microphone on"); }
        break;
      case "ring":
        ringEnabled = !ringEnabled;
        if (!ringEnabled) stopRing();
        else if (incoming) startRing();
        update(status);
        break;
      default: throw new Error("Unknown phone command");
    }
  } catch (error) {
    if (command === "call" && !activeCall) peer = "";
    errorMessage = error.message || String(error);
    update("Operation failed: " + errorMessage);
  } finally {
    busy = false; update(status);
  }
  return { ok: !errorMessage, error: errorMessage, state: snapshot() };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "offscreen") return false;
  run(message.command, message.password, message.number, message.settings).then(sendResponse);
  return true;
});
