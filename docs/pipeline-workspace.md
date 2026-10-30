# Contact capture, Who is Sarah, and Rocket.Chat

Implemented on `feature/contact-clipboard-chat-search`, manifest version 0.10.1. Based on this repository's 0.9.8 source; compare with any unpublished installed build before replacing it. This branch does not activate a gateway, deploy Data Docker or change Rocket.Chat settings.

## Features

- **SuiteCRM click-to-call:** a normal click on a `tel:` phone link on `https://crm.pipelineventure.com` hands the number to PV Phone. A registered idle phone dials; otherwise the number is staged without interrupting an active call. Modified clicks retain browser behavior. Delegation covers dynamically rendered SPA record/list views. Synthetic page clicks cannot trigger a call. This local handoff requires no Data Docker/n8n session.
- **Phone:** existing offscreen WebRTC engine and right-click selection dialing remain intact. Incoming calls and pending right-click dial actions bring the phone pane forward.
- **People / Who is Sarah?:** search by name, email, phone or UUID. One read-only gateway queries the existing SuiteCRM/Ninja identity adapters. Results remain separate candidates and retain source and contact/account email distinctions. Individual backend failures produce partial/unavailable status, not a misleading empty successful search.
- **Pipeline Clipboard:** right-click a supported SuiteCRM/Ninja record link or page to collect authoritative data by URL. Contact capture does not scrape the DOM or fetch arbitrary pages. A separate SuiteCRM-only content script handles telephone-link clicks. SuiteCRM SPA fragments are preserved. Client-specific URL parsing lives in Data Docker, not the extension.
- **Explicit copy:** stage up to 25 recent records in trusted extension session storage; copy a selected record as JSON, person vCard or text. Nothing automatically overwrites the desktop clipboard. Account/client records offer JSON/text; select a contact for vCard. vCard output preserves contact scope and folds UTF-8 lines.
- **Chat:** embeds `https://chat.pipelineventure.com/?layout=embedded` when opened. Open Chat and Reload controls are always available. No Rocket.Chat credentials are stored or injected, and no framing restrictions are stripped. Third-party cookies, login policy or the server's CSP/X-Frame-Options may prevent the embed; use the tab fallback.

## Connect the read-only gateway

The companion backend lives in `horsedog11/pipeline-data`, branch `feature/extension-identity-bridge`, based on the identity-write feature branch. It adds:

- `POST /identity/extension/search` with `{ "query": "Sarah" }`.
- `POST /identity/extension/capture` with `{ "url": "https://crm.pipelineventure.com/#/contacts/record/CONTACT_UUID" }`.
- An inactive `workflows/extension-identity-gateway.json` import with public path `/webhook/pv-extension`. The filter admits search/capture only and forwards the user's read-only token to fixed internal endpoints. It never substitutes a writer/service token.

Default gateway: `https://n8n.pipelineventure.com/webhook/pv-extension`. Settings pin that exact origin/path; adding other origins requires a reviewed code/manifest change. The host permission is requested only when the user connects Pipeline. Do not place credentials in the repository or in Chrome sync/local storage.

Data Docker authenticates the user token using the existing `IDENTITY_PRINCIPALS_FILE`. The principal requires `extension_read`, allowed systems, server-owned actor and an integer Unix `expires_at` in the future. The extension stores the entered token in **session storage only**, clears it on Disconnect, and limits the local session to one hour. Disconnect clears staged contacts and invalidates in-flight lookup results. Do not give this token identity-write, invitation or vanity-creation roles.

Automated Authentik/OIDC sign-in and token issuance are not implemented. The token field is the integration point for a provisioned short-lived scoped user credential, not a request to distribute a permanent shared n8n/API secret. The SIP password flow is unchanged.

## URL and ID behavior

Supported record routes:

- SuiteCRM: `#/contacts/record/<uuid>`, `#/leads/record/<uuid>`, `#/accounts/record/<uuid>` (matching path routes also accepted).
- Ninja: `/clients/<native API ID>` and `/clients/<native API ID>/edit`; matching hash routes also accepted.

SuiteCRM contact/lead capture uses its existing SQL read adapter with exact UUID/module checks. Account capture uses the supported SuiteCRM API. Ninja capture reads a client via its API and stages the client and contacts with native API IDs. A Ninja SQL search result remains explicitly `id_kind: sql`, with no manufactured browser URL; it can still be inspected/staged/copied. Do not use SQL integer IDs as hashed API IDs for later writes.

Only approved HTTPS hostnames can be submitted; service-side parsing selects a fixed source adapter. The browser-supplied URL is never fetched directly. Changed domains require server, gateway and extension allowlist review. osTicket and general webpages are not implemented.

## Deployment still needed

1. Deploy/review the companion Data Docker read routes and existing source credentials. They require no CRM write gates and do not create/update records.
2. Provision short-lived per-user read principals; import and activate the gateway after validating its private Data Docker URL. Preserve browser Authorization on the fixed private HTTP node; do not attach Marcus's write credential.
3. Apply public route size/rate limits and disable sensitive execution capture. The export disables saved success/error/manual execution data. No live n8n setting was changed here.
4. Build with `npm ci && npm run build`, then load the unpacked extension in a test Chrome profile. Connect the read-only Pipeline session and grant the n8n host permission.
5. Test actual SuiteCRM/Ninja pages, user access scope, search, explicit clipboard formats and phone regression. Verify Rocket.Chat framing and authentication using the user's normal session. No live browser profile, SIP server, gateway or chat server was available during implementation.

## Validation

`npm test` covers existing dialing/phone behavior plus URL allowlisting, vCard scope/folding, worker auth/session/capture boundaries and DOM UI behavior (including hostile contact names, explicit staging, Chat fallback and incoming-call navigation). `npm run check` validates script syntax; `npm run build` regenerates the SIP bundle. The companion backend has Python tests and a Node gateway-filter test.

The SuiteCRM content-script match adds site access for that exact HTTPS hostname. Reload already-open SuiteCRM tabs after installing the update. Test actual SuiteCRM phone links in Chrome before replacing the installed build; no live calls were made during development. Plain non-link text is still available through right-click dialing.
