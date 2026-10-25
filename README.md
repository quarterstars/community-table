# Community Table

A mobile-first Congressional App Challenge project using Node.js, Express, EJS, plain CSS/JavaScript, and MongoDB/Mongoose.

Recipient accounts, persistent reservations, and organization-specific admin/volunteer workflows use MongoDB. Food listings, organizations, illustrations, and instructions remain fictional demo content. Do not travel to these fictional pickup locations.

## Submission rehearsal

See [REHEARSAL.md](REHEARSAL.md) for exact start/login steps, today's fictional event, a photo → reserve → collect/cancel walkthrough, and photo-storage limitations. The real Atlas rehearsal event for October 18, 2026 is attached to the existing organizer admin; no existing listings or reservations were reset.

## Configure and run

Node.js 22 or newer and npm are required. This workspace already has Node.js v22.22.3 and npm 10.9.8. Install the Node.js LTS release from https://nodejs.org/ on a machine missing them.

MongoDB must support transactions: use a MongoDB Atlas cluster or a local replica set. A standalone `mongod` is insufficient. Startup verifies the connection, required unique indexes, and a real transaction before enabling accounts/reservations. It never seeds or resets listings during startup. See the [MongoDB transaction deployment requirements](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/).

```sh
cd "/Users/abebedesalegn/Downloads/community table"
npm ci
cp -n .env.example .env
```

Edit `.env` with your actual `MONGODB_URI` and a random `SESSION_SECRET`. Generate the secret locally:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste the result as `SESSION_SECRET` in `.env`. Keep that secret stable across restarts so existing sessions remain valid. Do not replace an already configured `.env`. `.env`, other private environment files, local database files, and test binary caches are ignored by Git; `.env.example` is safe to commit. The application does not print credentials or complete connection strings in errors.

Every application/development entrypoint loads the **project-root** `.env` before reading configuration, independent of the terminal's working directory. File values for `MONGODB_URI` and `SESSION_SECRET` override stale exported shell values. Other explicit shell settings, such as `PORT` and `NODE_ENV`, take precedence over the file. `.env.example` is never loaded at runtime; no hardcoded URI supplies credentials.

Test the configured connection and transactions without printing secrets:

```sh
npm run check:db -- --env-only
```

This reads configuration directly from `.env` to isolate shell overrides and prints exact errors after redacting URI credentials and the session secret. Without `--env-only`, it checks normal runtime configuration and reports which stale shell credential keys were replaced, without their values. Atlas SRV DNS normally supplies `authSource=admin`; do not change it to the application database name.

Latest real Atlas verification (October 8, 2026): **connected successfully using the project-root `.env` directly**, with required indexes and a real transaction verified. The updated database password resolved the earlier code 8000 authentication error. No authentication or network restrictions were weakened. The explicit migration completed (no legacy relationships needed adding), and the seed inserted three fictional future-window listings without resetting existing records. The application started successfully at http://127.0.0.1:3000. Signup, logout/login, recipient organizer denial, reservation, duplicate submission, repeated cancellation, restored inventory, and persistence after reconnecting also passed against a separate isolated Atlas test database, which was removed afterward; application records were untouched by these checks.

For Atlas, create a database user and allow your device's IP in network access, then use the provided connection string with a database name such as `community_table`. Percent-encode special characters in the database password when putting it into a URI. A MongoDB username/password differs from your Atlas website login. Follow the [Atlas connection guide](https://www.mongodb.com/docs/atlas/connect-your-application/).

If using a local MongoDB installation, start a development replica set in one terminal:

```sh
mkdir -p .local-mongodb
mongod --dbpath .local-mongodb --replSet rs0 --bind_ip 127.0.0.1
```

In a second terminal, initialize that new replica set once:

```sh
mongosh --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
```

Use this local URI in `.env`:

```text
MONGODB_URI=mongodb://127.0.0.1:27017/community_table?replicaSet=rs0
```

MongoDB tools are not installed system-wide in this workspace. Either use Atlas or install MongoDB Community Server and `mongosh` using the [official installation instructions](https://www.mongodb.com/docs/manual/installation/). The automated test runner downloads its own test-only MongoDB binary; that does not configure your normal application database.

After `.env` is configured:

```sh
npm run seed:demo
npm run migrate:organizations
npm start
```

Open **http://127.0.0.1:3000**. Stop the server with Ctrl+C. Use `PORT=3001 npm start` and http://127.0.0.1:3001 if port 3000 is busy. `npm run dev` restarts the server when imported JavaScript changes; refresh after stylesheet/template edits.

Missing credentials, a weak session secret, a failed connection, unavailable indexes, or unsupported transactions stop startup with a setup message. There is no in-memory/static fallback and no fake successful connection. If MongoDB becomes unavailable while running, writes fail with an honest error; check My Pickups before retrying an uncertain request.

## Explicit development seeding

`npm run seed:demo` inserts five bilingual fictional listings (doro wat, misir wot with injera, atkilt wot with injera, glazed donuts and fruit cups) with a fictional Sample Kitchen organization and events into MongoDB, with pickup starts at least 24 hours ahead and two-hour windows. Each listing has a three-portion per-account limit. Existing listings are skipped entirely; legacy relationships are added only by the migration below. Display dates and times always use America/Chicago, including daylight saving changes.

The seed command uses insert-only upserts: repeating it never resets quantities, replaces listings, extends existing windows, or clears reservations/accounts. It is disabled with `NODE_ENV=production`. Once existing demo windows expire, use a separate fresh development database for a fresh demonstration; do not reset a database containing reservations. The Browse screen displays an honest empty state if there are no open, unexpired listings with remaining portions.

## Demonstration food and bilingual listing text

The five current examples have recipe-specific ingredients/allergens, clearly defined portions and fictional pickup instructions in English and Amharic. The working language selector switches navigation, forms, validation, errors, statuses, Chicago dates and listing/reservation text between English and Amharic. The selected language persists in a cookie across login/logout. Only the selected language is rendered, with field-by-field fallback to the other language when text is missing. Doro wat includes chicken, egg and milk butter without injera. Both injera meals explicitly use teff-and-wheat injera and are **not gluten-free**. The lentil recipe uses olive oil/berbere; the vegetable recipe uses canola oil/turmeric. Donuts contain wheat/milk/egg; fruit cups contain apple/orange/grapes/lemon juice without toppings. Cross-contact is explicitly unknown. These are descriptions of specific fictional recipes, not universal claims about these foods. Amharic text is a draft and has not had independent native-speaker review.

All five sample dishes now use relevant openly licensed photographs stored locally as optimized WebP files. New organizer listings also start with a neutral placeholder. Customized listing images and existing reservation snapshots are preserved. The persistent demo-listings banner is removed. **About** in the header opens `/about` with: “Prototype with sample food listings. No real food pickups are offered.” No church or other organization partnership is confirmed.

Five new records were added without deleting/resetting existing listings, reservations or inventory. After new samples are present, Browse omits the three superseded seed examples (`lentil-stew`, `roasted-vegetable-bowls`, `bread-and-fruit`) only when marked as demo data; other organizer listings remain visible. Old detail URLs and saved pickups continue to work. Repeating the seed inserts nothing and does not modify existing organization/event timestamps.

English remains in the original fields for backward compatibility. Optional `translations.am` stores listing text; older English-only data stays readable. Reservation snapshots include the translated pickup instructions. Organizer forms provide optional Amharic fields. Inventory/status edits preserve translations. Recipe/pickup text changes submitted without Amharic fields clear stale translations; explicitly unknown English ingredient/allergen information cannot retain contradictory Amharic reports. New reservations snapshot current text; existing reservation snapshots are never rewritten.

## Accounts and security

Anyone can browse. Public signup creates **recipient** accounts only, regardless of submitted role fields. Passwords use asynchronous Node.js scrypt with a random salt, N=32768, r=8, p=3, and a 64-byte derived key. The stored hash includes its parameters. This matches one of the [OWASP recommended scrypt configurations](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Password hashes are excluded from ordinary user queries and never rendered.

Sessions live server-side in MongoDB through `express-session` and `connect-mongo`; the browser gets an HTTP-only, SameSite=Lax session ID cookie with a seven-day lifetime. Login/signup rotate the session ID and CSRF token. Logout is a CSRF-protected POST that deletes the stored session. Authenticated pages use `Cache-Control: no-store`.

Every state-changing request requires a random synchronizer CSRF token tied to the server-side session, including signup, login, logout, reserve, and cancel. Login is limited to 10 requests per IP per 15 minutes; signup to 30 per IP per hour. Rate-limit counters are atomic MongoDB records that survive server restarts and are shared by app instances using the same database.

In production, use HTTPS and `NODE_ENV=production`; session cookies then require HTTPS. Set `TRUST_PROXY=1` only when deployed behind exactly one trusted reverse proxy, otherwise keep `0`. Uploads, email notifications, and email verification/password recovery are deferred.

## Reservation guarantees

A reservation must be a positive whole quantity, within current inventory and the listing's per-account limit. An account can have one active reservation per listing. Collected/missed quantities continue to count toward the account's limit; cancellation frees the cancelled quantity. A new intentional reservation requires a new form key. Paused/closed listings or events and expired pickup windows reject new reservations.

`src/services/reservations.js` uses a Mongoose/MongoDB transaction to decrement inventory conditionally and insert the reservation together. Concurrent requests contend on the listing write; a transaction retry sees the new inventory. Unique database indexes enforce one active reservation per user/listing, one request key per user, and globally unique pickup codes. Codes contain 128 unpredictable random bits.

Each reserve form has a UUID request key. Repeated posts with the same user/key and same listing/quantity return the same saved reservation; the same key with a different listing/quantity is rejected. Retrying an old cancelled reservation never reserves again. JavaScript disables a submitted button for convenience; the database guarantees also work without JavaScript.

Cancellation of an active reservation is allowed before the saved pickup deadline. Collected/missed reservations cannot be cancelled. A transaction changes `active` to `cancelled` and restores exactly that quantity to inventory. Repeated or concurrent cancellation returns the cancelled record without another inventory increment. Reservation history is retained; records are never deleted to implement cancellation. If any part fails, both changes roll back.

My Pickups shows only the logged-in account's saved reservations, quantities, pickup codes, dates, locations, and instructions. Individual reservation views and cancellations always query both the reservation ID and the authenticated user ID. Another user's ID returns 404, and their code never appears in your pickups. Reservation records snapshot the listing details and pickup window so instructions remain available across app restarts.

## Separate account types and organizer setup

Every account has exactly one type: **recipient** or **organizer**, stored in `User.role`. Organization memberships independently grant **admin** or **volunteer** permissions. There is no mode switch. Someone who distributes and receives food needs two accounts with different emails. Public signup always creates recipients and ignores submitted roles/memberships.

Recipients have Browse, My Pickups, and Profile. They can reserve and cancel only their own reservations. Organizers have Dashboard, Listings, Pickups, and Profile. Organizers can inspect public food details, but cannot reserve, cancel, or access personal pickups. Login redirects to the account's own home. Every request checks the account type and current organization membership; every reservation/organizer write also checks the type inside its transaction. User and membership version writes serialize permission changes with concurrent operations.

Create a **new, separate organizer account** in development:

```sh
npm run dev:organizer -- --email separate-organizer@example.com --account-name "Demo Organizer" --slug cedar-neighborhood-kitchen --name "Cedar Neighborhood Kitchen"
```

Replace the email with a different email from any recipient account. For a new organizer the command prompts privately for a 12–128 character password; it does not echo it or accept a password command-line argument. Automation may provide `DEV_ORGANIZER_PASSWORD` in the environment. The command hashes the password, creates an organizer account and grants admin membership in a fictional organization. Existing organizer accounts may receive another membership without password changes. Recipient emails are rejected without converting or deleting their accounts/history. The command refuses to run with `NODE_ENV=production` and never assigns roles during public signup.

Log in at http://127.0.0.1:3000/login. An organizer with one membership goes directly to that organization's dashboard; an account with multiple memberships chooses an organization. Profile shows the organizer account type, memberships, organization roles, and logout. Changing organization never changes account type.

- Admins create/edit events and food listings, pause/resume new reservations, manage existing organizer volunteers, and create new volunteer invitations.
- Volunteers and admins review their organization's reservations, look up pickup codes, review the recipient/quantity, and explicitly confirm collection during the saved pickup window.
- Volunteers cannot edit events/listings/inventory, pause reservations, create invitations, or manage memberships. Recipients cannot access organizer routes even if legacy memberships remain. Revocation applies on the next request.

In **Dashboard → Volunteers**, an admin can create a volunteer invitation for a new organizer email after confirming the address. A private link is shown for manual sharing; email notifications remain deferred. The link expires after seven days, is single use, and its random token is stored only as a SHA-256 hash. The invite fixes the organization, email and volunteer permission; submitted role/email/organization fields cannot override them. Open it while logged out and set the new organizer's name/password. An existing recipient email is rejected; no account is converted. Existing organizers can be added/removed as volunteers through the exact-email lookup and explicit selected-account confirmation. This interface cannot grant/remove admin membership.

The dashboard shows available, reserved, collected, and missed portions. Availability includes paused inventory; missed/collected portions are not automatically returned. Create an event before adding food. Forms preserve explicitly unknown ingredient/allergen information and interpret dates in America/Chicago. DST times that are nonexistent/ambiguous are rejected. Pickup windows must fit their event. Saved reservations preserve their original pickup information.

Inventory edits use transactions and submitted revisions; stale edits return 409. Quantity cannot be lowered below reserved + collected + missed portions. Per-account limits cannot undercut existing commitments; committed listings cannot move to another event. Pausing blocks new reservations while preserving saved pickups/cancellations.

Pickup lookup is scoped to the organization. Separate explicit confirmation atomically changes active → collected and records the organizer without deducting inventory again. Repeated/concurrent collection, canceled, expired/missed, already-collected and not-yet-started pickups are rejected. Collection/cancellation racing each other has one committed outcome and the correct inventory.

## Account type migration and conflicts

Existing recipients remain recipients. No account-type changes run at startup. Audit old accounts first:

```sh
npm run migrate:account-types
```

The read-only audit reports recipient accounts with memberships and their reservation-history counts. **Any reservation history, including canceled/collected/missed records, is a conflict.** An existing organizer with recipient history is also a conflict. Apply only if there are no conflicts:

```sh
npm run migrate:account-types -- --apply
```

The transaction checks again and stops all conversion if any conflict exists; it never splits users, transfers/deletes history, removes memberships, or resets inventory. It converts only history-free legacy member accounts to organizers and preserves IDs, timestamps and memberships. Reservation transactions touch the same user so a concurrent reservation cannot silently race past conversion. Re-running is safe.

The October 8 configured-Atlas audit found one recipient account with organizer membership and **one reservation in its history**. This conflict was reported before migration. Its recipient account, reservation and membership were left unchanged, and no account-type migration was applied to the real database. Under the new authorization rules this account retains recipient functionality and its legacy membership cannot grant organizer access. Use a separate organizer account/email for distribution. Resolving or transferring legacy membership requires an explicit decision; this revision does not make that decision for you.

## Explicit organization migration

Before using organizer pickup lookup for old listings/reservations, run:

```sh
npm run migrate:organizations
```

This is an explicit, rerunnable command, never a startup hook. It adds organization/event references to legacy listings and the corresponding organization reference to historical reservations. Existing fictional organization names are grouped consistently, with one new event per legacy listing. New event bounds encompass the original pickup window. It preserves listing/reservation IDs, names, inventory, quantities, codes, pickup dates, saved instructions, statuses, timestamps, and recipient roles. No reservation or account is deleted. Each listing's relationships and reservation backfill use a transaction; a rerun completes a partial migration. It stops on invalid pre-existing references/orphaned historical reservations instead of resetting them. Membership is not granted by migration; use the explicit development command for a separate organizer account.

Old records remain available in recipient flows before migration; organizer access to them requires migration. There is no automatic assignment of historical food to a newly created demo organization. To administer a migrated organization, pass its slug to `dev:organizer` as in the seeded organization example.

## Main files

- `server.js`: loads `.env`, validates configuration, connects/verifies MongoDB, and starts the server.
- `src/config.js`, `src/db.js`: environment validation, replica-set/transaction check, and index creation.
- `src/models/index.js`: users, organizations, memberships, events, listings, reservations, and unique indexes.
- `src/app.js`: EJS/static setup, persistent session store, security middleware, routing, and safe errors.
- `src/routes/auth.js`: signup, login, logout, password validation, and persistent rate limiting.
- `src/routes/pages.js`: existing Browse/Details/My Pickups/Profile routes and protected reservation routes.
- `src/services/reservations.js`: transactional reservation/cancellation and request replay handling.
- `src/routes/organizers.js`, `src/services/organizers.js`: organization permissions, dashboard/forms, confirmed volunteer changes, inventory editing, pause controls, and atomic collection.
- `src/services/accounts.js`, `src/routes/invitations.js`: exclusive account types, conflict-safe migration and private volunteer invitation creation/acceptance.
- `src/services/development.js`, `scripts/organizer-admin.js`, `scripts/migrate-organizations.js`, `scripts/migrate-account-types.js`: dedicated development organizer account creation and explicit preservation/audit of legacy relationships.
- `scripts/check-db.js`, `src/lib/redact.js`: direct-file configuration diagnostics and credential-redacted errors.
- `src/middleware/security.js`, `src/lib/`: CSRF, login guards, session rotation, password hashing, rate counters, and Chicago date formatting.
- `scripts/seed-demo.js`, `src/data/sample-foods.js`: explicit insert-only development seeding; static data is used only here, never as the live listing source.
- `views/about.ejs`: prototype About note and photo source, author, license and adaptation credits.
- `views/organizer/`: organization chooser, dashboard, Listings screen, event/listing forms, volunteer confirmation/invitations, pickup lookup/list/review. Other views preserve recipient screens.
- `public/css/styles.css`, `public/js/app.js`: original responsive design with matching form/pickup styles and progressive quantity/form enhancements.
- `test/*.test.js`: real isolated-database integration tests and configuration checks.

The original app design is preserved: readable system fonts, white interior, green actions, and account-specific bottom navigation. Above 600px it has the 430px shell with a 4px charcoal border, 32px corners, internal scrolling, and a pale-green background. At 600px and below it fills the screen without a shell. Existing sample images retain their credits. Organizers can now add a validated food photo to a listing; new listings without a photo use a neutral placeholder.

## Test safely

```sh
npm test
```

By default the tests start a **real MongoDB 7.0.24 replica set** using `mongodb-memory-server`, WiredTiger, local ephemeral ports, and temporary data. A first run may download the MongoDB binary to ignored `.cache/mongodb-binaries/`. No mock database, mocked transaction, or fallback success is used.

Alternatively set `TEST_MONGODB_URI` to a dedicated test replica-set server. Tests never read `MONGODB_URI` to choose their database. Both modes generate a new database with the `community_table_test_` prefix and a random 64-bit hexadecimal suffix, verify the name, and delete only that database during cleanup. Names stay within Atlas’s 38-byte database-name limit. Do not give tests credentials for a production MongoDB server, even though the database name is isolated. Tests fail rather than pretending to pass if MongoDB cannot launch or connect.

The test suite covers signup/login/logout, password hashing, recipient-only signup, session/CSRF rotation, persistent sessions/accounts/reservations after reconnecting/rebuilding the app, successful reservations and pickup information, concurrent last-portion and multi-portion requests, simultaneous duplicate submissions/replays, repeated/concurrent cancellations, reservation replay after cancellation, per-account limits, invalid quantities, expired/closed listings, expired cancellation, another user's reservation, transaction rollback on a real insert failure, persistent login throttling, idempotent future-window seeding, unknown ingredient/allergen information, Chicago daylight saving dates, assets, and configuration failures. Organizer integration tests cover recipient and cross-organization denial, admin/volunteer permissions, event/listing creation and edits, clearing allergen reports to unknown, exact-email account confirmation, access revocation, email reuse without inherited membership, concurrent quantity edits/reservations, competing edits, repeated/concurrent collection, collection racing cancellation, paused events/listings, ineligible pickups, dashboard totals, preservation/idempotence of migration, development-only grants, and CSRF on every organizer write.

Previous-stage verification passed 40 local tests and 17 isolated Atlas organizer tests. The separate-account revision extends this suite with distinct recipient/admin/volunteer accounts, account-specific navigation, organizer reservation/cancellation denial (routes and services), conflict-preserving migration, invitation authorization, bound email/role/organization, single-use concurrency, expired links, and recipient-email rejection. All **46 distinct tests were verified across a full 44-test run and targeted runs**: the full run passed 43 tests and found one isolated template-rendering issue; after fixing that issue, its targeted rerun and two additional migration/invitation race checks passed, with zero failures/skips. Chrome tested separate admin, invitation-created volunteer and recipient accounts at 390×844, 375×667, 1280×900, 1280×360 and 800×240. Navigation, no mode-switch controls, 44px targets, overflow, viewport shell height, bottom-nav clearance, invitation acceptance, quantity/reserve/cancel and visible keyboard focus passed; screenshots were reviewed. Test databases and the browser preview were cleaned up. Account-type audit of the real Atlas database reported the conflict above and made no data changes. The normal app was restarted against Atlas to load the new authorization rules. Mobile keyboard behavior on physical devices has not been tested.

Normal-app configuration belongs in the ignored `.env` file, using a valid `MONGODB_URI` and a random `SESSION_SECRET`. Successful isolated tests do not verify your application database credentials. If Atlas reports authentication failed, check the database user's credentials in Atlas Database Access and update the URI in `.env`; that user is separate from your Atlas website account. See the [Atlas connection troubleshooting guide](https://www.mongodb.com/docs/atlas/troubleshoot-connection/).

Sample-content revision verification: eight targeted checks passed for bilingual recipes, About, neutral placeholders, seeding, snapshots, assets and separate-account behavior. Four subsequent checks passed after fixing multiline ingredient parsing and protecting seed metadata timestamps, including bilingual organizer edits and preservation. Three final Browse/recipe/preservation checks passed (zero failures/skips). Chrome verified Browse, all five detail pages and About at 390×844, 375×667, 1280×900, 1280×360 and 800×240: five current sample cards, no demo banner, readable Amharic text, neutral placeholders, no horizontal overflow and content/nav clearance. Screenshots were reviewed. The normal app remains running at http://127.0.0.1:3000.

### First come, first served reservations

Food-support preference controls and priority opening controls/messages are removed. Reservations are first come, first served for every recipient while the listing/event is open and the pickup deadline has not passed. Server-side inventory, per-account limits, separate account types, cancellation deadlines and collection windows remain enforced. Old priority/preferences fields remain stored but are never read for eligibility or modified by the removed forms. No migration or reset is required.

The Amharic UI catalogue is `src/lib/i18n-am.json`; server helpers live in `src/lib/i18n.js`. Older or organizer-authored content without an Amharic translation falls back to the original English. Amharic wording still needs independent native-speaker review. With JavaScript enabled, browser form validation uses the selected app language; without it, native validation dialogs use the browser language while server errors remain translated.

Historical language/priority verification (priority behavior has since been removed): `npm test` passed all **54 tests**, zero failures/skips, using isolated real MongoDB 7 replica-set databases. Checks include private preference/CSRF/account-type enforcement, forged eligibility rejection, before-priority/general-opening behavior, malformed/disabled/legacy windows, last-portion concurrency, inventory-edit races, post → reserve → code lookup → confirm once, cancellation/retries, translated forms/navigation/statuses/errors and language persistence. Existing organization/account/reservation regressions also passed. Chrome checked both languages across Browse, all five details, login/signup, Profile, My Pickups and About at 390×844, 375×667, 1280×900, 1280×360 and 800×240. Browser interactions verified Amharic validation, preference saving, quantity announcements, reserve/cancel, organizer navigation/forms and priority controls. Short desktop windows scroll the header/language controls together with content so navigation remains visible. Screenshots were reviewed; browser test data was cleaned up. The real app was restarted and returned HTTP 200 with five cards and the language selector. No application food, account or reservation records were changed by this verification. Physical-device keyboards and independent Amharic linguistic review remain unverified.

### Selected-language display and local food photos

Browse, Food Details and pickup cards render each field once in the selected language, including food/organization names, recipes and pickup information. Missing or blank text falls back individually to the other language. The English and Amharic selector remains available. Account data, original listing text and reservation snapshots are not rewritten for display.

`src/data/food-photos.json` records each source, creator, verified license, download URL, crop, derivative file size and SHA-256. Photos are downloaded locally, cropped/resized and converted to WebP; five 176×176 square thumbnails use the same centered crop convention. Full images are under 100 KB and thumbnails under 11 KB. About provides source/license links and credit, including share-alike terms for the adapted doughnut photo. Example photographs can differ from the listed recipe or portion; ingredients/allergens remain the specific sample recipe statements. No source, photographer, USDA or other organization partnership/endorsement is implied.

Sources and reuse terms, verified October 8, 2026:

| Food | Creator | Source | Reuse terms |
| --- | --- | --- | --- |
| Doro wat | USDA, Food and Nutrition Service | [Commons source](https://commons.wikimedia.org/wiki/File:MyPlate_gov_Cultural_Food_(20241025-USDA-FNS-UNK-0018).jpg) | Public domain, U.S. federal government work |
| Misir wot with injera | Andy Li | [Commons source](https://commons.wikimedia.org/wiki/File:Misir_Wot_and_Gomen_Besiga_-_Abyssinia,_Brighton.jpg) | CC0 1.0 |
| Atkilt wot | psd | [Flickr source](https://www.flickr.com/photos/45581782@N00/54292996570) | CC BY 2.0; original page's current JSON-LD/footer license verified |
| Glazed doughnuts | Famartin | [Commons source](https://commons.wikimedia.org/wiki/File:2019-01-29_14_04_42_A_glazed_doughnut_in_the_Franklin_Farm_section_of_Oak_Hill,_Fairfax_County,_Virginia.jpg) | CC BY-SA 4.0; adapted images retain the same license |
| Fruit cups | USDA Photo by Bob Nichols | [Commons source](https://commons.wikimedia.org/wiki/File:Kiwi-and-orange_fruit_cups_for_students_in_the_National_School_Breakfast_Program_(Arlington,_VA,_USA_-_19-10-2011).jpg) | Public domain, U.S. federal government work; requested photographer credit retained |

Apply only the new photo metadata to already seeded fictional listings:

```sh
npm run update:sample-photos
```

The explicit command transactionally updates only the five exact sample slugs with the known neutral placeholder. It does not reseed/reset data, change IDs/inventory/pickup windows/account records, or rewrite reservation snapshots. Customized images are skipped. Listing revisions increment so stale organizer edits cannot overwrite a concurrent change; running the command again changes nothing. Fresh seeding uses the new photo metadata automatically.

Selected-language/photo verification: all **56 tests passed**, zero failures/skips, using isolated real MongoDB replica-set databases. New checks cover selected-language names/organizations and every detail field, fallback in both directions, all local image responses and About credits, and an idempotent photo migration that preserves account/reservation/event records and listing IDs/inventory/windows/recipe text. Chrome checked both languages across Browse, five details and About at 390×844, 375×667, 1280×900, 1280×360 and 800×240: no duplicate language content, every photo loaded, square thumbnails, readable content, linked license/creator credits, no horizontal overflow and visible navigation. Crops/screenshots were reviewed. The real metadata command updated five placeholder images; before/after verification confirmed all accounts, reservations, organizations, memberships and events unchanged, and all other listing data unchanged apart from photo fields/revisions. The app was restarted against Atlas; read-only English/Amharic checks returned the five photos, selected food names only and About license links. Original reservation snapshots retain their original image metadata.

### Focused misir wot image correction

The misir photo now shows lentil stew served on injera, using Andy Li's Commons photo above under CC0 1.0. The supplied reference was not reused because its source/reuse permission was not established. Separate crops frame only the upper plate's lentil stew and injera, excluding the other dish, people and surrounding tabletop. English/Amharic alt text and About credits follow the corrected image. The other four food photos and their metadata remain unchanged.

For an existing demo listing using the earlier pot photo, run:

```sh
npm run update:misir-photo
```

This explicit, idempotent transaction changes only the misir listing's image path, English/Amharic alt text and revision. It skips customized images. Listing IDs, inventory, recipe text, pickup dates, accounts and reservations are preserved. Versioned filenames avoid stale cached photos; the old files and their documented attribution remain available for unchanged historical reservation snapshots. Fresh demo seeds already use the corrected image; no reseeding is necessary.

Verification for this correction: three targeted isolated-MongoDB tests passed with zero failures/skips, including preservation/idempotence, selected-language display and local photo credits. Chrome checked the actual Browse thumbnail and Details image in both languages at 375×667, 390×844 and 1280×900 (12 successful page checks). Both rendered image sizes were visually inspected: lentil stew and injera remain visible and centered. The other four manifest records and asset hashes were compared with their prior versions and were unchanged. The real Atlas command updated exactly one listing; before/after comparisons confirmed that all other listing fields/listings, accounts, reservations, organizations, memberships and events were unchanged. The app was restarted, and read-only English/Amharic checks verified corrected photos, alt text and source/license credits. The isolated browser preview/database was cleaned up.


### Submission changes and verification (October 18, 2026)

- Removed priority/support controls and eligibility checks from recipient Profile, organizer listing forms, Food Details and reservation transactions. Old fields remain unused in MongoDB. Per-account commitments, inventory transactions, idempotence, organization scope, CSRF and pickup-window checks remain enforced.
- Added `src/lib/food-uploads.js`, route-scoped bounded multipart parsing, image-content validation/re-encoding, random local filenames, persistent `var/uploads/food-photos/` storage and optimized thumbnails. `src/app.js` serves those files. `src/services/organizers.js` preserves existing photos on ordinary edits, uses a neutral placeholder for new listings without photos, and applies replacements within the inventory transaction. Old versions remain for saved reservation snapshots; failed saves remove new files.
- Updated `views/organizer/listing-form.ejs`, `public/js/app.js` and small CSS additions for an optional native file picker and local preview; updated English/Amharic labels/errors. No profile-photo feature was added. Simplified only the table logo in the shared icon/favicon; the Profile person icon is unchanged.
- Added the explicit, development-only `scripts/prepare-rehearsal.js` / `npm run demo:rehearsal` command and `REHEARSAL.md`. It attaches a missing date-specific fictional event to an existing organizer admin without resetting any other data.

Verification: **60 distinct automated tests passed across the organizer suite and recipient/configuration runs** using isolated real MongoDB replica sets. The organizer suite passed all 32 tests. The recipient/configuration run initially passed 27 of 28 and caught a per-account validation check removed with priority behavior; that check was restored, its targeted rerun passed, and all organizer limit/concurrency/collection tests then passed. The new photo flow also passed its targeted rerun after correcting a test's expected pickup location to match the submitted listing. Coverage includes actual image decoding, corrupt/SVG/non-image/oversized/over-dimension inputs, CSRF, unauthorized uploads, stale-edit cleanup, file/app recreation persistence, preservation of old snapshots, neutral fallback, first-come behavior with legacy priority fields, code lookup, repeated collection/cancellation, and additive rehearsal setup.

Chrome used separate disposable organizer/recipient accounts and a fresh isolated database to select an actual file, inspect the preview, create a photo listing, reserve two of five portions, view the code in My Pickups, cancel twice (inventory returned to five once), reserve again and confirm collection (inventory stayed three; repeated confirmation returned 409). Browse/Details/upload preview screenshots were visually reviewed at phone sizes, plus desktop and a short window: 390×844, 375×667, 1280×900, 1280×360. Photos loaded, layout had no horizontal overflow, the table mark and Profile person remained readable, and no JavaScript exceptions were reported. The browser controller needed selector/navigation fixes during rehearsal; these were confined to the temporary test harness, not app behavior.

The Atlas event command created exactly the requested October 18 rehearsal event under the existing organizer's fictional organization. Before/after comparisons confirmed existing listing/event/reservation/organization/account data was preserved, apart from normal organizer authorization counters/timestamps. All five sample-photo file hashes remain unchanged. The isolated browser preview database and uploaded test files were cleaned up after verification. The updated real app started with verified Atlas transactions and returned HTTP 200. No real recipient reservations were created by testing. Persistent hosting storage and device camera behavior are described in REHEARSAL.md; physical-phone camera selection and HEIC are not verified/supported.
