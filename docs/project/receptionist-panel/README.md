# Receptionist Panel — PV Phone Chrome extension add-on

Recorded: 2026-10-01. Captures the receptionist/reception workspace discussion of 2026-09-29.

Status: agreed product ideas with proposed implementation details. This is a Chrome extension sub-project, not a claim of a deployed panel or live status integration.

## Purpose and ownership

Give Tom a visual workspace of people and destinations for dialing and choosing transfer destinations. Access to the Reception add-on is granted through configured Authentik groups. Each eligible user owns their workspace and can arrange it for their work. Group membership controls access to the add-on; it does not turn individual workspaces into a shared group board.

This belongs in PV Phone alongside its existing call controls. Reuse the phone's call lifecycle rather than building a second phone. This add-on is separate from [Customer Actions](../customer-actions/README.md), which creates customer objects or fills forms using KYC and source records.

## Authentik group access

Decision updated 2026-10-01: Reception is available to members of groups defined through Authentik, rather than universally to all extension users. Configure which Authentik group or groups grant this capability; no group names have been selected yet.

The extension should expose the panel only when the authenticated user has the Reception capability. The backend must also enforce group-derived access for workspace, avatar and status operations; hiding the panel alone is insufficient. Per-user ownership remains required within the eligible groups. Lock/unlock only controls editing and cannot grant access.

Implementation must handle logout and loss of group access by disabling the panel and denying further protected operations. Exact claim mapping, permission refresh/revocation timing and retention of saved workspaces remain implementation choices. Existing PBX permissions still govern dialing and transfers.

## Agreed panel ideas

Each pane/tile contains:

| Item | Purpose |
| --- | --- |
| Avatar | Visual identification of a person or group; provide storage for assigned images |
| Name/text and extension | Recognizable label and primary destination information |
| Primary dial target | The tile's main destination |
| Secondary dial target | A separate configurable alternate destination |
| Secondary description | Mouse-over explanation of what the alternate action reaches |
| Status reference | Identifies the monitored PBX resource independently of the dial destinations |
| Display order | The user's chosen tile arrangement |

Destinations may include a person's extension, Tom's cell, individual voicemail, group voicemail, a conference, ring group, queue, or group assistant. The secondary target is not restricted to voicemail. A tile can represent a group or service as well as a person.

Use background status colors: green for available, red for busy, grey for unavailable, with readable status text. A previous preview used blue for unavailable; the later stated preference is grey. Do not rely on color alone.

The earlier visual concept separated the person/primary side from a secondary side initially shown as voicemail. Preserve two distinct selection areas while allowing the secondary destination and its description to be configured.

## Lock and unlock

The reception page needs an explicit lock/unlock control to prevent accidental workspace changes.

- Locked: ordinary dialing and destination selection remain usable; adding, editing, removing and reordering tiles are disabled.
- Unlocked: the owner can add, edit, remove and reorder individual tiles, including avatars, text, targets and descriptions.
- Any user granted Reception access through Authentik groups can manage their own workspace; editing their workspace does not require an administrator role.

The lock is an editing safeguard, not an authentication or authorization boundary. Defaulting to locked when reopening the panel is a proposed implementation behavior.

## Proposed storage model

The earlier design response proposed per-user persistence keyed by Authentik identity rather than a single shared board. This supports the user's explicit decision that it is their workspace; the exact backend, schema and sync strategy still need implementation decisions.

Persist workspace configuration separately from live call/status data:

- Workspace owner identity, schema version and ordered tile IDs.
- Stable tile ID, name/description and avatar reference.
- Primary and secondary target values/types, labels and secondary hover description.
- Status resource reference.

Store avatar assets durably and reference them from tiles. The avatar store, image limits, cache behavior and cleanup policy remain open; no specific storage service was selected in this discussion.

Do not persist busy/available as authoritative workspace configuration. Obtain current status from the PBX integration using each tile's status reference; keep timestamps and connection freshness separate. Proposed behavior: a missing or stale feed displays unknown/stale, never a guessed available state. A status reference may differ from both dial targets, and external cell numbers or group destinations may have no reliable monitored status.

## Interaction with calling and transfers

The panel provides primary/secondary destination selection for the existing phone controls. The earlier preview was explicitly a transfer-destination selector. The final choice between immediate dialing while idle and selecting a destination for a separate Call action remains open.

During a call, choosing a tile must have an explicit, understandable transfer behavior. Do not assume selecting a destination immediately transfers or ends the current call. Reuse the phone's verified transfer result handling when transfer is invoked; define blind versus attended transfer scope before implementation.

Keep labels clear so Tom can distinguish extension, cell, voicemail, group voicemail, conference, ring group, queue and assistant destinations. Provide the secondary description on keyboard focus as well as hover.

## Current implementation boundary

The repository README inspected on 2026-10-01 describes existing dialing, blind transfer and parking controls. Authentik authorization is pending; a receptionist panel and live multi-resource PBX status feed are not established by those existing controls. This document records the add-on concept only.

A trusted backend/status service should provide permitted PBX status to the extension. Keep AMI/ARI credentials out of the browser. Workspace ownership does not grant PBX dialing or transfer privileges; the existing server/PBX rules remain authoritative.

## First implementation slice

1. Define the Authentik group-to-Reception capability mapping and enforcement, plus workspace configuration and avatar persistence with per-user ownership.
2. Build the tile layout with primary/secondary selection areas, names, avatars and secondary descriptions.
3. Add lock/unlock and persistent add/edit/remove/reorder behavior.
4. Connect destination selection to existing dial and transfer controls with explicit action semantics.
5. Add a live PBX status adapter with status references, freshness handling and supported resource types.

## Acceptance criteria

- Membership in a configured Authentik group grants Reception access; users without that capability cannot access protected Reception operations.
- Logout or loss of group access disables Reception according to the defined permission-refresh policy; the backend rejects unauthorized requests.
- Two eligible users can keep different boards; one user's layout edits do not alter another's workspace.
- Tiles, order, descriptions, target fields and avatar references survive reopening.
- Locked mode prevents configuration changes while leaving ordinary actions usable.
- Primary and secondary actions remain distinct; the secondary is not hardcoded to voicemail.
- The supported destination types can be represented without confusing them with status resources.
- A status update changes the correct tile without overwriting its configuration.
- Missing/stale status is visible, and color is supplemented with text.
- Selecting a transfer destination does not unexpectedly drop the current call.

## Open implementation choices

- Authentik group names/mapping, claims, permission refresh/revocation timing and workspace retention after access removal.
- Panel placement, sizing and how it opens alongside PV Phone.
- Idle dialing versus destination-selection behavior; explicit transfer action and any attended-transfer scope.
- Authenticated workspace backend, local caching/sync behavior and avatar storage.
- Which PBX resource states are available for extensions, queues and groups, and their display mapping.
- Exact status transport and refresh/reconnect behavior.

## Related

- [PV Phone Chrome extension](../../../README.md)
- [Customer Actions add-on](../customer-actions/README.md)
