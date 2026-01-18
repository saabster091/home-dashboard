# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm start` - Start the dashboard server on port 3000
- `npm install` - Install dependencies (only dotenv)

## Architecture

This is a home dashboard displaying real-time data from a Tesla Powerwall and weather information for Aldinga Beach, South Australia.

### Server (server.js)

Node.js HTTP server with three endpoints:
- `/` - Serves the dashboard HTML
- `/api/power` - Proxies Tesla Powerwall data (battery %, solar, load, grid)
- `/api/weather` - Fetches weather from Open-Meteo API

**Powerwall Authentication**: The server authenticates with the local Powerwall gateway using credentials from `.env`. Tokens are refreshed proactively every 30 minutes and on 401/403 errors.

**Powerwall API endpoints used**:
- `/api/login/Basic` - Authentication
- `/api/system_status/soe` - Battery state of energy (percentage)
- `/api/meters/aggregates` - Solar, load, battery, and grid power readings

### Frontend (index.html)

Single-page dashboard with inline CSS and JavaScript. Data refresh intervals:
- Power data: 5 seconds
- Weather: 5 minutes
- Time: 1 second

## Configuration

Create a `.env` file with:
```
POWERWALL_HOST=<powerwall-ip>
POWERWALL_EMAIL=<email>
POWERWALL_PASSWORD=<password>
```

The Powerwall gateway uses a self-signed certificate (`rejectUnauthorized: false`).
