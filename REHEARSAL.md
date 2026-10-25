# Community Table submission rehearsal

Start from the project folder:

```sh
cd "/Users/abebedesalegn/Downloads/community table"
npm ci
npm start
```

Open **http://127.0.0.1:3000**. The existing ignored `.env` supplies MongoDB and the session secret; do not overwrite it. `npm start` verifies Atlas and transaction support and never resets or seeds data. If a server is already running on port 3000, use it or stop that server before starting another.

## Accounts and today's event

Use your existing **organizer@example.test** login and its current password. It is a separate organizer account with admin access to **Cedar Neighborhood Kitchen**, a fictional organization. Organizer navigation is Dashboard, Listings, Pickups, Profile. No password or account role was changed.

The prepared event is **Submission rehearsal · 2026-10-18**. Its pickup window is **October 18, 2026, 12:00 a.m.–11:59 p.m., America/Chicago**. It is already attached to your organizer's organization. This is a prototype demonstration; no real food pickup is offered. Existing events, five sample listings, reservation histories, accounts, and inventory were not reset.

For a recipient, open a separate browser/private window. Log in with an existing recipient email/password, or choose **Create an account** and use a different email, such as `recipient-rehearsal@example.test`, with a password you choose. Public signup always creates a recipient. Recipient navigation is Browse, My Pickups, Profile. Organizer accounts cannot reserve; recipient accounts cannot manage organizations. A legacy recipient with membership/history remains a recipient and was not migrated.

To prepare another Chicago rehearsal day explicitly (without resetting the previous day's records):

```sh
npm run demo:rehearsal -- --email organizer@example.test --date 2026-10-19
```

Use the actual rehearsal date. The command requires an existing admin of one fictional organization; it creates only that day's missing event and never resets existing events/listings. For multiple eligible organizations, add `--organization cedar-neighborhood-kitchen`. It is disabled in production. There is no need to run `seed:demo` for this rehearsal.

## Rehearse

1. **Organizer → Listings → Create food listing.** Select **Submission rehearsal · 2026-10-18**. Enter a clearly fictional food name, description, portion size, ingredients, and either known sample-recipe allergen details or **Unknown — not provided**. Set **5 total portions** and **3 per recipient account**. Choose a photo and inspect its preview before saving. On supported phones, the native picker offers photos/camera choices; desktop uses a file chooser. For a locally available credited example, use `public/images/foods/misir-wot-injera.webp` for a misir wot listing.
2. Set the listing pickup window within the event, with its start at or before the current Chicago time and its end later today. For this rehearsal you can use **October 18, 00:00–23:59**. Enter a fictional pickup location/instructions, choose **open**, and save. Collection requires the saved pickup window to have started.
3. **Recipient → Browse → View details.** Check the photo and pickup information. Reserve **2 portions**. Available inventory should move **5 → 3**. My Pickups shows the quantity, pickup code, dates, location and instructions.
4. **Recipient → Cancel reservation.** Available inventory returns **3 → 5**. Repeated cancellation cannot restore extra portions. Reserve **2 portions again** and copy this new active pickup code. Inventory returns to **3**.
5. **Organizer → Pickups.** Look up the new code, review recipient/quantity/status, tick the explicit collection confirmation, and confirm. Status becomes collected; available inventory stays **3**. The confirmation control is removed; repeated requests are rejected. Collected reservations cannot be cancelled.
6. Edit the listing without selecting another photo: its existing photo stays. Restart the server and revisit Browse/Details: the saved photo stays. New listings without photos use a neutral placeholder.

Reservations are first come, first served. Stored old priority/preference fields have no effect. Listing/event status, available inventory, lifetime per-account limits (active/collected/missed portions), and pickup deadlines still apply. To rehearse again after collecting all allowed portions, use another recipient or create another clearly fictional listing; do not reset inventory below committed portions.

## Upload storage

JPEG, PNG and WebP inputs are checked by the image decoder on the server: maximum **5 MiB**, **20 megapixels**, one still image per request. Filenames and claimed MIME types are untrusted. SVG, corrupt/truncated images, unsupported formats (including HEIC), oversized images, and non-images are rejected. Files are re-encoded as WebP, metadata removed, and square thumbnails generated with random filenames.

Saved files live in **`var/uploads/food-photos/`**, ignored by Git. MongoDB stores their local URLs. Keep/back up this directory alongside the database; on a hosted server it must be on persistent storage. Server restarts preserve it. Older uploaded versions remain available for reservation snapshots. Rejected/failed saves clean up new files. There are no profile-photo uploads.

Browser/device camera-picker behavior varies by phone and browser; the form leaves camera/library choices to the device rather than forcing capture. Physical-device camera behavior and HEIC conversion are not verified/supported.
