# Customer Actions — PV Phone Chrome extension add-on

Recorded: 2026-10-01

Status: agreed product direction; proposed implementation. This document does not claim that the add-on or integrations are deployed.

## Purpose

Let Tom use the dialer's current caller, a selected KYC search result, or a specific record in a supported application to start a customer task without retyping known information. The first target is creating an osTicket support ticket using Sarah's known identity and, when selected, her Invoice Ninja invoice.

This is a sub-project of the PV Phone Chrome extension in `horsedog11/WebRTC_chrome_extension-`. Keep the interaction in the extension and shared integration logic in a backend, with small adapters for supported apps. Avoid rebuilding the same workflow in every app.

## Why this belongs in the Chrome extension

PV Phone already provides Tom's browser phone and a right-click action for selected telephone numbers. The planned KYC/search interface will provide selected-customer context. Extending that same surface lets Tom initiate tasks across Ninja, SuiteCRM and osTicket without duplicating the interaction in each app.

Current repository README, inspected 2026-10-01: the existing right-click action receives selected text only; broader page access is not implemented. Authorize is disabled pending authentication integration, and KYC/search are future work. This add-on therefore requires those capabilities and explicit site permissions/adapters; it does not follow automatically from SIP registration or an open phone window.

## Agreed entry points

### Person context: use what KYC knows

Tom selects the current caller or a customer from search results, chooses New support ticket, reviews the supplied details, supplies missing required information, and submits. A supported MCP tool or API creates the object. No source application page is required for this path.

Future supported actions may include creating a CRM contact or another customer object. Reuse an existing linked customer record where present; creation must not silently duplicate Sarah.

### Record context: act on the exact item Tom clicks

Tom right-clicks Sarah's invoice in Invoice Ninja and selects New support ticket. The extension identifies the clicked invoice; the backend retrieves its authoritative details and prepares the ticket.

The ticket draft can include:

- Sarah's name, email and phone where available.
- Ninja customer ID and known SuiteCRM UUID.
- Invoice ID, invoice number and an authorized link back to it.
- Relevant invoice line items, quantities and transaction details.
- A suggested subject, for example Support — Invoice 1042 — Custom widget.

Tom adds the support problem, reviews and submits. Exact field inclusion is configurable and must be checked against the installed osTicket forms and interfaces.

### Source-specific KYC entries

Sarah's Ninja entry and Sarah's CRM entry in the KYC display are distinct sources. Each carries its system, record type and record ID. Right-clicking one selects that record's context and appropriate actions. Do not silently substitute the other record or merge conflicting field values.

### Fill an existing visible form

An additional action, Fill customer details, uses the current caller or selected search result to populate mapped fields on a supported visible form. Tom reviews and submits the form himself. Where fields already contain values, show current and proposed values and let Tom choose replacements.

## Source and destination are separate

| Context | Meaning |
| --- | --- |
| Selected person | Sarah's current caller profile or explicitly selected KYC search result |
| Selected source record | The particular CRM contact, Ninja customer, invoice or other supported record Tom clicked |
| Destination action | Create an osTicket ticket, fill a supported form, or another configured action |

Sarah's identity alone does not identify the invoice she needs help with. Preserve both person references and any explicitly selected transaction reference. Keep permanent customer links separate from ticket-specific invoice/order links.

## Proposed responsibilities

| Component | Responsibility |
| --- | --- |
| Browser extension | Recognize supported pages and clicked records; present relevant actions; retain explicit source context; show review and missing fields; display results |
| KYC service | Supply known customer details, source provenance and linked system IDs |
| Shared backend | Authenticate Tom, enforce access, retrieve current source records, validate and map fields, invoke MCP/API operations, and return created IDs/links |
| Application adapter | Translate source record identifiers and destination fields for the installed app/version |
| Destination app | Own the created ticket/contact/object and its lifecycle |

Use record IDs captured from supported pages to retrieve authoritative data rather than treating visible page text as the complete invoice. Restrict page recognition to configured sites. Browser site access and backend authorization are separate requirements; signing in does not automatically enable page observation. The extension panel need not be visible for an implemented, permitted content script to recognize relevant interactions.

The click establishes context; Tom's chosen action starts the workflow. General browsing/click history collection is not required. Actions that must occur without Tom's browser belong in server-side workflows.

## Identity and execution rules

- Preserve each system's native ID: SuiteCRM UUID, Ninja customer ID, osTicket user ID, and transaction IDs where applicable.
- Use the existing KYC/cross-reference mechanism; do not introduce a second independent identity authority. Its exact storage owner remains to be confirmed.
- Use explicit customer selection when matches are ambiguous. Missing references remain missing until resolved.
- Bind each draft to the selected person and record, so a new call or changed search selection cannot silently change an open draft.
- Keep credentials on the backend. Enforce Tom's permissions on source reads and destination writes.
- Review required fields before creation. A support request alone does not establish a paid purchase.
- Make retries safe against duplicate creation and return a clear success/failure state.
- On success, return the new object ID and link; update the relevant cross-reference when a new customer identity was created. A ticket ID belongs in activity/object references, not in place of Sarah's osTicket user ID.
- Record actor, source references and resulting object reference for traceability.

## First implementation slice

1. Verify installed osTicket version, custom fields, required fields, API/MCP capabilities, and the desired creation/review behavior. Do not assume every operation is supported by its stock API.
2. Define the KYC-to-ticket field mapping and a shared draft/create contract.
3. Add New support ticket to the selected KYC profile, supporting current caller and search selection.
4. Create through the verified backend integration; return the ticket link and references.
5. Add Invoice Ninja invoice context recognition and authoritative invoice retrieval to the same flow.
6. Add source-specific CRM/Ninja menus and optional visible-form filling after the first flow works.

## Acceptance criteria for the first slice

- Tom can start from either the current caller or an explicitly selected search result.
- Known details and system references are supplied without retyping; missing required information is requested.
- Tom reviews the draft before creation.
- Changing the active caller does not change the draft's selected Sarah.
- Unauthorized requests fail clearly and retries do not create duplicate tickets.
- Success returns an actual created ticket ID/link; failure is not presented as success.
- When invoice context is added, the ticket links to the exact invoice Tom selected.

## Open implementation choices

- Exact integration points within the extension and supported application URLs.
- Installed API capabilities, custom-field identifiers and any necessary server-side plugin/adapter.
- Backend placement within Data Docker and whether each operation is exposed through MCP, an API, or both.
- Existing KYC identity mapping owner and write-back contract.
- Which invoice details are copied into the ticket versus retained as linked references.
- Placement of the review UI and how to resume an interrupted draft.

## Related projects

- [PV Phone Chrome extension](../../../README.md)
- [SuiteCRM dialer integration](https://github.com/horsedog11/SuiteCRM_dialer)
- [PV Caller ID / KYC context](https://github.com/horsedog11/PV-CallerID)
- [Data Docker](https://github.com/horsedog11/pipeline-data)
