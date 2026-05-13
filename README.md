# GymTrack - Attendance Tracker

A lightweight, PWA-ready gym attendance tracker built with Node.js, Express, and the Temporal API.

## Features

- Session-based authentication.
- Check-in / Check-out with timer.
- Direct Check-out (one-click attendance).
- Monthly history with attendance count and payment calculation.
- Modern, dark-themed UI.

## Prerequisites

- Node.js v18+
- npm

## Setup

1. **Clone the repository**.
2. **Install dependencies**:
    ```bash
    npm install
    ```
3. **Configure Environment**:
   Create a `.env` file in the root directory with the following variables:
    ```env
    PORT=3000
    TIMEZONE=Europe/Amsterdam
    ADMIN_USER=admin
    ADMIN_PASS=admin
    SESSION_SECRET=your-secret-here
    CYCLE_BASE_AMOUNT=55
    CYCLE_START_DATE=2026-05-11
    ```

## Running the App

### Development Mode (with auto-restart)

```bash
npm run dev
```

### Production Mode

```bash
npm start
```

Once the server is running, open [http://localhost:3000](http://localhost:3000) in your browser.

## Database

The app uses a simple `db.json` file to store attendance records and the active session state.

## Troubleshooting

If you encounter a "SyntaxError: Unexpected token '<'" in the browser, it usually means the server returned an HTML error page instead of JSON. Check the server console for the actual error log.
