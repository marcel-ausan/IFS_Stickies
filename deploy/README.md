# IFS configuration package

`STICKY-NOTES.zip` is an **Application Configuration Package** containing everything the
extension needs on the IFS side. One import per environment, roughly ten minutes.

Free to use. No licence key, no activation, nothing phones home.

## Importing it

1. Open **Application Configuration Packages** (Solution Manager).
2. **Import Configuration** → the import package assistant.
3. Upload `STICKY-NOTES.zip`, review the items, apply.
4. **Set the mail sender** — see below. Nothing warns you if this is wrong.
5. **Grant the projection** — see below. This is the step people forget.
6. **Add the page group to the Navigator** — optional, see below.

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

Sticky notes are a general-purpose tool like attachments or notes: anybody who can open a
record should be able to leave one. Putting the grant in a special-purpose permission set
means the feature quietly works for some colleagues and not others, and the person who
cannot save a note has no way to tell why.

Mentioning people also reads the standard person list, which essentially every user
already has.

## Adding the page to the Navigator

The package brings an Aurena page group — `StickyNotesList` and `StickyNotesPage` — for
browsing notes inside IFS. **Importing it does not put it in the menu.** Open **Navigator
Designer** (saved entries live under **Navigator Configurations**), add an entry pointing at
the `StickyNotes` page group, and publish.

This is optional: the extension does not use that page, and notes appear on record pages
either way. It is for anyone who wants to search or review notes across records. If users
cannot see the entry after publishing, check the permission set from the previous section
also covers the page.

## What the package contains

| Item | Type | What it is |
|---|---|---|
| Custom Sticky Notes (`CStickyNotes`) | Custom LU | The 21-field entity notes are stored in |
| `CustomProjectionCStickyNotes` | Custom projection | The REST endpoint the extension calls |
| `CustomProjectionCStickyNotes` | Projection config | Generated alongside the projection |
| `C_STICKY_NOTE_NOTIFY` | Custom event | Fires the mention e-mail |
| `…-0-MAIL` | Event action | The e-mail itself |
| `StickyNotes` | Aurena page group | `StickyNotesList` / `StickyNotesPage` — browse notes inside IFS |

## How the e-mail actually fires

Worth understanding before changing anything, because it is subtler than it looks.

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

If the field list changes, re-export from a working environment: **Application
Configuration Packages** → add the custom LU, projection, event, action and page group as
items → export → replace this file. The `F` map in
`extension/src/content/ifsStore.js` is the source of truth for what must exist.

## Versions

Navigator wording moves between IFS releases, so page names above are a guide rather than
an exact path. This package was exported from IFS Cloud 25.x.
