# IFS Sticky Notes — Free & Open Source

Record-specific, draggable sticky notes overlaid on IFS Cloud **Aurena** pages — a
replacement for the Apps10 Enterprise Explorer sticky-notes feature — with `@`-mentions
that e-mail the people you tag.

A Manifest V3 browser extension renders the post-its and binds them to the record on
screen. **Notes are stored in IFS itself**, in the `CStickyNotes` custom entity, reached
same-origin with your signed-in session. There is no server to install, run or host.

> Architecture, design decisions and known risks are in [CLAUDE.md](CLAUDE.md).

## Prerequisites

- A Chromium browser (Chrome/Edge)
- The `CStickyNotes` custom entity in the target IFS environment — see
  [CLAUDE.md](CLAUDE.md) for the field list
- Both come from `deploy/STICKY-NOTES.zip`, the Application Configuration Package — see
  [deploy/README.md](deploy/README.md)

## Install

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. **Load unpacked** → select the `extension/` folder.

The extension now runs **nowhere**. It ships with no host permissions at all, which is
deliberate — an all-hosts extension is the most common cause of store-review rejection.

## Enable it on your IFS site

4. Open your IFS Cloud tab and click the extension icon.
5. The popup lists what the environment needs first — the **CStickyNotes** custom entity
   (from the Application Configuration Package), the Custom Event for mail, and a
   projection grant. Read it, then press **Enable on this site** and accept Chrome's
   prompt.
6. It immediately checks the IFS setup and tells you whether `CStickyNotes` is actually
   there. A 404 means the configuration package hasn't been imported.

Access is per site, so a second environment needs its own grant. **Remove access** in the
popup revokes it; notes already written stay in IFS.

You don't need to reload the page — enabling injects into the tab you're on.

7. Navigate to a **record Form** page and click the 📝 button → **+**.

Notes are scoped to the record on screen and reappear when you return to it. The signed-in
IFS (FND) user is detected automatically and shown in the popup; the override field there is
only for environments where that detection fails.

## Check the setup later

**Check IFS setup** in the popup re-runs the same probe — read, write, cleanup — and
reports what it found, with the full detail in the popup's own console (right-click the
popup → Inspect).

## @-mentions

Type `@` in a note to search people — matching on **both full name and FND user id**, and
restricted to people who have a user id (anyone else could not be mailed). Picking someone
inserts their user id, e.g. `@JSMITH`.

**Picking someone does not send anything.** A **✉ Notify** button appears at the bottom
left of the note, showing how many tagged people have not been mailed yet. Press it when
the note actually says what you want it to say — that is what composes the mail and sends
it. Deleting an `@token` before pressing it un-tags that person.

## Project layout

```
extension/         Manifest V3 extension (no build step, no host permissions)
  manifest.json
  src/background/   injector.js — registers content scripts for granted sites
  src/content/      recordContext.js · config.js · mentions.js · ifsStore.js · content.js
  src/popup/        site access + settings + IFS setup check
  src/onboarding/   first-run setup page + administrator guide
  assets/           STICKY-NOTES.zip, served by the admin page's download button
  icons/            generated PNG icons
deploy/            the same ACP, plus import and configuration notes
test/              ifsStore.test.js  (npm run test:ifs)
scripts/           PowerShell generators for the icons and store assets
store-assets/      128px store icon and 1280x800 screenshots for the listing
```

## Trademarks

**Not affiliated with IFS AB.** “IFS” and “IFS Cloud” are trademarks of IFS AB,
used here only to describe the software this extension works with.

## Licence

[MIT](LICENSE) — free to use, modify and redistribute, including commercially. That covers
the extension and the configuration package in `deploy/`.

It is offered **as is, with no warranty**, which is not boilerplate here: the extension
depends on Aurena's URL scheme and on the REST naming IFS generates for a custom logical
unit. Neither is a documented interface, and an IFS upgrade can move either. See
[CLAUDE.md](CLAUDE.md) for what to re-check after one.

**Implementation and support services are available from the developer** — environment
setup, configuration for your own IFS instance, browser rollout, and keeping it working
across IFS releases. Get in touch if you would rather not carry that yourself.

*(The MIT text in [LICENSE](LICENSE) is deliberately left verbatim — modifying a standard
licence turns it into a bespoke one that every customer's legal team then has to read.)*

## Status

Working against a live environment. Notes are shared per record, the store is IFS, and the
e-mail step depends on the Custom Event being configured. See CLAUDE.md for the hardening
checklist and the per-customer deployment notes.
