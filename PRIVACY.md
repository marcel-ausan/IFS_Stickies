# Privacy Policy — IFS Sticky Notes

_Last updated: 4 September 2026_

> Published at **https://marcel-ausan.github.io/IFS_Stickies/privacy.html** — that is the URL
> given to the Chrome Web Store. This file is the source it is written from.

## Summary

This extension has no server. It collects nothing, transmits nothing to us, and contains no
analytics or telemetry of any kind. Everything it reads and writes travels between your own
browser and your own organisation's IFS Cloud environment.

## What the extension does

It draws sticky notes on top of IFS Cloud (Aurena) pages and binds them to the record you
are viewing. Notes are stored in a custom entity (`CStickyNotes`) inside **your own IFS
environment** — the same system that already holds the record the note is attached to.

## What data is involved

| Data | Where it goes |
|---|---|
| Note text, colour, size and position | Written to `CStickyNotes` in your IFS environment |
| The record the note is attached to | Derived from the page URL; stored with the note in IFS |
| Your IFS (FND) user id | Read from your existing IFS session, stored with the note for attribution |
| Names and user ids of people you `@`-mention | Read from your organisation's own IFS person list, to show the picker |
| An optional user-id override you type in the extension popup | Stored locally in your browser via `chrome.storage.sync` |

## What we receive

**Nothing.** The developer of this extension operates no server and receives no data. There
is no usage tracking, no crash reporting, no advertising identifiers and no third-party
services. No data is sold, transferred, or used for any purpose beyond drawing your notes.

## Permissions, and why they exist

- **`storage`** — remembers the optional user-id override you type in the popup. Nothing
  else is stored.
- **`scripting`** — injects the note overlay into the IFS Cloud site you have explicitly
  enabled.
- **`activeTab`** — when you click the extension icon, lets the popup read the current tab's
  address so it can identify which IFS Cloud site you are on and ask permission for exactly
  that site. It is not stored or transmitted.
- **Host access** — requested at runtime, one site at a time, only when you press *Enable on
  this site*. The extension holds **no** host permissions when installed. Access is narrowed
  to the `/main/ifsapplications/web/` path, and you can revoke it per site from the popup at
  any time.

## E-mail notifications

When you `@`-mention someone and press the notify button, the extension writes the recipient
list and message into the note's record in IFS. **Your IFS environment** sends the resulting
e-mail, using its own configured mail settings. The extension never sends e-mail itself and
never sees an e-mail address.

## Data retention and deletion

Notes live in your IFS environment and are governed by your organisation's own retention
policies and backups. Deleting a note in the extension deletes the record in IFS. Removing
the extension does not delete notes already stored in IFS.

## Changes

Material changes to this policy will be published here alongside a new extension version.

## Contact

marcel.ausan@gmail.com
