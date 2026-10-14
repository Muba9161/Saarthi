# Changelog

All notable changes to Saarthi are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/). Entries are compiled at release time from the
Conventional Commit titles merged into `develop`; see
[CONTRIBUTING.md](CONTRIBUTING.md#releases-lead).

## [Unreleased]

## [1.0.0] - 2026-10-14

The first tagged release of VorldX Saarthi, live at [vorldxsaarthi.com](https://vorldxsaarthi.com).
Work before this release was not versioned, so this entry summarises the platform as released.

### Apps

- **Web app and API**: React web app on a Fastify, Prisma and PostgreSQL API.
- **VorldX Saarthi**: the owner app for Android.
- **Humsafar**: the driver app for Android.
- **Saarthi Terminal**: the driver cockpit for a vehicle-mounted Android tablet.
- **Saarthi Device**: the test harness for phone GPS, camera, sensors and simulated telemetry.

### Added

- **Accounts**: sign-in, sessions, password reset, and roles with multi-tenant isolation enforced
  on the server.
- **Plans and billing**: subscription plans and limits, `+1 vehicle` top-ups, trackers, payments
  and wallet.
- **Verification**: driver, vehicle and business verification, identity checks, RC and driving
  licence lookup, and documents with expiry tracking.
- **Fleet**: vehicles, drivers and assignments, vehicle sharing, maintenance, fuel, expenses,
  service history, and loans with EMI reminders.
- **Trips and tracking**: trip lifecycle, live tracking over WebSockets, 3D maps, truck navigation,
  OBD and camera devices, FASTag and toll, and a GPS simulator.
- **Marketplace**: one front door for material, freight, cab and tour requirements, bidding,
  orders, the seller catalogue, return loads, resale and travel.
- **Safety**: SOS network, explainable driver scoring, and nearby services and fuel stations with
  published prices.
- **Intelligence**: AI copilot with an authorised tool registry, daily fleet brief, analytics and
  the digital truck passport.
- **Growth**: Saarthi Rahi sales and the referral programme.
- **Privacy**: QR identity with per-field masking, audit logging and account retention.
- **Contribution workflow**: branch and commit rules, and automatic checks on every pull request;
  see [CONTRIBUTING.md](CONTRIBUTING.md).

[Unreleased]: https://github.com/Muba9161/Saarthi/compare/v1.0.0...develop
[1.0.0]: https://github.com/Muba9161/Saarthi/releases/tag/v1.0.0
