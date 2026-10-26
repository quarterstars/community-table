# Community Table

Community Table is a mobile-friendly food-sharing prototype for the Congressional App Challenge. It helps neighbors offer extra food, reserve available portions, and coordinate pickup. One account can both share and receive food.

## Features

- Browse food and view photos, ingredients, reported allergens, portions, and pickup windows without an account.
- Sign up once to post food or reserve another person's listing. Users cannot reserve their own food.
- Manage your listings, cancel your reservations before the pickup deadline, and confirm collection using pickup codes.
- See upcoming pickups in compact cards and past reservations in a collapsed History section.
- Manage church/team listings through separate organization admin and volunteer permissions; signup grants no organization access.
- Switch between English and Amharic, with fallback for missing translations.

Reservations are first come, first served. An atomic conditional update subtracts stock only when enough portions remain. A MongoDB transaction saves that update and the reservation together, rolling back the stock change if the reservation cannot be saved.

## Stack

Node.js 22+, Express, EJS, plain CSS and browser JavaScript, MongoDB/Mongoose, and Sharp for image processing. MongoDB stores accounts, sessions, listings, reservations, and organization memberships. See [architecture and operations](docs/ARCHITECTURE.md) for implementation details and current limitations.

## Setup

Install Node.js 22+ and provide a MongoDB Atlas database or MongoDB replica set with transaction support. A standalone MongoDB server is insufficient.

```sh
npm ci
cp -n .env.example .env
```

Set `MONGODB_URI` and a stable random `SESSION_SECRET` of at least 32 bytes in your local `.env`. Keep an existing configured file. Generate a secret for a new installation with:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm run check:db -- --env-only
npm start
```

Open **http://127.0.0.1:3000**. `npm run dev` enables automatic server restarts. Startup verifies the database and transaction support; it does not seed or reset data. Credentials, uploaded photos, dependencies, and local backups are excluded from Git.

## Sample data and recording

The five sample foods, recipes, organizations, locations, and pickup instructions are fictional. They do not offer real pickups or imply church partnerships. The app's About page explains this.

For a development database, insert missing samples with `npm run seed:demo`. For existing samples, inspect recording readiness with `npm run demo:recording`; use `npm run demo:recording -- --apply` to prepare their pickup windows for today and tomorrow in America/Chicago. Preparation backs up private records locally, preserves IDs and reservation history, and adds any needed stock without resetting committed portions. Both commands are disabled in production.

See the [two-account recording checklist](REHEARSAL.md).

## Photo credits

Sample photographs are credited to USDA/Food and Nutrition Service, USDA/Bob Nichols, Andy Li, psd, Famartin, and Omnipc. Their individual public-domain, CC0, CC BY, or CC BY-SA terms apply separately from the application code; the adapted doughnut photo is CC BY-SA 4.0.

See [photo sources and reuse terms](public/images/foods/LICENSES.md) and the [photo manifest](src/data/food-photos.json) for attribution, licenses, and adaptations. The app also displays credits in About.

## Testing

```sh
npm test
```

Tests run against temporary, randomly named MongoDB replica-set databases and temporary uploads, preserving application data. The first run downloads a MongoDB test binary; alternatively, set `TEST_MONGODB_URI` to a dedicated test server.

Coverage includes authentication, ownership and organization permissions, concurrent reservations, duplicate submissions, cancellation and collection, image validation, pickup presentation, English/Amharic fallback, and Chicago date handling. Physical-device camera/keyboard testing and independent Amharic linguistic review remain outstanding.

See the [public-sharing audit](docs/PUBLIC_SHARING.md) for the repository review and remaining historical privacy consideration.
