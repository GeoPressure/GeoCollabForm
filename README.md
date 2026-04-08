# GeoCollab Form

GeoCollab Form is a Vue 3 + Vuetify intake app for potential geolocator collaborations with the Swiss Ornithological Institute. It is designed to do two things:

- help applicants understand whether a project is broadly suitable for GeoCollab
- collect structured project information for internal review

The app is built as a multi-step wizard and is deployed as a static site on GitHub Pages.

## Stack

- Vue 3
- Vite
- Vuetify
- Mapbox GL JS
- Google Sheets via Apps Script webhook
- GitHub Pages for hosting

## Local setup

Requirements:

- Node.js 20+
- npm
- Python 3 only if you want to regenerate the species data

Install dependencies:

```bash
npm install
```

Create a local env file:

```bash
cp .env.example .env
```

Set the frontend environment variables in `.env`:

```bash
VITE_MAPBOX_TOKEN=...
VITE_GOOGLE_SHEETS_WEBHOOK_URL=...
```

Start the dev server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

Because Vite is configured with `base: '/GeoCollabForm/'`, the local dev URL and the deployed GitHub Pages URL use that repository path.

## Environment variables and tokens

This project uses two Vite variables:

- `VITE_MAPBOX_TOKEN`
- `VITE_GOOGLE_SHEETS_WEBHOOK_URL`

Important:

- Any variable prefixed with `VITE_` is bundled into the frontend and should be treated as public.
- The Mapbox token must therefore be a restricted public token, not a secret server token.
- The Google Sheets webhook URL is also exposed to the browser at runtime, so it should be treated as a public submission endpoint.
- `.env` and `.env.local` are ignored by git and should not be committed.

## Data files

The app reads its species reference data from:

- `src/data/avilist_soi_avonet_joined.csv`

This file is a generated frontend dataset built from local source spreadsheets. The raw Excel inputs in `data/*.xlsx` are intentionally ignored by git and are not meant to be distributed with the repository or included in archival releases.

Current generated data outputs:

- `src/data/avilist_soi_avonet_joined.csv`: frontend input used at build time
- `data/avilist_soi_avonet_joined.csv`: local generated copy
- `data/missing_mass_species.csv`: local review file for missing mass values

To regenerate the joined dataset locally:

```bash
python3 scripts/join_reference_tables.py
```

The script expects the raw Excel inputs to exist locally under `data/`.

## Google Sheets submission backend

Form submissions are sent from the frontend to a Google Apps Script web app. A minimal script looks like this:

```javascript
const SHEET_NAME = "Submissions";

function doPost(e) {
  const sheet = getOrCreateSheet_();
  const payload = JSON.parse(e.postData.contents || "{}");
  const headers = [
    "submitted_at_iso",
    "species_common_name",
    "species_body_mass_g",
    "species_birds_of_the_world_url",
    "location_site_name",
    "location_country",
    "location_latitude",
    "location_longitude",
    "location_radius_km",
    "project_description",
    "project_expected_number_equipped",
    "project_recapture_rationale",
    "project_permits_status",
    "contact_full_name",
    "contact_email",
    "contact_affiliation",
    "contact_address",
    "contact_comments",
  ];

  ensureHeader_(sheet, headers);
  const row = headers.map((key) => payload[key] ?? "");
  sheet.appendRow(row);

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}

function ensureHeader_(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }
}
```

Deploy it as a Web App and set the resulting URL as `VITE_GOOGLE_SHEETS_WEBHOOK_URL`.

## Deployment

GitHub Pages deployment is handled by:

- `.github/workflows/deploy-pages.yml`

The workflow:

- runs on pushes to `main`
- installs dependencies with `npm ci`
- builds the app with the required Vite environment variables
- deploys `dist/` to GitHub Pages

Before the first deployment, configure the repository:

1. In GitHub, set `Settings -> Pages -> Source` to `GitHub Actions`.
2. Add these repository secrets under `Settings -> Secrets and variables -> Actions`:
   - `VITE_MAPBOX_TOKEN`
   - `VITE_GOOGLE_SHEETS_WEBHOOK_URL`

Once that is in place, pushing to `main` will trigger deployment.

## Repository notes

- `dist/` is ignored and should not be committed.
- `.env` is ignored and should remain local.
- The raw source spreadsheets in `data/*.xlsx` are ignored and untracked on purpose.
- The tracked generated CSV in `src/data/` is required for the app to work from a fresh clone.
