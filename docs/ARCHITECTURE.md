# Architecture and operations

## Accounts and permissions

Guests can browse and view food details. Posting and reserving require authentication and an explicit confirmation. Login/signup returns to an allowlisted internal page without submitting an action automatically.

Every signed-in account can share personal food and reserve someone else's listings. Ownership checks run on the server: users can edit/pause their personal listings, view/cancel their own reservations, and confirm collection on listings they own. Self-reservations are rejected.

Organization memberships independently control church/team access. Admins manage events, listings, and volunteers. Admins and volunteers can review and confirm their organization's pickups. Volunteers cannot edit inventory, events, listings, or memberships. Organization operations recheck permission inside write transactions.

Legacy accounts retain their IDs, password hashes, stored account types, and history. Previously blocked legacy recipient memberships remain inactive until an explicit grant for that organization. Signup does not create or activate memberships. Email-bound invitations require separate acceptance and grant only the intended volunteer membership.

Passwords use salted asynchronous scrypt. MongoDB-backed sessions use HTTP-only SameSite=Lax cookies. Authentication rotates the session and CSRF token; writes require CSRF validation. Login/signup throttles persist in MongoDB, and private pages use no-store caching. Email verification, email delivery, and password recovery are not implemented.

## Reservations and inventory

The reservation service conditionally updates an open, unexpired listing only when `availablePortions >= quantity`, decrementing stock in the same operation. This condition and MongoDB's handling of concurrent writes prevent two requests from claiming the same last portion. The transaction keeps the inventory change and reservation insert together; an unsuccessful insert rolls back the inventory change. Transaction retries handle transient write conflicts.

Unique indexes enforce one active reservation per account/listing, one request key per user, and unique pickup codes. Retrying the same request key and payload returns the existing reservation without another decrement. A changed payload or another active reservation returns a conflict. Active duplicates are checked before cumulative portion limits.

Active, collected, and missed quantities count toward the per-account limit; cancelled quantities are freed. Cancellation restores stock once before the saved deadline. Collection requires the saved pickup window and changes an active reservation to collected once, without another inventory decrement. Listing revisions protect concurrent edits. Reservation snapshots preserve original pickup details after listing edits.

My Pickups derives expired presentation from the saved window without rewriting reservation records. Cancelled details retain historical information and omit usable codes and collection instructions.

## Photos, language, and time

New personal and organization listings require a photo. Uploads accept one JPEG, PNG, or WebP still image, limited to 5 MiB and 20 megapixels. Sharp validates decoding, removes metadata, converts to WebP, and creates thumbnails with generated UUID filenames. SVG, HEIC, corrupt, oversized, and animated inputs are rejected. Failed saves remove new files; older versions remain available to reservation snapshots.

User uploads live under ignored `var/uploads/food-photos/`. Back up that directory separately with MongoDB and provide persistent storage when hosting. Licensed sample images and their credits remain tracked.

The interface shows the selected English or Amharic language, with field-level fallback for missing listing translations. User-entered text is preserved. Pickup forms and presentation use America/Chicago; form parsing rejects nonexistent or ambiguous daylight-saving times. Independent Amharic review and physical-device camera/keyboard checks remain outstanding.

## Configuration and development commands

Entrypoints load the project-root `.env`; its database and session credentials override stale shell values. Keep the session secret stable across restarts. Production requires HTTPS and `NODE_ENV=production`. Set `TRUST_PROXY=1` only behind one trusted reverse proxy.

Startup verifies indexes and a real database transaction. It never seeds, migrates accounts, or resets data. Development commands are explicit:

- `npm run seed:demo` inserts missing fictional samples without resetting existing records.
- `npm run demo:recording` inspects sample visibility. Adding `-- --apply` backs up private model records under ignored `.cache/recording-backups/`, renews only the five fictional sample windows and their dedicated events, and replenishes stock consistently. It rejects events shared with unrelated listings. Repeating it on the same Chicago date does not repeatedly add stock.
- `npm run dev:organizer -- --email account@example.test --slug fictional-kitchen --name "Fictional Kitchen"` explicitly grants admin access to a fictional organization. Existing passwords/history are preserved; a new account requires a privately entered password or `DEV_ORGANIZER_PASSWORD`. Personal sharing needs no organization grant.
- `npm run migrate:organizations` links legacy organization records while skipping personal listings, preserving IDs/inventory/snapshots, and granting no memberships.
- `npm run migrate:account-types` is retired and makes no account conversions.

Use these development commands only with the intended development database. None runs automatically during signup or startup.

Tests create and drop only randomly named databases beginning with `community_table_test_`. The application's `MONGODB_URI` is not automatically used for tests. `TEST_MONGODB_URI`, when supplied, should point to a dedicated test replica-set server.
