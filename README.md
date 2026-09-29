# PV Phone · Chrome WebRTC beta

PV Phone is an unpacked Chrome extension for a FreePBX PJSIP WebRTC extension. Version **0.9.8 beta** has been tested with extension 209 on Linux Mint: registration survives closing the control window, incoming and outgoing calls have two-way audio, and Auto Answer works. Configure your own PBX identity and SIP password in Settings.

The bundled [WebRTC help](help.html) records the working 209 media settings and symptom-based troubleshooting steps. The [source icons](icons/README.md) are included for a future KYC panel.

This Manifest V3 extension registers a configured FreePBX WebRTC extension using SIP.js. Its control window may close while the phone remains registered: an offscreen document owns the SIP WebSocket, microphone, remote audio, and current call. An incoming call reopens the control window. **Disconnect** unregisters and destroys the offscreen phone.

Host, Extension, and Display Name are saved in Chrome local extension storage. The SIP password is sent to the offscreen document at registration and remains only in process memory. It is not saved in browser storage or committed to Git. Closing Chrome or reloading the extension ends registration and requires the password again. Do not run another phone registered to the same extension during the test.

## Load on Linux Mint

Download and extract this repository, then open `chrome://extensions`. Enable Developer mode and choose **Load unpacked**, selecting the extracted directory containing `manifest.json`. If an earlier version is loaded from that directory, replace its files and press **Reload** on its extension card. Reloading ends any active call; do that between calls.

The committed `offscreen.bundle.js` runs without an npm installation. To rebuild from source, use Node 18 or later:

```sh
npm ci
npm run build
npm run check
```

Click the toolbar icon. Under **Settings**, enter **Host** (for example `phone.tonywalker.ca`), **Extension** (for example `209`), **Display Name** (for example `Tony`), and its SIP **Password**, then press **Register**. Extension and Display Name share a row, and the header shows `Tony - 209`. Host, Extension, and Display Name are saved locally; Password is not. Enter a hostname without `https://`; the secure WebSocket address is `wss://<host>:8089/ws`. You can enter `host:port` for a different WebSocket port. The SIP identity and outbound call URI use the host name without the port. Chrome will ask to use the microphone in the visible phone window; choose **Allow**. Confirm the status shows your extension registered. The **Search / dial a number** field starts empty. Enter an extension or telephone number and press **Enter** or use the call icon on the field's right. The search icon on the left marks the number field. FreePBX determines which external numbers its dialplan permits. The field accepts numbers and FreePBX feature codes `*78`/`*79` for manual testing; name and email lookup needs the planned KYC/SuiteCRM service. Open the collapsed **Keypad** to enter digits or use its larger Call button. The keypad and its Call button fold away together. During a connected call, the keypad sends DTMF tones. The phone checks microphone access when you press Call or Answer, in case permission was changed after registration.

The call icon and the full keypad button turn red and become **Hang up** while a call is active, including an unanswered incoming call. **Answer** appears only for an incoming call; the microphone icon appears right of the bell only after the call connects and toggles mute (red means muted). Mute resets when the call ends. If a muted call was successfully parked, the first subsequent dial to a default parking slot `71`–`78` resumes muted; any other new call starts unmuted. This requires the default parking slot range and cannot identify a parked caller without a PBX-side slot feed. The green bell rings on incoming calls; press it to turn ringing off (red bell), while incoming calls still bring the window forward. This preference lasts while the offscreen phone remains connected. The phone window sizes itself to its content as sections open and close, limited by the available screen height.

Incoming calls display the caller name and number supplied in the SIP INVITE From identity, both in status and beside the Answer button. If the PBX provides neither, the phone shows **unknown caller**. This is SIP caller ID; it is not yet a KYC name lookup.

The **AA** button enables Auto Answer while registered. White means on; dark means off. For an incoming call, the phone opens its window, plays a short distinct notification beep, waits five seconds from the start of the beep, then answers. The beep occurs even when the normal ringer is off; if Chrome cannot play the beep, the phone leaves the call unanswered and rings for manual pickup. DND takes priority and rejects the call as busy. Auto Answer is saved locally and restored on registration. It cannot answer while Chrome is closed or the phone is disconnected. Closing and reopening the phone window does not require reloading the extension. After replacing extension files, reload the unpacked extension in Chrome and register again; reloading ends the current SIP session.

Settings use one button: **Register** while disconnected, **Disconnect** while connected. Host, Extension, and Display Name are locked while connected; disconnect before changing them. **Authorize** is displayed but disabled while integration with `auth.pipelineventure.com` is pending; a future successful authorization will change that button to **Logout**. It does not sign in today. The DND button sits left of the bell. It now controls this extension locally: red means incoming SIP invitations to the registered browser phone receive `486 Busy Here`, and white means they ring. The preference is saved in Chrome local storage and applied when the phone registers again. It does not change FreePBX's own DND database or determine what FreePBX does with a busy response (voicemail, forwarding, or caller busy tone). If a prior version enabled PBX DND with `*78`, dial `*79` once from the dial box to clear that separate PBX setting. While Chrome is closed or the phone is disconnected, this client cannot send a busy response. The **In / Out** selector and **Ready / Pause** button below the status are UI previews only, saved for the current Chrome session; they do not yet change queue routing or dialer readiness. The bell separately controls audible ringing.

**Transfer** and **Park** sit above the digits inside the expandable Keypad. Once a call is answered, enter a target in **Transfer to** and press Transfer for a blind SIP REFER. The transfer target may start with `*` for a FreePBX feature code, such as a direct-to-voicemail destination configured on your PBX. Park sends a blind transfer to the FreePBX parking entry `70` (its usual default). The phone waits for a successful final REFER NOTIFY before hanging up its original call leg. If the PBX rejects the transfer, the caller remains connected; if no final result arrives, the phone leaves the call up for manual handling. Entry `70` is not the retrieval slot: find the actual slot on the PBX (typically `71`–`78`) and dial that slot to reconnect to the parked caller. This extension does not yet report the assigned slot. Check that your PBX has Parking enabled and that its parking entry is `70` before live testing.

To display the assigned parking slot automatically, a trusted PBX-side service should listen for Asterisk AMI `ParkedCall` events and pass the `ParkingSpace` value to this phone. AMI `ParkedCalls` can list calls currently parked, which also covers a phone window reopened after the event. The browser must not receive AMI credentials. The SIP REFER result alone does not include the assigned slot.

To call a number shown on a web page, select the number's text, right-click it, and choose **Call … with PV Phone**. The extension focuses its phone window, enters the selected number, and calls when the configured extension is registered and idle. If disconnected or already in a call, it leaves the selected number ready in the dial field. Selected text must contain a plain number with optional `+`, spaces, parentheses, periods, or hyphens, and 2–15 digits after cleanup. This version does not rewrite web pages or auto-highlight every number; the highlighted text is the normal browser selection.

If the status says **Microphone permission dismissed or blocked**, keep the phone window open and retry Register, Call, or Answer, then choose Allow in Chrome's prompt. In `chrome://settings/content/microphone`, confirm the microphone is enabled and select the intended input device. The PJSIP registration may already be reachable even when Chrome has denied microphone access; that does not establish a usable audio call.

For persistence, close the phone window without pressing Disconnect, wait, and reopen it from the toolbar. It should still show the configured extension as registered without requesting the password. Call it from another extension while the window is closed; it should reopen and present **Answer**. Check ringing and two-way audio. Finally press **Disconnect** and confirm the next open asks for the password.

For Host `phone.tonywalker.ca` and Extension `209`, the SIP endpoint is `wss://phone.tonywalker.ca:8089/ws`, with AOR `sip:209@phone.tonywalker.ca`. A new FreePBX endpoint must have the WebRTC media settings (DTLS-SRTP, AVPF, ICE, RTCP mux) and its configured DTLS certificate. Open the bundled **WebRTC help** page from Settings for our working 209 values and troubleshooting commands.

## Architecture and limits

- `background.js` opens the control window and creates the offscreen document on Register.
- `offscreen.js` owns SIP.js and call state; `offscreen.bundle.js` is the generated file Chrome executes.
- `phone.js` displays state and sends commands. Closing its window never calls SIP.js disconnect.
- `dial.js` validates selected text and numbers before they reach SIP.js. The right-click menu works on selected text; the extension has no access to page content beyond Chrome's selection text for that click.
- Incoming calls open or focus the control window. Chrome must be running; this is not an OS background phone.
- Microphone permission is requested in the visible control window before registration and before Call/Answer; the hidden SIP session uses the same extension origin. The 209 setup passed live two-way audio tests on Linux Mint. If Chrome blocks audio playback, the status reports that condition. The SIP caller ID display added in 0.9.7 still needs a live check.

This beta is a standalone phone. Authorize/Logout, Ready/Pause, queue control, KYC lookups, Connect, and page overlays are later work. The In/Out and Ready controls are visual previews and do not affect the PBX.

The runtime bundle contains SIP.js 0.21.2. See [third-party notices](THIRD_PARTY_NOTICES.md). This repository does not include the FreePBX SIP password or private keys.

## Future feature: Search selected text

Add **Search selection with PV Phone** to the browser's right-click menu alongside **Call … with PV Phone**. Highlight a name, email address, or phone number on a page, then choose Search. The extension should bring the phone window forward, put the selected text in the search field, and request a KYC lookup without placing a call. Show the available results in the phone/Connect experience according to authorization: caller-ID name only without authorization, richer short/full KYC when authorized. The existing right-click Call action continues to dial numbers. This search action is recorded here for the KYC integration; it is not present in this build.

Three bundled source icons for future two-line KYC results live in `icons/`. Open `icons/preview.html` to review them at twice the bell glyph's displayed size. They are original source-identification glyphs, not official product logos; no KYC data is shown in the phone yet.
