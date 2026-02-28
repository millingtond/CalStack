# Calorie Tracker

A personal calorie and macro tracking app — no accounts, no subscriptions, no ads. Data syncs across devices via Firebase.

Built with React + Vite + Firebase, powered by [Open Food Facts](https://world.openfoodfacts.org/) for food search (4M+ products globally).

## Features

- **TDEE Calculator** — Mifflin-St Jeor equation with activity multiplier
- **Food Search** — Live search against Open Food Facts (strong UK/EU coverage)
- **Quick Add** — Manually enter calories when you can't find a food
- **Meal Logging** — Breakfast / Lunch / Dinner / Snacks with portion sizes
- **Macro Tracking** — Protein, carbs, fat with progress bars (30/40/30 split)
- **Weight Tracker** — Log daily weight with chart and stats
- **Date Navigation** — Log food for today or previous days
- **PWA** — Installable on your phone, works offline (except food search + sync)
- **Firebase** — Anonymous auth + Firestore for cross-device persistence

## Quick Start

```bash
# Install dependencies
npm install

# Run dev server
npm run dev
```

Open `http://localhost:5173` in your browser.

## Firebase Setup

The app uses your existing Firebase project (`mylittleprojects-3ebd5`). You need to enable two things in the Firebase Console:

### 1. Enable Anonymous Authentication
1. Go to [Firebase Console](https://console.firebase.google.com/) → your project
2. **Authentication** → **Sign-in method** → **Anonymous** → **Enable** → **Save**

### 2. Set Firestore Security Rules
Go to **Firestore Database** → **Rules** and paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/store/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

This ensures each anonymous user can only read/write their own data.

## Data Structure

All data lives in Firestore under:

```
users/{anonymousUid}/store/
  ├── profile          → { value: { name, gender, age, ... } }
  ├── weight-history   → { value: [{ date, weight }, ...] }
  ├── log-2026-02-26   → { value: { breakfast: [...], lunch: [...], ... } }
  ├── log-2026-02-25   → { value: { ... } }
  └── ...
```

## Deploy to Vercel (recommended — free)

1. Push this folder to a GitHub repo
2. Go to [vercel.com](https://vercel.com), sign in with GitHub
3. Import the repo → Vercel auto-detects Vite → Deploy
4. Add your Vercel domain to Firebase Console → Authentication → Settings → Authorized domains

On your phone, open that URL → "Add to Home Screen" → it installs as a PWA.

## Project Structure

```
calorie-tracker/
├── public/
│   ├── favicon.svg
│   ├── apple-touch-icon.png
│   ├── pwa-192x192.png
│   └── pwa-512x512.png
├── src/
│   ├── main.jsx          # Entry point
│   ├── App.jsx            # Main app (all screens)
│   ├── firebase.js        # Firebase config + auth
│   ├── constants.js       # Shared constants & helpers
│   ├── storage.js         # Firestore key-value store
│   └── index.css          # Global styles
├── index.html
├── vite.config.js         # Vite + PWA config
└── package.json
```
