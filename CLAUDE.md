# IFS Sticky Notes — Project Memory

Record-specific sticky notes overlaid on IFS Cloud **Aurena** pages, recreating the
Apps10 Enterprise Explorer "sticky notes" feature that has no equivalent in IFS Cloud —
plus `@`-mentions that e-mail the people you tag.

## What & why (the decisions that shaped everything)

The client wants **record-specific post-its** with the true draggable post-it UX — notes
that float on top of the record page, not an IFS-styled list. A browser extension is the
only way to get that; it is **not an officially supported IFS extension point**, so it is
sensitive to Aurena upgrades (DOM / URL routing). See "Fragility".

**Notes are stored in IFS**, in the `CStickyNotes` custom entity. An earlier version used
an external Node + SQLite service; that has been **deleted**. Everything the extension
does is a same-origin call to an IFS projection with the signed-in session cookie, which
is why there is now no server, no `host_permissions`, no CORS, and no background service
worker. If you ever need the old service, it is in git history.

## Architecture

```
popup  ──grant──▶ chrome.permissions.request({origins:['https://<their-ifs>/*']})
                        │
                        ▼
        injector.js registers the content scripts for that origin,
        narrowed to /main/ifsapplications/web/*
                        │
                        ▼
Content scripts (Shadow DOM overlay)
        │  same-origin fetch, credentials:'include'
        ▼
IFS projection  CustomProjectionCStickyNotes.svc / CStickyNotesSet
        ▲
        └── Custom Event (E-Mail action) fires when Cf_Notifyto changes
```

- **Plain JS + Shadow DOM, no bundler.** Loads directly as an unpacked extension; styles
  are isolated so Aurena CSS cannot interfere and ours cannot leak.
- **No declarative `content_scripts`, no `host_permissions`.** Nothing runs anywhere until
  the user enables a specific IFS site from the popup — see "Site access" below.
- **The service worker does no network I/O.** `injector.js` exists only to keep script
  registrations in step with granted permissions. Notes are fetched by the content script
  itself, same-origin.
- **`SN.ifsStore` is the only store.** It exposes `listNotes / createNote / updateNote /
  deleteNote / notifyMentions / buildMessage / probe`.

## Site access (optional host permissions)

An all-hosts `matches` entry is the single most common reason an extension like this is
rejected or held in extended store review, so the extension ships holding **nothing**:

| manifest key | value |
|---|---|
| `permissions` | `storage`, `scripting`, `activeTab` |
| `optional_host_permissions` | `https://*/*` |
| `host_permissions` | *(absent)* |
| `content_scripts` | *(absent — registered at runtime)* |

The popup reads `tab.url` under **`activeTab`** (granted when the user clicks the icon; no
install-time warning, unlike `tabs`), recognises an IFS page by the `/main/ifsapplications/`
path, and requests that one origin. `chrome.permissions.request()` needs a user gesture, so
it hangs off the Enable button and nothing else.

`injector.js` then registers the content scripts with `persistAcrossSessions`, **narrowed
back down to `/main/ifsapplications/web/*`** — the user grants a whole origin, but we still
only inject where the app is, which also keeps us off the Keycloak login pages under
`/auth/realms/...` (those once showed a stray sticky button on the sign-in screen).

Two things worth not breaking:

- **The worker is the reliable path, not the popup.** On some platforms the permission
  prompt closes the popup, so `enable()` never finishes. `permissions.onAdded` in the worker
  does the registration and the inject-into-open-tabs independently; the popup's
  `sn-sync-sites` message is just a faster route to the same place.
- **Registration work is serialised, and that is load-bearing.** Because both of the above
  fire on a single grant, two `syncRegistration()` runs used to race: both read "nothing
  registered", both called `registerContentScripts`, and the loser threw *Duplicate script
  ID 'sticky-notes'*. Worse than the noise — the losing call might have been the one
  carrying newer matches. `serial()` queues them, and a duplicate-id error is additionally
  caught and retried as an update, since persisted registrations mean
  `getRegisteredContentScripts` can disagree with reality after a reload. Don't call
  `syncRegistration` outside `serial()`.
- **Granting does not retro-inject.** `injectIntoOpenTabs()` runs `executeScript` over
  already-open tabs so there is no "now reload the page" step. Re-injection is safe because
  `content.js` guards on `window.__ifsStickyNotesLoaded`.

### Chrome's prompt cannot be reworded — so frame it first

The permission dialog ("read and change your data on *host*") is Chrome's, generated from the
permission itself, identical for every extension, and not customisable. Users read it as far
more invasive than what this extension does. The popup therefore states the case immediately
above the Enable button: **no data leaves your IFS environment** — notes go to `CStickyNotes`
in the customer's own tenant, people come from their own IFS person list, and there is no
server, no analytics and no other network call. Say it before the prompt, because afterwards
is too late.

### One setting, not three

The old `enabled` checkbox is gone. **Remove access** revokes the host permission (the real
off switch) and clicking the FAB hides the notes (the soft one); a third global toggle that
also needed a page reload to take effect just read as broken. The only setting left is the
FND-user override, and `content.js` applies it live through `chrome.storage.onChanged`, so
nothing in the popup asks for a reload any more.

The popup shows the *detected* user (`sn-whoami`) next to the override field, so it is obvious
whether the override is needed at all.

### First-run setup page

`src/onboarding/onboarding.html` opens once on install (`onInstalled` with
`reason === 'install'` only — reopening it on every update would be an irritation), and is
reachable later from the popup's "Open the setup guide" link.

It exists because **a fresh install is invisible**: no host permissions means nothing runs
anywhere, and even once granted the notes need `CStickyNotes` to exist. Without it the first
experience is a 📝 button that never appears, followed by one that errors.

**Granting does not happen on this page.** It once carried an address field, because unlike
the popup it has no active IFS tab to read an origin from — but asking someone to paste a
URL the extension can read itself was work we invented. The field, the origin parser and
the grant handler were all deleted; the page directs users to the popup, which has
`activeTab` and already knows the site. It only lists granted sites with per-site Remove,
and subscribes to `permissions.onAdded` so it fills in live rather than sitting on a stale
"not enabled anywhere yet" while the user grants in another window.

### The ACP prerequisite is stated at the point of granting

Access to the site is worthless if `CStickyNotes` was never imported — the notes simply
fail to save. So the popup shows the prerequisites **before** the Enable button (the custom
entity from the Application Configuration Package, the Custom Event for mail, the projection
grant), and immediately after a successful grant it runs `probe()` and reports what it
found. A 404 there says *"import the Application Configuration Package"* in those words,
because the person reading it is a customer, not the developer.

## Record context detection (the critical/fragile part)

`extension/src/content/recordContext.js` parses the Aurena URL to identify which record is
on screen:

```
https://host/main/ifsapplications/web/page/<Client>/<Page>;<key=value>...?<query>
```

**Primary key source: the `record=` assignment.** Aurena puts the business key in a base64
`record=` param, e.g. `record=KE9yZGVyTm89J1QxMDAyOCcp` → `(OrderNo='T10028')`. The parser
base64-decodes it and binds notes to **`<client>/<page>::<decoded>`**. We deliberately
**ignore `path=`** (an internal, volatile navigation path — earlier versions bound to it,
which produced ugly `[path=0.163…]` labels and unstable keys).

Fallback for pages with no `record=`: harvest `key=value` from inline assignments plus any
`$filter ... eq 'value'`, and build a canonical `luName::sortedKeys` signature.

`recordKey` is the binding key; `luName`/`keyRef` are best-effort display extras.

**If notes stop binding to records after an IFS upgrade, look here first.** Changing the
recordKey scheme orphans existing notes — they stay in IFS under the old key.

## CStickyNotes — the shape, confirmed against a live response

Three things a Custom LU does that you cannot predict from source. All are encoded in the
`F` map at the top of `ifsStore.js`; never inline a field name anywhere else.

1. **The projection is `CustomProjectionCStickyNotes.svc`**, entityset `CStickyNotesSet`.
2. **The key is `Objkey`, and the server generates it.** `@odata.id` is
   `CStickyNotesSet(Objkey='5A9AB255…')`. `Cf_Noteid` is an ordinary column, so the client
   cannot choose the identity — `createNote()` reads it from the POST response, falling
   back to re-querying by `Cf_Noteid` (which it still stamps with a uuid) on a 204.
3. **Custom fields are `Cf_` prefixed and CASE-FLATTENED**: `Cf_Noteid`, not `Cf_NoteId`.

Also: **numbers come back as strings** tagged `#Decimal` (`"Cf_Posx": "1"`), so every
numeric read is coerced.

**Never add `$select` to a query.** Naming one field the LU does not have 400s the whole
request. The server returns every column anyway. A test asserts no query contains one.

**Writes must refresh their own etag.** A PATCH answers **204 with no body**, so nothing
updated the cached `@odata.etag` and the *next* write failed 412 "Resource already
modified" — silently, because `queueSave` only warned. Every edit after the first was
being dropped. Two defences, both tested, don't remove either:

1. Every POST/PATCH sends `Prefer: return=representation`, so the server returns the saved
   row and `rememberEtag()` picks up the new version.
2. `patchRow()` catches a 412, drops the stale etag, re-reads the row and retries once. If
   the re-read also fails it falls back to `If-Match: *` — losing the concurrency check
   beats losing the user's note.

A failed autosave now also writes `⚠ NOT SAVED` into the note footer. Silent data loss is
much worse than an ugly footer.

**A Custom LU exposes no `Rowversion`**, so there is no free last-changed timestamp:
`updateNote()` stamps `Cf_Updateddate` on every write. If we don't, nothing does, and the
footer's "Updated \<when\>" stays blank.

### Fields

Attribute names cap at **26 chars**; types are String / Number / Date / LongText / Binary /
Enumeration / Reference. Don't create `Objid`/`Objkey`/`Objversion` — the framework adds
them.

| REST name | Type | Len | Notes |
|---|---|---|---|
| `Objkey` | – | – | **THE KEY.** Framework-supplied, server-generated |
| `Cf_Noteid` | String | 36 | Client uuid. *Not* the key — only used to re-find a row after a 204 |
| `Cf_Recordkey` | String | 500 | **Indexed** + Queryable. The only field `listNotes` filters on |
| `Cf_Luname` / `Cf_Keyref` | String | 50 / 500 | Display; also the mail subject |
| `Cf_Pageurl` | String | 2000 | Deep link in the mail |
| `Cf_Notetext` | LongText | – | Falls back to String(4000) — LongText sits outside the `Persistent` subset of `CustomFieldDataTypes`, so the UI may not offer it |
| `Cf_Color` | String | 10 | |
| `Cf_Posx`/`Cf_Posy`/`Cf_Width`/`Cf_Height` | Number | | Returned as **strings**; coerced on read |
| `Cf_Createdby` / `Cf_Updatedby` | String | 30 | FND user |
| `Cf_Createddate` / `Cf_Updateddate` | Date | | Footer. Both stamped by the extension |
| `Cf_Mentions` | String | 2000 | Comma list of everyone tagged in the text |
| `Cf_Notifyto` | String | 2000 | **This send's recipients** — what the E-Mail action mails |
| `Cf_Notifiedto` | String | 2000 | **Cumulative**; everyone ever told. Drives "pending" |
| `Cf_Notifysubject` | String | 500 | Composed in JS |
| `Cf_Notifybody` | LongText | – | Composed in JS |
| `Cf_Notifytrigger` | String | 40 | Fresh timestamp per send. Written by the extension, **not used by the shipped event** — a spare hook |

## @-mentions

`mentions.js` opens a person picker on `@`, backed by a same-origin cookie call — the same
mechanism as `fetchFndUser()`, so no host permission and no bearer token:

```
PersonHandling.svc/PersonInfoSet?$select=PersonId,Name,UserId
  &$filter=(UserId ne null) and (contains(tolower(Name),'…') or contains(UserId,'…'))
```

**Search Name AND UserId — never Name alone.** People type what they see, and what they
see is the FND user `JSMITH`, not "Jane Smith". Filtering on `Name` only returns
nothing for exactly the string users reach for first, and it looks identical to a broken
picker. This was a real bug.

`(UserId ne null)` is equally load-bearing: persons without an FND user (contacts,
customer-side people, leavers) would be taggable but unmailable, failing silently.

Names are mixed case, FND ids are upper case, and OData `contains()` is case-sensitive on
Oracle — hence `tolower()` on the Name side and `toUpperCase()` on the id side. Not every
environment permits `tolower()` or even `contains()`, so `searchPersons()` walks a ladder:
`contains-ci` → `contains` → `startswith` → fetch-one-page-and-filter-locally. Only a 4xx
advances it; a 5xx/network error stops it, so a broken server isn't hit four times per
keystroke. A rung is **pinned only once it returns rows** (logged as
`[sticky] person LOV strategy: …`) — pinning on an empty result would lock in a rung that
is accepted but silently matches nothing. An empty result renders a "No match" row rather
than closing the menu; silence was indistinguishable from a broken picker.

**The token inserted is `@UserId`, not the display name.** It is whitespace-free (survives
editing, re-detectable with a trivial regex), it is exactly what `Command_SYS.Mail` wants
as a recipient — it resolves a bare user name via
`Fnd_User_API.Get_Property(user,'SMTP_MAIL_ADDRESS')`, `Command.plsql:620` — and someone
who knows an id can type it by hand. **No e-mail address is stored anywhere.**

## Notification — explicit, never automatic

**Sending is a button, not a side effect.** The note is PATCHed on a 600 ms debounce while
the user types, so at the moment a person is picked the body is usually just
`@JSMITH ` — notifying then mails an empty note. That was the original design and it was
wrong.

So: picking someone only **arms** a ✉ button in the note header showing the pending count.
Pressing it flushes the debounced save (so the mail quotes what is on screen, not whatever
the last autosave caught), composes subject + body + deep link, and PATCHes the notify
fields. Deleting an `@token` before pressing it un-tags that person silently.

Pending = `Cf_Mentions` − `Cf_Notifiedto`. Because `Cf_Notifiedto` lives in IFS it survives
reloads and is shared between users, so two people editing the same note cannot
double-notify. `Cf_Notifyto` holds only the current send, so adding one more person later
does not re-mail the people already told.

### The hard constraint on e-mail

**Nothing in IFS exposes `Command_SYS.Mail` over a projection** — verified: no `.plsvc` in
the product calls it, and the only `SendEmailAction` is domain-bound to Casual Case
Management. A browser has no SMTP either. So "send the mail from the extension" is not
achievable literally. The split:

| | owns |
|---|---|
| **Extension (JS)** | *all logic* — who is pending, subject, body, deep link, when to send |
| **IFS (configuration)** | a Custom Event on `CStickyNotes` with an **E-Mail action**, sending verbatim what the extension wrote |

No PL/SQL, no scheduled task, no projection action. The mail body is shaped after
`FndObjSubscriptionUtil.Send_Email___` in fndbas: what happened, the deep link, then the
note.

**`Cf_Notifybody` is HTML, not plain text.** The E-Mail action renders it, so the original
`\n`-separated body arrived as one run-on paragraph with the `-----` separators showing as
literal dashes. `buildMessage()` therefore emits `<p>`, an `<a>` for the deep link, and
`<br>` for the line breaks the user typed inside the note — and **escapes everything it
interpolates**, because note text is user input heading for a colleague's mail client.
Styles are inline; mail clients drop `<style>` blocks. If a future environment sends the
body as text/plain the tags will appear literally — that is the signal to go back to `\n`.

**The shipped event keys on `Cf_Notifyto` changing** — `deploy/STICKY-NOTES.zip`,
`C_STICKY_NOTE_NOTIFY`, AFTER-MODIFY with `MODIFIED_ATTRIBUTES = CF$_NOTIFYTO`, plus an
action condition `CF$_NOTIFYTO != null`. Ordinary note edits never write that column, which
is why the 600 ms autosave does not mail anybody. A test asserts an ordinary edit writes no
`Cf_Notify*` fields; keep it passing.

Two interlocking details, easy to break by "simplifying" either side:

- **`Cf_Notifytrigger` is not used by the shipped event.** The extension still writes it a
  fresh timestamp per send, which makes it a ready-made hook if the event is ever re-keyed
  onto something that always changes. Harmless, but don't document it as the trigger.
- **Because the event needs `Cf_Notifyto` to *change*, two consecutive sends with an
  identical recipient list would not fire.** The client prevents that from the other side:
  `Cf_Notifiedto` accumulates everyone already told and a notified person never becomes
  pending again. The two mechanisms are complementary — removing one because the other
  exists reintroduces either silent non-delivery or duplicate mail.

Accepted cost: **no retry.** If the PATCH fails nobody is notified — but because it is an
explicit button, the user sees the error and can press it again.

**`$SENDER` in the shipped action is `EDI_MAIL_SENDER`, which is not portable.** It is
whatever the source environment used, and probably does not exist at the next customer.
This fails *invisibly*: the write succeeds, the event fires, and no mail arrives — the
extension cannot detect it, because from its side everything worked. `probe()` deliberately
does not claim to test e-mail. Every install must finish with a real mention and a
confirmed delivery; both admin guides say so.

## Decisions log

- **Notes are SHARED per record** (not user-specific) — `listNotes` filters on
  `Cf_Recordkey` only. `Cf_Createdby` is captured for attribution (shown in the footer).
- **FND user is auto-detected via a cookie-authenticated IFS call.** This env uses
  **Keycloak** (`/auth/realms/cfg`, client `IFS_aurena`) with **cookie/proxy** auth —
  projection requests carry **no** `Authorization: Bearer` header, and the session cookies
  are HttpOnly, so neither header-sniffing nor a page-storage `oidc.user:` scan yields the
  user here. Instead the content script (same origin) calls
  **`UserProfileService.svc/GetProfileDetails()`** with `credentials:'include'`; the
  session cookie rides along and it returns the signed-in user's own client profile. The
  FND user is the row's **`Owner`** field (e.g. `JSMITH`) — NOT `ProfileId`, which is an
  internal GUID. See `fetchFndUser()` / `extractUser()`. (`GetProfileId()` 400s — it needs
  parameters; don't use it.) Resolution order: `GetProfileDetails().Owner` → in-page OIDC
  scan (`detectFndUser`, vestigial — empty in this env) → popup User ID. Restore the
  Bearer-capture path from git history if deploying to a Bearer-based environment. This is
  a *client-read* identity, not server-verified.
- **Host match is path-based, not domain-based:** `https://*/main/ifsapplications/web/*`.
  IFS Cloud clients live on many domains (`*.ifscloud.com`, `*.ifscloud.com.tr`, custom),
  so matching the Aurena **path** on any host covers them all with no per-client list, and
  it excludes the Keycloak login pages (`/auth/realms/...`) which previously showed a stray
  sticky button on the Sign In screen. **Nothing in the extension is host-specific** —
  every URL is relative. Trade-off: the all-host match shows a broad "read data on sites
  you visit" permission; acceptable for an internal force-installed tool.
- **Only the `storage` permission.** No `tabs`: reading `tab.url` would add a "read your
  browsing history" warning purely for a nicer error string, and messaging a content script
  needs no permission at all.
- **One entity, no child table for mentions.** Realistic cardinality is 1–3 people, nothing
  queries mentions independently, and pending/notified is expressible as two comma lists.
  The one thing that would justify splitting is a *mentions inbox* ("everything I was
  tagged in"), which would need an indexed lookup instead of a `LIKE` scan.

## Per-customer deployment

Nothing is host-specific, but the **configuration** is:

| Thing | Note |
|---|---|
| `CStickyNotes` LU + its fields | Must exist with identical names |
| `CustomProjectionCStickyNotes.svc` | Derived from the LU name |
| Custom Event + E-Mail action | Per environment |
| Projection grant / permission set | Per customer |

Move it with an **Application Configuration Package** rather than re-creating it by hand —
`AppConfigPackageItem.plsql:338` emits `'CustomLogicalUnit-' || lu || '.xml'`. Hand-creating
the fields at each customer will eventually produce a `Cf_Recordkey` vs `Cf_RecordKey`
mismatch and a confusing 400.

## UI behaviour notes

- **Only shown on record Form pages.** The button + notes appear only when the URL path
  matches `/page/<x>/Form` (`isFormPage()`); elsewhere the shadow host is `display:none`.
  Gating is at **runtime**, re-evaluated on every SPA navigation via `onNavigate()`, NOT
  via the manifest match — the content script must stay loaded on all `/web/*` pages so it
  can detect navigating *onto* a Form page without a full reload.
- **No on-screen toolbar.** The FAB carries a small **`+` button** that creates a note;
  clicking the FAB **body** toggles show/hide; dragging it moves it. Context/user/count
  live in the FAB **tooltip** (`updateTooltip()`).
- **New notes open at the top right**, 440×360, from `NOTE_W`/`NOTE_H`/`NOTE_MARGIN`. Aurena
  puts the record's own fields down the left and centre of a Form page, so a note opening
  there covers the thing it is about; the right margin is the quietest part of the page.
  Successive notes cascade **down-and-left** so they do not walk off the viewport edge, and
  both axes are clamped for small windows. Position and size persist per note once dragged.
- The FAB is **draggable**; position persisted in `chrome.storage.local` under `snFabPos`.
  A tap toggles visibility; a drag repositions. Default position is top-centre.
- The FAB carries a **count badge** of notes on the current record.
- Note header buttons (✉ notify, ✕ delete, colour swatches) only work because dragging a
  note is bound to the bare header (`e.target === handle`) — otherwise pointer capture eats
  the child button clicks. Same gotcha applied to the draggable FAB. Don't regress this.
- **Key events must not escape the shadow host.** Aurena binds bare letters on the document
  (`h` home, `r` recent, `b` bookmarks, `/` search, `m`, `f`) plus `Alt+N` / `Alt+S`, and
  skips them only when `event.target` looks like a text field. Shadow-boundary
  **retargeting** defeats that guard: by the time the event reaches the document the target
  is the host `<div>`, not our `<textarea>`, so typing "h" in a note navigated home. A
  `stopPropagation()` on the host for `keydown`/`keypress`/`keyup` contains them. Our own
  handlers sit on inner elements and have already run by then. **This cannot stop a
  capture-phase listener on document/window** — if a shortcut ever leaks through while
  typing, that is why, and there is no fix from inside the shadow tree.
- **ResizeObserver persistence gotcha:** `makeResizeObserved` must (a) skip the initial
  observation, (b) ignore fires when `!el.isConnected` or size is 0, and (c) be
  `disconnect()`-ed before the element is detached. Without these it saved bogus sizes
  during navigation re-renders and notes shrank on return.

## Fragility / risks (tell the client)

- Unsupported extension surface: Aurena DOM/URL changes on upgrade can break record
  detection or the overlay. Mitigation is isolated to `recordContext.js` + the Shadow DOM.
- Custom LU REST naming (`Cf_` prefix, case flattening, `Objkey`) is not documented and was
  established empirically. Re-check after an IFS upgrade.
- Per-browser install + governance (who may install it).
- Notification depends on a Custom Event being configured; if it isn't, the extension
  silently writes notify fields that nothing acts on.

## Run

No build, no server.

```
npm run test:ifs     # unit-tests ifsStore against a stub fetch
npm run icons        # regenerate extension icons
```

Load `extension/` unpacked (chrome://extensions → Developer mode → Load unpacked), then
open an Aurena record. **Reloading the extension does not re-inject content scripts into
open tabs** — close and reopen the Aurena tab.

Use **Test connection** in the popup to probe read/write against the projection; it runs
`SN.ifsStore.probe()` on the active tab and reports back. To call it by hand from DevTools,
switch the Console **context dropdown** to the extension name first, or `SN` is
undefined.

## Conventions

- Content scripts share one isolated-world namespace `window.SN` (`SN.context`, `SN.config`,
  `SN.mentions`, `SN.ifsStore`), listed in `manifest.json` in dependency order.
- Per-note listeners must be torn down before the element is detached. `el._ro` is the
  ResizeObserver, `el._mt` the mention picker's teardown; both are called in `renderAll()`
  and `removeNote()`. Same gotcha, same discipline — don't regress either.
- Server field names live only in the `F` map in `ifsStore.js`; `toClient()`/`toIfs()` map
  to the camelCase shape the rest of the code uses.
- No secrets in the repo.
