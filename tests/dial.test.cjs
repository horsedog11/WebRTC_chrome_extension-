const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const root = path.join(__dirname, "..");
const dialSource = fs.readFileSync(path.join(root, "dial.js"), "utf8");

test("dial parser accepts numbers and rejects page text", () => {
  const context = vm.createContext({});
  vm.runInContext(dialSource, context);
  for (const [input, expected] of [
    ["206", "206"], ["tel:+1 (306) 555-0100", "+13065550100"],
    ["someone@example.com", null], ["Call 206 now", null],
    ["206;transport=udp", null], ["1234567890123456", null]
  ]) assert.equal(vm.runInContext(`normalizeDialTarget(${JSON.stringify(input)})`, context), expected);
  assert.equal(vm.runInContext('normalizeCallTarget("*78")', context), "*78");
  assert.equal(vm.runInContext('normalizeCallTarget("*79")', context), "*79");
  assert.equal(vm.runInContext('normalizeCallTarget("*22")', context), null);
  assert.equal(vm.runInContext('normalizeTransferTarget("*205")', context), "*205");
  assert.equal(vm.runInContext('normalizeTransferTarget("* 205")', context), "*205");
  assert.equal(vm.runInContext('normalizeTransferTarget("**205")', context), null);
});

test("selection menu opens the phone and hands off one normalized number", async () => {
  let clicked, onMessage, onInstalled, stored = {}, opened = 0;
  const chrome = {
    action: { onClicked: { addListener() {} } },
    runtime: {
      getURL: file => "chrome-extension://test/" + file,
      onInstalled: { addListener: fn => { onInstalled = fn; } },
      onMessage: { addListener: fn => { onMessage = fn; } },
      sendMessage: async () => {}
    },
    contextMenus: {
      create: item => assert.equal(item.contexts[0], "selection"),
      onClicked: { addListener: fn => { clicked = fn; } }
    },
    storage: { session: {
      set: async item => Object.assign(stored, item),
      get: async key => ({ [key]: stored[key] }),
      remove: async key => { delete stored[key]; }
    } },
    windows: {
      getAll: async () => [],
      create: async () => { opened++; return { id: opened }; }
    },
    offscreen: { createDocument: async () => {} }
  };
  const context = vm.createContext({ chrome, crypto: { randomUUID: () => "intent-1" }, console,
    importScripts: file => vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context) });
  vm.runInContext(fs.readFileSync(path.join(root, "background.js"), "utf8"), context);
  onInstalled();
  await clicked({ menuItemId: "dial-selection", selectionText: "Call me" });
  assert.equal(opened, 0);
  await clicked({ menuItemId: "dial-selection", selectionText: "+1 (306) 555-0100" });
  assert.equal(opened, 1);
  assert.equal(stored.dialIntent.number, "+13065550100");
  const first = await new Promise(resolve => onMessage({ target: "background", command: "take-dial-intent" }, {}, resolve));
  assert.equal(first.intent.number, "+13065550100");
  const second = await new Promise(resolve => onMessage({ target: "background", command: "take-dial-intent" }, {}, resolve));
  assert.equal(second.intent, null);
});

test("selected number calls only when registered and releases microphone probe", async () => {
  for (const registered of [true, false]) {
    const elements = new Map();
    const element = id => {
      if (!elements.has(id)) elements.set(id, {
        value: id === "destination" ? "206" : "", textContent: "", dataset: {}, listeners: {},
        addEventListener(type, fn) { this.listeners[type] = fn; }, setAttribute() {}, click() {}, classList: { toggle() {} }
      });
      return elements.get(id);
    };
    const sent = [];
    let stopped = 0;
    const state = { status: registered ? "Registered as 209" : "Disconnected", connected: registered,
      registered, activeCall: false, incoming: false, answered: false, busy: false };
    const chrome = { runtime: {
      onMessage: { addListener() {} },
      sendMessage: async message => {
        sent.push(message);
        if (message.command === "state") return { ok: true, state };
        if (message.command === "take-dial-intent") return { ok: true, intent: { id: "selection", number: "+13065550100" } };
        return { ok: true, state };
      }
    } };
    const context = vm.createContext({
      chrome, document: { getElementById: element, querySelectorAll: () => [] },
      navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => stopped++ }] }) } },
      console
    });
    vm.runInContext(dialSource, context);
    vm.runInContext(fs.readFileSync(path.join(root, "phone.js"), "utf8"), context);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(element("destination").value, "+13065550100");
    assert.equal(sent.filter(message => message.command === "call").length, registered ? 1 : 0);
    if (registered) {
      assert.equal(sent.find(message => message.command === "call").number, "+13065550100");
      assert.equal(stopped, 1);
    } else {
      element("sip-host").value = "phone.tonywalker.ca";
      element("sip-extension").value = "209";
      element("sip-display-name").value = "Tony";
      element("sip-secret").value = "test-secret";
      element("credentials").listeners.submit({ preventDefault() {} });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(sent.at(-1).command, "connect");
      assert.equal(sent.at(-1).settings.host, "phone.tonywalker.ca");
      assert.equal(sent.at(-1).settings.extension, "209");
      assert.equal(sent.at(-1).settings.displayName, "Tony");
      assert.equal(element("extension-badge").textContent, "Tony - 209");
      assert.equal(stopped, 1);
    }
  }
});

test("Enter, field icon, and expanded keypad button dial the same number", async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: id === "destination" ? "205" : "", textContent: "", dataset: {}, listeners: {},
      addEventListener(type, fn) { this.listeners[type] = fn; }, setAttribute() {}, classList: { toggle() {} }
    });
    return elements.get(id);
  };
  const sent = [];
  let onMessage;
  let savedControls;
  let dropAutoAnswerReply = false;
  let mainHeight = 430;
  const heights = [];
  const popupWindow = { outerHeight: 520, innerHeight: 480 };
  const keypadPanel = { listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } };
  const state = { status: "Registered as 209", connected: true, registered: true,
    activeCall: false, incoming: false, answered: false, busy: false, ringEnabled: true };
  const chrome = { storage: { session: {
    get: async () => ({ uiControls: savedControls }),
    set: async item => { savedControls = item.uiControls; }
  } }, windows: {
    getCurrent: async () => ({ id: 1 }),
    update: async (id, options) => {
      heights.push(options.height);
      popupWindow.outerHeight = options.height;
      popupWindow.innerHeight = options.height - 40;
    }
  }, runtime: {
    onMessage: { addListener(fn) { onMessage = fn; } },
    sendMessage: async message => {
      sent.push(message);
      if (message.command === "take-dial-intent") return { ok: true, intent: null };
      if (message.command === "autoanswer" && dropAutoAnswerReply) return undefined;
      if (message.command === "ring") state.ringEnabled = !state.ringEnabled;
      return { ok: true, state };
    }
  } };
  const context = vm.createContext({
    chrome, document: {
      getElementById: element,
      querySelectorAll: selector => selector === "details" ? [keypadPanel] : [],
      querySelector: () => ({ get scrollHeight() { return mainHeight; } })
    },
    window: popupWindow, screen: { availHeight: 900 }, requestAnimationFrame: fn => queueMicrotask(fn),
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } }, console
  });
  vm.runInContext(dialSource, context);
  vm.runInContext(fs.readFileSync(path.join(root, "phone.js"), "utf8"), context);
  await new Promise(resolve => setImmediate(resolve));
  let prevented = false;
  element("destination").listeners.keydown({ key: "Enter", preventDefault: () => { prevented = true; } });
  await new Promise(resolve => setImmediate(resolve));
  element("call").listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  element("keypad-call").listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prevented, true);
  assert.deepEqual(sent.filter(message => message.command === "call").map(message => message.number), ["205", "205", "205"]);

  state.activeCall = true; state.answered = true;
  onMessage({ target: "phone-state", state });
  assert.equal(element("answer").hidden, true);
  assert.equal(element("mute").hidden, false);
  element("mute").listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(sent.some(message => message.command === "mute"));
  assert.equal(element("keypad-call").textContent, "Hang up");
  element("transfer-target").value = "*206";
  element("transfer-target").listeners.input();
  element("transfer").listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  element("park").listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.find(message => message.command === "transfer").number, "*206");
  assert.ok(sent.some(message => message.command === "park"));
  element("destination").listeners.keydown({ key: "Enter", preventDefault() {} });
  element("call").listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  element("keypad-call").listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.filter(message => message.command === "hangup").length, 2);

  state.incoming = true; state.answered = false; state.peer = "Alice (205)";
  onMessage({ target: "phone-state", state });
  assert.equal(element("answer").hidden, false);
  assert.equal(element("mute").hidden, true);
  assert.equal(element("caller").textContent, "From Alice (205)");
  element("ring").listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(element("ring").title, "Ringer off");
  state.activeCall = false; state.incoming = false;
  onMessage({ target: "phone-state", state });
  element("dnd").listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  dropAutoAnswerReply = true;
  element("auto-answer").listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(element("status").textContent, /Phone worker did not reply.*Reload PV Phone/);
  dropAutoAnswerReply = false;
  element("auto-answer").listeners.click();
  element("mode-in").listeners.click();
  element("ready").listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(savedControls)), { direction: "in", ready: true });
  assert.ok(sent.some(message => message.command === "dnd"));
  assert.ok(sent.some(message => message.command === "autoanswer"));
  assert.equal(element("ready").textContent, "Pause");
  vm.runInContext('controlsTouched = false; controls = { direction: "out", ready: false };', context);
  await vm.runInContext("loadControls()", context);
  assert.equal(element("ready").textContent, "Pause");
  element("credentials").listeners.submit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.at(-1).command, "disconnect");
  assert.equal(element("session").textContent, "Disconnect");
  mainHeight = 680;
  keypadPanel.listeners.toggle();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(heights.some(height => height >= 720), "expanded keypad grows the popup");
  mainHeight = 430;
  keypadPanel.listeners.toggle();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(heights.at(-1) < 520, "collapsed keypad shrinks the popup");
});

test("PBX settings make the WebSocket, AOR, auth username, and dial URI dynamic", async () => {
  const source = fs.readFileSync(path.join(root, "offscreen.js"), "utf8").replace(/^import .*;\s*/, "");
  let phoneOptions, socketUrl, dialUri;
  const referrals = [], rejects = [], audioEvents = [];
  let autoAnswerDelay, finishAutoAnswerWait;
  let nextReferCode = 200, hangups = 0;
  let localDnd = false, autoAnswer = false;
  class InvitationMock {
    reject(options) {
      rejects.push(options.statusCode);
      phoneOptions.delegate.onCallHangup();
      return Promise.resolve();
    }
  }
  class SimpleUser {
    constructor(url, options) {
      socketUrl = url; phoneOptions = options;
      this.session = {};
      this.sessionManager = { transfer: async (session, uri, options) => {
        referrals.push(uri);
        options.requestDelegate.onAccept();
        options.onNotify({ accept: async () => {}, request: { body: `SIP/2.0 ${nextReferCode} Result` } });
      } };
    }
    async connect() {}
    async register() { phoneOptions.delegate.onRegistered(); }
    isMuted() { return this._muted === true; }
    mute() { this._muted = true; }
    unmute() { this._muted = false; }
    async hangup() { hangups++; phoneOptions.delegate.onCallHangup(); }
    async answer() { audioEvents.push("answer"); phoneOptions.delegate.onCallAnswered(); }
    async call(uri) {
      dialUri = uri;
    }
  }
  const chrome = { runtime: { sendMessage: async () => {}, onMessage: { addListener() {} } },
    storage: { local: {
      get: async () => ({ localDnd, autoAnswer }),
      set: async item => {
        if ("localDnd" in item) localDnd = item.localDnd;
        if ("autoAnswer" in item) autoAnswer = item.autoAnswer;
      }
    } } };
  const context = vm.createContext({
    Web: { SimpleUser }, Invitation: InvitationMock, chrome,
    document: { getElementById: () => ({ addEventListener() {} }) },
    AudioContext: class {
      state = "running"; currentTime = 0; destination = {};
      resume() { return Promise.resolve(); }
      createGain() { return { gain: { value: 0 }, connect() {} }; }
      createOscillator() { return { frequency: { value: 0 }, connect: gain => gain,
        start() { audioEvents.push("beep"); }, stop() {} }; }
    }, console, setTimeout: (callback, delay) => {
      autoAnswerDelay = delay;
      finishAutoAnswerWait = callback;
    }
  });
  vm.runInContext(source, context);
  let result = await vm.runInContext('run("connect", "private", undefined, { host: "pbx.example.com:9443", extension: "321", displayName: "Tony" })', context);
  assert.equal(result.ok, true);
  assert.equal(socketUrl, "wss://pbx.example.com:9443/ws");
  assert.equal(phoneOptions.aor, "sip:321@pbx.example.com");
  assert.equal(phoneOptions.userAgentOptions.authorizationUsername, "321");
  assert.equal(phoneOptions.userAgentOptions.displayName, "Tony");
  assert.equal(phoneOptions.userAgentOptions.authorizationPassword, "private");
  result = await vm.runInContext('run("call", undefined, "205")', context);
  assert.equal(result.ok, true);
  assert.equal(dialUri, "sip:205@pbx.example.com");
  vm.runInContext("answered = activeCall = true", context);
  await vm.runInContext('run("mute")', context);
  assert.equal(vm.runInContext("micMuted", context), true);
  await vm.runInContext('run("park")', context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(vm.runInContext("activeCall", context), false, "successful park releases the call");
  assert.equal(vm.runInContext("micMuted", context), false, "mute resets at call end");
  await vm.runInContext('run("call", undefined, "71")', context);
  vm.runInContext("phone._muted = false", context);
  phoneOptions.delegate.onCallCreated();
  phoneOptions.delegate.onCallAnswered();
  assert.equal(vm.runInContext("phone.isMuted()", context), true, "mute preference applies to retrieved call");
  await vm.runInContext('run("transfer", undefined, "*206")', context);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(referrals, ["sip:70@pbx.example.com", "sip:*206@pbx.example.com"]);
  assert.equal(vm.runInContext("activeCall", context), false, "successful transfer releases the call");
  await vm.runInContext('run("call", undefined, "205")', context);
  vm.runInContext("phone._muted = false", context);
  phoneOptions.delegate.onCallCreated();
  phoneOptions.delegate.onCallAnswered();
  assert.equal(vm.runInContext("phone.isMuted()", context), false, "unrelated next call starts unmuted");
  nextReferCode = 486;
  const failedTransfer = await vm.runInContext('run("transfer", undefined, "207")', context);
  assert.match(failedTransfer.state.status, /failed.*486/);
  assert.equal(hangups, 2, "failed transfer must keep the caller connected");
  vm.runInContext("answered = activeCall = false", context);
  const dndOn = await vm.runInContext('run("dnd")', context);
  assert.equal(dndOn.state.dndEnabled, true);
  vm.runInContext("phone.session = new Invitation()", context);
  phoneOptions.delegate.onCallCreated();
  phoneOptions.delegate.onCallReceived();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(rejects, [486]);
  assert.equal(vm.runInContext("activeCall", context), false);
  const dndOff = await vm.runInContext('run("dnd")', context);
  assert.equal(dndOff.state.dndEnabled, false);
  const autoOn = await vm.runInContext('run("autoanswer")', context);
  assert.equal(autoOn.state.autoAnswerEnabled, true);
  vm.runInContext("phone.session = new Invitation()", context);
  vm.runInContext('phone.session.remoteIdentity = { displayName: "Alice", uri: { user: "205" } }', context);
  phoneOptions.delegate.onCallCreated();
  phoneOptions.delegate.onCallReceived();
  assert.equal(vm.runInContext("peer", context), "Alice (205)");
  assert.match(vm.runInContext("status", context), /Incoming from Alice \(205\)/);
  assert.equal(autoAnswerDelay, 5000);
  assert.equal(audioEvents.at(-1), "beep");
  finishAutoAnswerWait();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(audioEvents.slice(-2), ["beep", "answer"]);
  assert.equal(vm.runInContext("callerIdentity({ remoteIdentity: { uri: { user: '206' } } })", context), "206");
  assert.equal(vm.runInContext("callerIdentity({})", context), "unknown caller");
  assert.equal(JSON.stringify(result.state).includes("private"), false);
  assert.throws(() => vm.runInContext('parseSettings({ host: "https://evil.example/path", extension: "321", displayName: "Tony" })', context), /valid PBX Host/);
});
