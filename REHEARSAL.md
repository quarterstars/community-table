# Community Table recording checklist

Run `npm start` in the project folder and open **http://127.0.0.1:3000**. Keep the existing ignored `.env`. Startup verifies Atlas and never resets data.

The five fictional sample foods retain their original photos and IDs. Their recording window is **October 25, 00:00 through October 26, 23:59, 2026, America/Chicago**. About explains that no real pickup is offered. To inspect/prepare a later day explicitly:

```sh
npm run demo:recording
npm run demo:recording -- --apply
```

Preparation preserves account/password/membership records and reservation history. It only renews the five fictional sample listing/event windows and adds any needed stock consistently to total and available quantities. It backs up private records locally in ignored `.cache/recording-backups/`. Repeating it on the same date does not add stock again.

## Two accounts, one account model

Use two separate browser profiles or one normal and one private window. Sign up through the same **Create an account** page, using two demo emails you control, for example `demo-share@example.test` and `demo-pickup@example.test`, and passwords you choose. Existing accounts/passwords also work. Neither account needs organization access, and both can share and receive food.

1. **Guest:** Browse the five sample foods, open Details, inspect a photo, ingredients/allergens and pickup information. Show “Log in to reserve” and Share Food → “Log in to share.” Optionally switch English/Amharic and return to English.
2. **Account A:** Share Food → Post food. Upload a photo; for a fictional example use the credited [misir photo](public/images/foods/misir-wot-injera.webp). Show the preview. Enter a fictional dish, description, portion size, ingredients and accurate reported allergens or Unknown. Set **5 total portions**, **3 per account**, and a fictional location/instructions. Choose a pickup start at or before the current Chicago time and an end later today/tomorrow. Check the posting confirmation and save.
3. **Account B:** Browse → the new dish → choose **2 portions**, check the quantity/window confirmation, then Reserve food. Show available stock **5 → 3**, and My Pickups with its code and instructions.
4. **Account A:** Share Food → your listing → Review pickup. Compare B's code, check the collection confirmation, and confirm. Status becomes Collected; availability stays **3**. A second collection cannot succeed.
5. **Optional cancellation:** B reserves another available dish, then cancels before its saved deadline. Inventory returns once. A can pause/resume/edit its own listing. Show that A cannot reserve its own dish. To demonstrate the shared account model directly, A can also reserve someone else's dish.

After login/signup the app returns to the intended internal screen, with no automatic post/reservation. Church/team management appears in Share Food only for authorized memberships; it is not part of this personal sharing recording.

## Recording limits

- Photos accept JPEG, PNG or WebP, at most 5 MiB and 20 megapixels. HEIC/SVG/animated/corrupt images are rejected. Uploads persist under ignored `var/uploads/food-photos/`; back up that directory with the database.
- Collection requires the **saved** pickup window to have started and not ended. Changing the listing's dates does not rewrite existing pickup snapshots.
- Active/collected/missed portions count toward the account limit. Create another clearly fictional listing for another take; do not reset inventory/history.
- The mobile layout is checked in a browser. Physical-device camera/keyboard behavior and independent Amharic linguistic review remain unverified.
- Use your own passwords. No account credentials belong in the recording, source repository, or handoff.
