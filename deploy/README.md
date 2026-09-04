# IFS configuration packages

Two Application Configuration Packages. **The order matters and they cannot be combined.**

| # | Package | Contains |
|---|---|---|
| 1 | `IFS-STICKY-NOTES-LU.zip` | The `CStickyNotes` custom LU, its projection and projection config, and the `StickyNotes` Aurena page group |
| 2 | `IFS-STICKY-NOTE-EVENT.zip` | The `C_STICKY_NOTE_NOTIFY` custom event and its e-mail action |

Free to use. No licence key, no activation, nothing phones home.

## Why two, and why in this order

The event's action condition and parameters reference the entity's columns —
`CF$_NOTIFYTO`, `CF$_NOTIFYSUBJECT`, `CF$_NOTIFYBODY`. **Those columns do not exist until
the custom LU has been published.** Publishing is what generates the table and the
projection; importing the LU alone only defines it.

Import both together, or import the event before publishing, and the import fails with:

```
Field [IMPORT_ID] is mandatory for Application Configuration Item Import
and requires a value.
```

That message is misleading — `IMPORT_ID` is generated server-side by
`App_Config_Import_API.Register_Import___`, so a null one means the import session was
never created, not that anything is wrong with the file. The real cause is the event
referring to columns that are not there yet.

## Steps

1. Open **Application Configuration Packages** (Solution Manager).
2. **Import Configuration** → the import package assistant → upload
   **`IFS-STICKY-NOTES-LU.zip`** → review → apply.
3. **Publish the `CStickyNotes` custom logical unit.** This creates the table, the columns
   and the projection. Do not skip or defer this — step 4 fails without it.
4. Import **`IFS-STICKY-NOTE-EVENT.zip`** the same way.
5. **Set the mail sender** — see below. Nothing warns you if this is wrong.
6. **Grant the projection** — see below. This is the step people forget.
7. **Add the page group to the Navigator** — optional, see below.

Then have one user press **Check IFS setup** in the extension popup. It reports read and
write separately, so a missing grant is distinguishable from a missing entity.

## Setting the mail sender

The event action ships with:

```
$SENDER = EDI_MAIL_SENDER
```

That is simply what the source environment used. **It is not a universal value** and very
likely does not exist in yours. Open the imported event action `C_STICKY_NOTE_NOTIFY`, find
`$SENDER` in its action parameters, and set it to a mail sender this environment actually
has configured.

This one fails invisibly: notes save, mentions are recorded, the event fires, and no
e-mail ever arrives. The extension cannot detect it — from its side the write succeeded.
Always finish an install by mentioning somebody and confirming the mail lands.

## Granting access

Add **`CustomProjectionCStickyNotes`** to the **basic permission set that every user
already has** — the one assigned to all employees by default. Users need **read and
write**.

Sticky notes are a general-purpose tool like attachments: anybody who can open a record
should be able to leave one. Putting the grant in a special-purpose permission set means
the feature quietly works for some colleagues and not others, and the person who cannot
save a note has no way to tell why.

Mentioning people also reads the standard person list, which essentially every user
already has.

## Adding the page to the Navigator

`IFS-STICKY-NOTES-LU.zip` brings an Aurena page group — `StickyNotesList` and
`StickyNotesPage` — for browsing notes inside IFS. **Importing it does not put it in the
menu.** Open **Navigator Designer** (saved entries live under **Navigator
Configurations**), add an entry pointing at the `StickyNotes` page group, and publish.

This is optional: the extension does not use that page, and notes appear on record pages
either way. If users cannot see the entry after publishing, check the permission set from
the previous section also covers the page.

## How the e-mail fires

Worth understanding before changing anything.

**The event** (`C_STICKY_NOTE_NOTIFY`) is AFTER-MODIFY only — not insert, not delete —
with `MODIFIED_ATTRIBUTES = CF$_NOTIFYTO`. So it fires **only when `Cf_Notifyto` changes**.
Ordinary note edits never write that column, which is why typing in a note does not e-mail
anybody.

**The action** adds the condition `CF$_NOTIFYTO != null`, and sends:

```
$TO      = &NEW:CF$_NOTIFYTO
$SUBJECT = &NEW:CF$_NOTIFYSUBJECT
$MESSAGE = &NEW:CF$_NOTIFYBODY
$SENDER  = EDI_MAIL_SENDER
```

The extension composes the subject and body — including the deep link back to the record —
so wording changes never require touching IFS.

Two things to know:

- **`Cf_Notifytrigger` is written by the extension but not used by this event.** It carries
  a fresh timestamp per send and is a ready-made hook if you ever want the event keyed on
  something that always changes. Harmless as it stands.
- **Because the event keys on `Cf_Notifyto` *changing*, two consecutive sends with an
  identical recipient list would not fire.** The extension prevents that from the other
  side: `Cf_Notifiedto` accumulates everyone already told, and a notified person never
  becomes pending again. The two mechanisms are complementary — don't remove one on the
  grounds that the other exists.

**The body is HTML.** If recipients see literal `<p>` tags, this environment is sending the
action as plain text; say so and the extension will emit plain text instead.

## Re-exporting

Keep the split. If the field list changes, re-export both from a working environment:
**Application Configuration Packages** → build one package with the custom LU, projection
and page group, and a second with the event and its action → export → replace these files.
The `F` map in `extension/src/content/ifsStore.js` is the source of truth for what must
exist.

### Then always run this — every export, without exception

```
powershell -ExecutionPolicy Bypass -File scripts\stamp-acp-metadata.ps1
```

**IFS stamps the exporting environment into every package it produces:**

```xml
<AUTHOR>dwre</AUTHOR>
<ORIGIN>DWRECFG1-dwre-cfg</ORIGIN>
```

Both are shown to the administrator on the import wizard's **Validation Summary**, and
this repository is public. Ship an unstamped package and a customer's environment name is
on display to everyone who downloads it, and to every other customer who imports it.

The script rewrites them to `marcel.ausan@gmail.com` / `opensource-for-community`, copies
the result into `extension/assets/` (which is what the admin page's download buttons
serve), and **fails loudly if any environment reference survives** — descriptions and
export comments can carry one too, and those it will not rewrite for you because they may
be meaningful.

It edits the XML in place inside the zip rather than re-zipping. `Compress-Archive` on
Windows writes backslash entry paths where IFS wrote forward slashes, and a re-zipped
package can fail to import. Running it twice is safe.

## Versions

Navigator wording moves between IFS releases, so page names above are a guide rather than
an exact path. These packages were exported from IFS Cloud 25.x.
