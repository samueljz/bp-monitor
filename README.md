# 🩺 BP Monitor

A lightweight, mobile-first blood pressure tracking progressive web app. Log readings throughout the day, review your history with charts, and optionally back up data to Google Drive — all from the browser with no account required.

## Features

- **Today tab** — Log readings with a one-tap modal; view all entries for the current day
- **History tab** — Browse past readings by date with a line chart visualising trends over time
- **Manage tab** — Edit or delete individual readings
- **Google Drive sync** — Optional cloud backup via OAuth 2.0; syncs automatically on every save
- **Dark / Light mode** — Persisted across sessions
- **Offline-first** — All data is stored in `localStorage`; Drive sync is additive
- **Confetti** on every logged reading 🎉

## Tech Stack

| Layer | Library |
|---|---|
| Framework | [Vue 3](https://vuejs.org/) (Composition API, `<script setup>`) |
| Build tool | [Vite](https://vite.dev/) |
| UI components | [Naive UI](https://www.naiveui.com/) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com/) |
| Charts | [Chart.js](https://www.chartjs.org/) via [vue-chartjs](https://vue-chartjs.org/) |
| Cloud backup | Google Drive REST API v3 (via `gapi` + `google.accounts`) |
| Deployment | GitHub Pages (`gh-pages`) |

## Getting Started

### Prerequisites

- Node.js `^22.18.0` or `>=24.12.0`
- npm

### Install dependencies

```bash
npm install
```

### Development server

```bash
npm run dev
```

### Type-check

```bash
npm run type-check
```

### Production build

```bash
npm run build
```

### Preview production build locally

```bash
npm run preview
```

## Google Drive Sync (Optional)

Drive sync is entirely optional. The app works fully offline without it.

To enable it:

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the **Google Drive API**.
3. Create an **OAuth 2.0 Client ID** (Web application type).
4. Add your app's origin (e.g. `http://localhost:5173` for dev, and your GitHub Pages URL for production) to the **Authorised JavaScript origins**.
5. Create a `.env.local` file in the project root:

```env
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

When signed in, the app backs up all readings to a single file (`BPMonitorBackup.json`) in the user's Google Drive. Sync runs automatically after every save and can also be triggered manually via the settings menu.

## Deployment

The project is configured to deploy to GitHub Pages under the `/bp-monitor/` base path.

```bash
npm run deploy
```

This runs a production build then pushes the `dist/` folder to the `gh-pages` branch.

## Project Structure

```
src/
├── App.vue                  # Root component — Today tab, clock, header, log modal
├── main.ts                  # App entry point
├── assets/
│   └── main.css             # Global styles
├── components/
│   ├── BloodPressureCard.vue # Summary card shown after first reading
│   ├── HistoryTab.vue        # Past readings browser with chart
│   └── ManageTab.vue         # Edit / delete readings
└── services/
    └── driveSync.ts          # Google Drive OAuth & sync logic
```

## Data Storage

Readings are stored in `localStorage` under dated keys (`bpm_readings_YYYY-MM-DD`). Soft-deleted entries are retained in storage (marked `deleted: true`) so that Drive syncs never accidentally resurrect removed data.
