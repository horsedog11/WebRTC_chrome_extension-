# Identity, working profile and shared presence

Recorded: 2026-10-02.

Status: planned integration behavior for PV Phone and its Reception/manager views.

## Authentik session

PV Phone's future Authorize action authenticates the user through Authentik. Authentik establishes identity and durable organizational capabilities; it is not queried on every click.

The extension/backend should obtain a short-lived authenticated session/token and load the user's application profile separately. Backend APIs must enforce authorization even when the UI hides unavailable controls.

Logout through PV Phone clears local session/profile state and marks the dialer unavailable. If the Authentik session ends elsewhere, the client discovers that through normal token/session renewal rather than assuming Authentik pushes a realtime event. A short access-token lifetime bounds stale identity claims.

## Working profile

The resolved Tom profile includes:

- authorized Missions;
- Mission-specific roles such as outbound, appointment and closer;
- present Missions selected for the current workspace;
- one default Mission.

The default is used only when an operation has no explicit Mission context. A pushed `call.json.mission_uuid` always wins.

Mission-role assignments are controlled by the Mission service/manager, not self-granted in the extension. Profile changes should be invalidated/pushed through the application event/Redis layer and refreshed by the extension without requiring a new Authentik login.

## Presence inputs

The extension contributes dialer state such as online, Ready, Pause, inbound/outbound mode and active call/work context. A shared backend Presence/Activity service can combine this with:

- Asterisk phone state;
- Rocket.Chat presence/manual status;
- calendar/out-of-office state and return time.

Keep phone state separate from overall human presence. For example, Tom can be online and on a call.

The extension should heartbeat while active so Dispatch can distinguish a valid Authentik session from an actually available workstation.

## Reception view

Reception asks: **Can I give this caller to Tom right now, and if not, why?**

The panel can show normalized availability plus useful underlying detail such as:

- available;
- ringing/on a call;
- away;
- DND;
- out of office and expected return;
- routing alternatives such as another person or voicemail.

Explicit OOO/manual DND should carry more weight than weak signals such as Rocket.Chat idle/away. The backend remains authoritative for permitted transfer/routing actions.

## Manager view

The same presence model can expose a richer manager projection:

- Ready/Paused;
- inbound/outbound mode;
- active/idle;
- current Mission and role where permitted;
- waiting for Dispatch;
- manager Dispatch block.

A manager may pause new Dispatch work for Tom. This is not Tom's own Pause button: the backend creates a Dispatch block, and Resume removes it. Tom can remain Ready while manager-blocked, and pressing Ready must not override the block.

The manager UI must require management authority and should show who set the block and its reason/time when available.

## Separation

- Authentik: identity and durable capability.
- Mission/Profile: Mission membership, Mission roles, present/default Missions.
- Asterisk: authoritative live phone state.
- Presence/Activity service: normalized current human/work state.
- Dispatch: work-to-human matching and manager block enforcement.
- PV Phone: authenticated user interface and one producer/consumer of these states.

