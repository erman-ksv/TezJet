# TezJet Mobile

One native React Native + Expo app for Android and iOS, with passenger and driver modes on the same phone account.

## Configure the API

Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_URL` to the reachable TezJet API base URL without a trailing slash. On a physical phone, do not use `localhost`; use a reachable LAN address or deployed HTTPS URL.

## Run locally

From this directory, run `pnpm install` and then `pnpm start`. Scan the Expo QR code with Expo Go for early UI testing. The API must be running and reachable from the device.

## Passenger mode

- Phone OTP sign-in.
- Select pickup and destination stops and estimate fare.
- Select 1–8 passengers.
- Create an order with pickup coordinates. The current API requires those coordinates, so order creation stops if location permission is declined.

## Driver mode

- A driver profile can be requested from the same phone account.
- New driver profiles remain pending until an administrator approves them.
- Approved drivers can join/leave the queue, update their location, receive incoming offers over Socket.IO, accept orders, and advance the trip status.
- The API checks both seat capacity and whether the driver is at or demonstrably approaching the pickup. Merely being at another pickup point is not enough.
- Switching passenger/driver mode requires OTP again because the API invalidates the previous role token on sign-in.

## Builds and validation

Expo EAS can build an Android preview APK and an iOS binary. An Expo account is required; iOS distribution also requires Apple Developer membership. Store publication is a separate release step.

GitHub Actions checks TypeScript and exports Android/iOS bundles. Physical-device API connectivity, location behavior, Socket.IO events on-device, and installable native builds still need hands-on verification before production use.
