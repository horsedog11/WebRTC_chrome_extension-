# Pipeline Clipboard — managed-record collection (design)

Status: read-only extension UI, scoped gateway filter and Data Docker resolvers implemented on the contact-workspace feature branches; **not live-deployed**. See [implementation and setup](pipeline-workspace.md). This is an add-on to the existing PV Phone / Chrome Manifest V3 extension, not a replacement for the phone or its existing right-click dial action.

## User experience

1. Tom right-clicks a link to a supported application record, or right-clicks on a supported record page.
2. Choose **Add to Pipeline Clipboard**. The action is shown/enabled only for a configured, approved domain (and must be checked again on invocation).
3. The extension sends the selected **link URL** when appropriate, otherwise the **page URL**, to a single authenticated n8n webhook.
4. n8n recognizes the application's URL shape and record identifier, calls Data Docker's SQL/read-only API/MCP lookup, and responds with normalized structured data.
5. The extension stages the response in its **own internal clipboard** and displays a card/list. It does *not* immediately replace Windows' system clipboard.
6. Tom selects an item and output format, then clicks **Copy to Desktop Clipboard** to copy JSON, vCard or plain text. Multiple staged items and remove/clear actions are desirable.

## Responsibility boundary

| Component | Responsibility |
|---|---|
| Chrome extension | Domain allowlist, context-menu action, URL submission, pending/loading/error state, staging records, format selection and system copy button |
| n8n Pipeline Clipboard Lookup | Authenticate caller; validate URL; resolve application/record type; request record; normalize and return JSON |
| Data Docker | Fast read-only SQL lookup, authoritative IDs/relationships, optional application API detail retrieval; MCP may expose selected read-only operations |
| Application | Authoritative data source: SuiteCRM, Invoice Ninja, future osTicket or other managed systems |

**Do not** put SQL connections, service API credentials, platform-specific record parsers, business data mutation logic, or decryption keys in the extension. Platform-aware URL parsing and field mapping live in n8n/Data Docker, so new apps do not require rewriting the browser extension.

This is a **read-only collector**, separate from n8n's two-lane Record Write workflow (SuiteCRM and Invoice Ninja, with osTicket as a possible future third lane). Copying a record neither authorizes nor executes a write.

## Minimal request and response contract

Illustrative request (webhook URL and auth are deployment configuration, not assumed existing endpoints):

```json
{
  "url": "https://crm.pipelineventure.com/#/contacts/record/e7af4fcf-3b3b-4b7f-af70-46a072e06955"
}
```

Illustrative response:

```json
{
  "status": "success",
  "platform": "suitecrm",
  "record_type": "contact",
  "record_id": "e7af4fcf-3b3b-4b7f-af70-46a072e06955",
  "source_url": "https://crm.pipelineventure.com/#/contacts/record/e7af4fcf-3b3b-4b7f-af70-46a072e06955",
  "data": {
    "first_name": "MCP Email",
    "last_name": "test",
    "emails": [
      {"address": "mcp-email-test@example.com", "scope": "contact", "primary": true}
    ]
  }
}
```

A response is **data**, not an instruction to another workflow. Preserve exact record identities, source URL, provenance and contact-vs-account email distinction. Return a stable structured error for unsupported URLs, no matching record, unavailable backend and authentication failures. Batch responses can be added later.

## Configurable allowlist

The browser only needs a list of approved **exact hostnames** and the n8n webhook destination; these are separate concepts. Initial candidate platforms:

- `crm.pipelineventure.com` — SuiteCRM contacts, leads, accounts
- Actual Invoice Ninja hostname — confirm from deployment before adding
- Actual osTicket hostname — later, when its adapter exists

Illustrative extension-side settings:

```json
{
  "pipeline_clipboard": {
    "enabled": true,
    "allowed_domains": ["crm.pipelineventure.com"],
    "webhook": "<configured authenticated n8n URL>",
    "context_menu": "Add to Pipeline Clipboard"
  }
}
```

Allowlist updates may eventually come from an authenticated backend configuration response. **Merely adding a domain doesn't create its backend record resolver**; n8n needs a corresponding adapter and URL pattern.

## Implementation details and security

- Chrome MV3: use `chrome.contextMenus` for `link` and `page` contexts; determine the effective target URL from `info.linkUrl` when present, otherwise `info.pageUrl`. Chrome SPA URLs may carry the record ID after `#`; preserve the fragment intact in the JSON payload.
- Parse URLs using a URL parser and compare **hostname equality**, not substring matching; accept only HTTPS for production record sources. Validate protocol and hostname both in extension and n8n; never treat arbitrary pasted URLs as SSRF instructions or fetch them directly without policy.
- Extension needs host permission for the webhook service and necessary Chrome permissions (`contextMenus`, `storage`, `clipboardWrite` or appropriate Clipboard API support); no direct access to CRM DBs.
- Browser-to-webhook traffic is HTTPS and authenticated using a suitable browser/user session or short-lived scoped token. **Do not embed a permanent shared n8n service secret in shipped extension source.** Confirm auth approach with the planned Authentik integration.
- Store staged records in extension session storage by default, with an explicit decision if survival across Chrome restarts is desired. Clear/remove controls and explicit desktop-copy action protect against accidental clipboard overwrites.
- Clipboard JSON is structured content that can later be submitted to n8n workflows or Marcus. A future cross-application transport envelope may use encryption, but **this URL-to-webhook flow does not need custom payload encryption** just to function; n8n reads authoritative backend values.
- Do not scrape DOM content when the URL/authoritative backend record suffices. Some application URLs expose display IDs rather than database UUIDs; n8n/Data Docker resolves that mapping.

## Acceptance checks

1. Unsupported domain: menu action is not available/effective, and no webhook call occurs.
2. Approved SuiteCRM link: correct `linkUrl` (including fragment) reaches n8n; a record-page right click uses `pageUrl`.
3. Unknown or malformed URL: n8n rejects without fetching arbitrary destinations.
4. Success: structured payload is staged without changing the desktop clipboard.
5. **Copy to Desktop Clipboard** copies only the chosen item and format, on explicit click.
6. Several records can be collected and individually removed.
7. Direct contact email stays distinguishable from account email; record UUID and source URL persist.
8. Webhook auth errors and backend failures are clearly shown; no private data leaks into logs.
9. Existing PV Phone right-click **Call … with PV Phone** stays functional.

## Related designs

- [Customer Actions](project/customer-actions/README.md) — future user-driven actions/record creation
- [Identity and shared presence](project/identity-presence.md) — Authentik session and permission plans

