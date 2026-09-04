# Chrome Web Store listing

Everything the dashboard asks for, ready to paste. Keep this in sync with
`extension/manifest.json` — the store takes the item name and summary from there, not
from this file.

Upload package: `ifs-sticky-notes-1.0.0.zip` (built by `Compress-Archive` over
`extension\*`; the manifest must sit at the ZIP root, not inside a folder).

---

## Before you start

**The privacy policy URL must resolve when the reviewer opens it.** GitHub Pages is not
enabled yet — `https://marcel-ausan.github.io/IFS_Stickies/privacy.html` returns 404. Either
enable it (Settings → Pages → Source: `main`, folder `/docs`) and wait for the build, or use
the repository URL below instead. Do not submit with a 404 policy link; it is a guaranteed
rejection.

---

## Store listing tab

**Item name** — taken from the manifest, not editable here:

```
IFS Sticky Notes — Free & Open Source
```

**Summary** (132 char limit) — also from the manifest:

```
Shared sticky notes on any IFS Cloud record. Free and open source — every note is stored in your own IFS, never on our servers.
```

**Category:** Workflow & Planning · **Language:** English

**Detailed description:**

```
Sticky notes for IFS Cloud, on the record itself.

IFS Applications had post-it notes. IFS Cloud does not. This puts them back: open any
Aurena page, write a note, and it stays pinned to that record for everyone who opens it.

Tag a colleague with @ and they get an e-mail linking straight back to the record.

── WHERE YOUR NOTES LIVE ──────────────────────────────

Notes are stored in your own IFS Cloud environment, in a custom entity called
CStickyNotes — the same system that already holds the record the note is attached to.

There is no server behind this extension. No analytics, no telemetry, no third-party
requests of any kind. Uninstall it and your notes are still in IFS, where they always were.

── THIS NEEDS IFS CONFIGURATION FIRST ─────────────────

The extension is inert on its own. An IFS administrator must import two Application
Configuration Packages into your environment. Both are supplied free with the extension:

  1. IFS-STICKY-NOTES-LU — the CStickyNotes entity and its projection.
     Import it, then PUBLISH it.
  2. IFS-STICKY-NOTE-EVENT — the Custom Event and E-Mail action behind @-mention
     notifications. Import it after the publish.

The order matters: the event references fields that do not exist until the entity is
published. The administrator also needs to grant the projection to the permission set your
users already have, and add the page to the Navigator.

Both packages download from the extension's own admin page, and from the GitHub
repository. Full setup instructions ship with them.

── WHAT IT DOES ───────────────────────────────────────

• Notes bound to the record you are on, visible to everyone who opens it
• Eight colours; drag, resize, collapse out of the way
• @-mention search across your own IFS person list — by name or by user id
• Notification is a button, not a side effect. The note saves as you type; nothing is
  e-mailed until you press Notify
• Only people who have not already been told get the mail
• Every note is signed with the IFS user detected from your session

── PERMISSIONS ────────────────────────────────────────

The extension asks for nothing at install. You enable it on one IFS Cloud site from its
popup, and it runs only there. Remove that access at any time from the same popup.

── FREE AND OPEN SOURCE ───────────────────────────────

MIT licensed, in full, including the IFS configuration packages.

Source, packages and setup guide:
https://github.com/marcel-ausan/IFS_Stickies

Not affiliated with, endorsed by, or sponsored by IFS AB. "IFS" is a trademark of its
respective owner and is used here only to describe what this extension works with.
```

**Store icon:** `store-assets/store-icon-128.png`

**Screenshots** (1280×800, up to 5 — the set fills all five, in this order):

| # | File | Shows |
|---|------|-------|
| 1 | `store-assets/screenshot-1.png` | A note on a live record |
| 2 | `store-assets/screenshot-2.png` | The @-mention picker mid-search |
| 3 | `store-assets/screenshot-3.png` | The popup, site access and setup check |
| 4 | `store-assets/screenshot-4.png` | A note on a Customer Order, Notify armed |
| 5 | `store-assets/screenshot-5.png` | The notification as it arrives |

**URLs**

| Field | Value |
|---|---|
| Homepage | `https://github.com/marcel-ausan/IFS_Stickies` |
| Support | `https://github.com/marcel-ausan/IFS_Stickies/issues` |

**Mature content:** No

---

## Privacy tab

**Single purpose:**

```
This extension attaches sticky notes to records in the user's own IFS Cloud environment,
and notifies colleagues mentioned in those notes by e-mail sent from that same environment.
```

**Permission justifications** — one per permission; the dashboard will not let you submit
without them:

| Permission | Justification |
|---|---|
| `storage` | Stores two small settings in `chrome.storage.sync`: an optional IFS user-id override, used when automatic detection from the session fails, and which IFS site the user has enabled. No note content is stored here — notes live in IFS. |
| `scripting` | Registers the content script on the single IFS Cloud origin the user has granted, at the moment they grant it. This is what lets the extension ship with no declared content scripts and no host access at install. |
| `activeTab` | Lets the popup read the current tab's URL so it can name the IFS site before it has permission for that site, and message the content script to run the setup check. Nothing is read from the page itself. |
| Host permissions (`https://*/*`, optional) | The extension must run on the customer's own IFS Cloud host. That host differs for every customer and cannot be known in advance, so it cannot be declared in the manifest. The user grants exactly one origin from the popup, and only that origin is ever used. |

**Are you using remote code?** No — all code is in the package.

**Data usage:** tick nothing. The extension collects no user data. Then certify all three:
not sold to third parties, not used for purposes unrelated to the single purpose, not used
to determine creditworthiness or for lending.

**Privacy policy URL:**

```
https://marcel-ausan.github.io/IFS_Stickies/privacy.html
```

Fallback while Pages is off — this one resolves today:

```
https://github.com/marcel-ausan/IFS_Stickies/blob/main/PRIVACY.md
```

---

## Distribution tab

**Visibility: Unlisted.** Deliberate — the extension is inert without the IFS packages, so a
public listing earns support tickets and one-star reviews from people who install it with no
IFS environment to point it at. Distribution is the unlisted link plus force-install by
policy for customers who want it deployed.

**Regions:** all.

---

## Known review risk

The name carries a third-party trademark. Chrome Web Store policy allows describing what an
extension works with but prohibits implying affiliation, so the disclaimer at the end of the
description is doing real work — do not drop it. If the listing is rejected on trademark
grounds, the fix is to rename (for example "Sticky Notes for IFS Cloud") rather than to
argue; two paid competitors use the same construction, which is evidence the wording is
usually accepted but not a guarantee.
