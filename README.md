# Community Table

A mobile-first food-sharing prototype using Node.js 22+, Express, EJS, plain CSS/JavaScript, and MongoDB/Mongoose. The original green-and-white design, responsive phone shell, five licensed food photographs, and English/Amharic selector are retained.

One account can **share and receive food**. This replaces the earlier separate organizer/recipient requirement. The five sample foods, organizations, recipes, locations, and instructions are fictional. No real pickups or church partnerships are offered. About retains this explanation and photo credits.

## Run locally

```sh
npm ci
cp -n .env.example .env
```

Configure `MONGODB_URI` and a stable random `SESSION_SECRET` of at least 32 bytes in `.env`. Do not replace an existing configured file. MongoDB must be Atlas or a replica set with transactions; a standalone server is insufficient. Generate a new secret only for a fresh configuration:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```sh
npm run check:db -- --env-only
npm start
```

Open **http://127.0.0.1:3000**. If occupied, use `PORT=3001 npm start`. `npm run dev` watches JavaScript changes. Application entrypoints load the project-root `.env`; file credentials override stale shell credentials. Startup verifies indexes and a real transaction, and never seeds, migrates roles, or resets data. A failed database connection stops startup. Production requires HTTPS and `NODE_ENV=production`; set `TRUST_PROXY=1` only behind one trusted reverse proxy.

For a fresh development database only, `npm run seed:demo` inserts missing sample records. Repeating it never resets existing quantities or dates. The configured application database is `community_table`; tests always choose isolated random database names.

## Accounts and navigation

Every visitor sees **Browse, Share Food, My Pickups, Profile**. Guests can browse and read details. Posting and reserving require login through one signup flow, with no role choice or switch. Login/signup returns to an allowlisted internal GET page. Posting and reserving each require a checked confirmation; authentication never automatically submits either action.

Every signed-in account can post personal food, reserve another account's food, edit/pause its own personal listings, review pickups on those listings, and confirm collection. New listings record the authenticated owner; submitted owner/organization/role/image fields cannot grant authority. Self-reservations are rejected in the reservation transaction. Personal reservation views and cancellations query both the record ID and signed-in user. Owners review pickups through Share Food, without gaining the recipient's My Pickups or cancellation access.

My Pickups shows compact active cards with dish, status, quantity/provider, pickup dates/times and one View pickup action. America/Chicago is labelled once. Cancelled, collected, missed and expired pickups appear in a collapsed, keyboard-accessible History section with explicit statuses. Both ends of multi-day windows remain dated. Details retain pickup codes, locations, instructions and cancellation for active reservations. Cancelled details lead with “Reservation cancelled.”, retain historical dates/location, and omit usable codes and collection instructions. These are display changes only; stored states, inventory and cancellation rules are unchanged.

Public signup stores the internal legacy-compatible role `member`, hashes passwords with asynchronous salted scrypt (N=32768, r=8, p=3), and grants **no organization membership**. Legacy `recipient` and `organizer` accounts keep their IDs, hashes/passwords, histories, and stored role values; both can now share and receive. No password reset or account conversion is needed.

Sessions persist in MongoDB, with HTTP-only SameSite=Lax cookies, session/CSRF rotation on authentication, CSRF on every write, and persisted login/signup throttling. Private pages use no-store caching. Email delivery, verification, and password recovery remain unimplemented.

## Church and team access

Share Food links to organizations the account is authorized to manage. Organization memberships still independently grant **admin** or **volunteer** permissions. Admins edit events/listings, pause reservations, and explicitly grant/revoke volunteers. Admins and volunteers can review and confirm their organization's pickups. Volunteers cannot edit inventory, events, listings, or memberships. Every organization route and every write transaction rechecks the current membership and permission.

Legacy organizer memberships retain their previous access. Legacy recipient memberships that the previous model blocked remain stored and **inactive**, even if the user has reservation history. They are not automatically enabled by unified accounts. Explicit new grants set `Membership.accessGranted` for just the selected organization. Granting one membership cannot activate other legacy memberships. The old `migrate:account-types -- --apply` command is retired and performs no conversion.

Admins can look up an existing account by exact email and confirm the selected account to grant volunteer access. New users can receive a hashed, email-bound, seven-day, single-use invitation: they use the same signup/login flow, then explicitly accept. Signup alone never consumes an invitation or grants access. Invitation acceptance rechecks the creator's admin access, ignores submitted role/email/organization overrides, and grants only volunteer access to the bound organization. Emailing invitation links remains manual.

The explicit development-only `npm run dev:organizer -- --email account@example.test --slug fictional-kitchen --name "Fictional Kitchen"` command can grant a selected account admin access to a fictional organization. It preserves an existing account's password/history and never runs at signup/startup. New accounts require a privately prompted password or `DEV_ORGANIZER_PASSWORD`. Do not run it as part of the recording's personal sharing flow; no organization is needed.

`npm run migrate:organizations` remains an explicit legacy-linking operation. It skips personal listings and personal reservations, preserves IDs/inventory/snapshots, and never grants memberships.

## Food and reservations

Personal posting includes a required photo, dish name, description, portion size/quantity, ingredients or explicitly unknown ingredients, allergens as reported or unknown, pickup location/instructions, and a pickup window entered in **America/Chicago**. Unknown allergens are never interpreted as none. Dates reject nonexistent/ambiguous daylight-saving times. Organization listings also fit inside a selected event window. Existing reservation snapshots retain the original pickup information after listing edits.

Reservations are **first come, first served**. Old food-support/priority fields remain stored but have no eligibility effect; their forms/questions are absent. MongoDB transactions conditionally decrement inventory and insert reservations together. Unique indexes enforce one active reservation per account/listing, one request key per user, and globally unique 128-bit pickup codes. Concurrent requests cannot overbook. Lifetime per-account limits include active/collected/missed quantities; cancelled quantities are freed.

Same-key retries with the same listing/quantity return the existing reservation/code without decrementing again. Changed payloads with an old key return 409. A new key for an already active reservation also returns 409 before the cumulative portion-limit check. This fixes the failure formerly at `test/app.test.js:220`: two existing portions plus two requested exceeded the limit of three, causing 422 before the active-reservation unique index could reject the duplicate. The expected 409 was correct; the validation order was wrong.

Cancellation transactionally restores inventory once, before the saved pickup deadline. Cancelled-form replays never recreate a reservation. Collection requires a separate confirmation during the saved pickup window, changes active to collected once, and never deducts inventory again. Cancellation/collection races commit one outcome. Listing edits use revisions and cannot reduce total portions below committed quantities or undercut existing per-account commitments.

## Photos and languages

Uploads reuse the existing server image pipeline: one JPEG/PNG/WebP still image, maximum **5 MiB / 20 megapixels**, decoder validation rather than MIME/extension trust, metadata removal, WebP conversion, generated UUID filenames, thumbnails, and a local preview. SVG, HEIC, corrupt, oversized, and animated inputs are rejected. Failed saves remove newly created files; older photo versions stay available to reservation snapshots. Organization listings retain compatibility with existing placeholder images.

Private uploaded files live in ignored `var/uploads/food-photos/`. Back up that directory with MongoDB; hosting requires persistent storage. Git includes only the licensed sample assets. Sources, creators, licenses, crops, and hashes are in [the photo manifest](src/data/food-photos.json) and [image licenses](public/images/foods/LICENSES.md), with attribution in About. The adapted doughnut photo retains CC BY-SA 4.0 terms.

Only the selected UI/listing language is displayed, with field-by-field fallback when a translation is missing. The language cookie persists across login/logout. User-entered text is preserved. New interface wording has Amharic translations; independent native-speaker review is still needed. Physical phone camera/keyboard behavior has not been verified.

## Recording preparation

See [REHEARSAL.md](REHEARSAL.md) for the two-account recording checklist.

The October 25 inspection found all five samples open and stocked, with the correct existing photos, but their listing **and event** pickup windows had expired on October 9–10 in Chicago. Browse correctly filters closed/paused/expired/out-of-stock listings and expired/paused events. The insert-only seed intentionally does not renew old windows, so reseeding would not fix visibility.

```sh
npm run demo:recording
npm run demo:recording -- --apply
```

The first command reports the selected database, Chicago dates, exact sample IDs, photos, status, inventory, event eligibility, and visibility, without credentials or user details. Apply saves a private local backup under ignored `.cache/recording-backups/`, then transactionally refreshes **only the five exact fictional sample slugs** and their dedicated fictional events for today 00:00 through tomorrow 23:59 Chicago time. On October 25 this covers **October 25–26, 2026**. Non-demo/shared events cause a rollback instead of broad updates.

Sample IDs, photos, recipes, reservation history/codes/snapshots, user passwords, and memberships remain unchanged. If available portions are low, the command adds the same delta to total and available stock, preserving reserved/collected/missed commitments. The day's stock marker prevents repeated replenishment on the same Chicago date. Historical reservation windows are never extended. This is an explicit development command, disabled in production, with no scheduled or startup changes.

## Verification and Git backup

```sh
npm test
```

Tests use real MongoDB 7.0.24 replica sets and temporary uploads, never application data. The initial run downloads a test binary into ignored `.cache/`. Alternatively `TEST_MONGODB_URI` selects a dedicated test server; both modes create and drop only randomly named databases with the `community_table_test_` prefix, within Atlas's 38-byte name limit. Tests do not use the application's `MONGODB_URI` automatically.

Coverage includes guest direct requests, common signup/redirects and explicit confirmations, personal post/receive/ownership, self-reservation denial, legacy account login/persistence, organization admin/volunteer and cross-organization checks, quarantined legacy memberships, invitation tampering/revocation/concurrency, overbooking, duplicate requests and exact inventory effects, cancellation/collection races, revisions, photo validation/persistence/snapshots, bilingual fallback, DST, and demo refresh preservation.

October 25 verification: **64/64 integration/configuration tests passed**, with no failures/skips, using isolated real replica-set databases. The browser completed signup → photo preview/post → second-account reserve → first-account collect, then the posting account also reserved/cancelled another food. Inventory moved 5 → 3 and remained 3 after collection. **88 final page checks passed** across both languages at actual CSS viewports 390×844, 375×667, 1280×900, and 800×240: all five photos loaded, no horizontal overflow, and navigation stayed visible. A narrow-form grid sizing fix preserves the visual design. A private-backup comparison confirmed existing users/password hashes, memberships, organizations, invitations and reservation records unchanged, with original sample IDs/photos/stock preserved and unrelated listings untouched. Physical-device camera/keyboard behavior and native-speaker linguistic review remain unverified.

The local pre-edit Git checkpoint is tagged `checkpoint-before-unified-accounts` (commit `646092f`). `.env`, private environment files, uploads, database files, keys, dependency folders, caches, and test output are ignored. Never commit the private recording backup or credentials. The safe `.env.example` and licensed sample images/credits are tracked. No force-push is used.

GitHub CLI is available locally under `.cache/tools/`. An existing macOS Git Keychain credential can be used without printing or committing it. This computer's default home `.config` directory is owned by root; if browser sign-in is needed, use the ignored local GitHub config directory:

```sh
GH_CONFIG_DIR="$PWD/.cache/gh" .cache/tools/gh_2.103.2_macOS_amd64/bin/gh auth login --hostname github.com --git-protocol https --web
```

Complete browser authentication with your own GitHub account; do not paste tokens or passwords into chat. The handoff should use an existing private repository, or create a private `community-table` repository when none exists, and push a new branch if existing remote history differs.
