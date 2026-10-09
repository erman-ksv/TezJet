# TezJet Mobile

Single React Native + Expo app for Android and iOS. Passenger and driver mode selector share one app. The driver screen is intentionally informational until server-side driver authorization and dispatch actions are implemented.

## Configure the API

Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_URL` to the reachable TezJet API base URL without a trailing slash. On a physical phone, do not use `localhost`; use a reachable LAN address or deployed HTTPS URL.

## Run locally

From this directory, run `pnpm install` and then `pnpm start`. Scan the Expo QR code with Expo Go for early UI testing. The API must be running and reachable from the device.

## Builds

Expo EAS can build an Android preview APK and iOS production binary. An Expo account is required; iOS distribution also requires Apple Developer membership. Store publication is a separate release step.

## Current status

- Native React Native components and Expo configuration.
- Passenger OTP, route stops, fare estimate, and order creation wired to current API endpoints.
- Foreground location is requested only after user action. The current API requires pickup coordinates, so order creation stops with a clear message if permission is declined.
- Driver mode is not operational yet. Passenger accounts must not be allowed to receive or accept driver orders.
- API connectivity, device testing, automated typecheck, and EAS builds still need verification before production use.
