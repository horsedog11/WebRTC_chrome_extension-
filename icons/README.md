# KYC source icon assets

These are original, source-identification glyphs for the future two-line KYC result rows. They are not official product logos. Each SVG uses a 48 × 48 viewBox, rounded 2-unit strokes, and a light foreground. Display at 38 × 38 pixels inside a 60 × 60 source tile beside two text lines. The existing bell glyph displays at 19 × 19 pixels.

| Source | File | Tile color |
| --- | --- | --- |
| SuiteCRM | `suitecrm.svg` | `#60438a` |
| Invoice Ninja | `invoice-ninja.svg` | `#855c23` |
| osTicket | `osticket.svg` | `#126b70` |

Open `preview.html` to review the three icons at intended size. All files are packaged under `chrome-phone/icons/` and are available to the phone extension's own pages via relative paths such as `icons/suitecrm.svg`. No additional Chrome permission is required for an extension page to display these bundled images. If an icon is later inserted directly into a third-party web page, its path must first be declared in `web_accessible_resources` for the relevant sites.

The current phone does not display KYC records or perform lookups. The preview's second lines are labels for layout review, not actual results.
