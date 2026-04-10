# IH35 Dispatch V3 Starter

This starter begins the live program you described:
- Samsara vehicle stats (GPS + fuel percent)
- Samsara HOS clocks
- Samsara driver-vehicle assignments
- route/geocode helpers through the backend
- fuel recommendation preview using your assumptions

## Assumptions already included
- Default tank size: 120 gallons
- Unit 169 tank size: 80 gallons
- Target shift miles: 750
- Personal conveyance buffer: 45 miles default
- Truck MPG should come from Samsara or your control table later

## Setup
1. Copy `.env.example` to `.env`
2. Put a fresh Samsara API token in `.env`
3. In Terminal:
   - `npm install`
   - `npm start`
4. Open `http://localhost:3100`

## Current endpoints
- `/api/health`
- `/api/samsara/vehicles`
- `/api/samsara/live`
- `/api/samsara/hos`
- `/api/samsara/assignments`
- `/api/geocode?q=...`
- `/api/route?coords=lon,lat;lon,lat`
- `/api/recommendation/preview`

## What this starter does now
- Confirms Samsara auth works
- Pulls live data from official Samsara endpoints
- Proxies route/geocode from the server side
- Previews fuel-stop logic with HOS and reserve assumptions

## Next build steps
1. Load real Loves daily file into the backend
2. Load real truck master table instead of sample CSV
3. Match assignments + HOS + vehicle stats into one fleet board
4. Add live map and per-unit recommendations
