# Saarthi Device

An Android app that turns a phone into a Saarthi vehicle device.

It is **not** a second Saarthi product and not a driver app. It is a *device
client*: it enrols, authenticates, pairs to a vehicle by QR, and then reports
through exactly the same gateway a Freematics ONE+ reports through. The web
dashboard remains the fleet-management interface, and it cannot tell whether the
positions on its map came from a phone or from fitted hardware — which is the
point.

---

## What it does

| Capability | State |
|---|---|
| Device identity + self-enrolment | Working |
| Secure device authentication (secret → short-lived token) | Working |
| QR vehicle pairing, reassignment, unpairing | Working |
| GPS: latitude, longitude, speed, heading, altitude, accuracy | Working |
| Phone motion (accelerometer, gravity-compensated) | Working |
| Battery, network type, signal strength | Working |
| Simulated vehicle telemetry, 7 profiles | Working, marked simulated end to end |
| Heartbeat | Working |
| Offline buffering with idempotent replay | Working |
| Foreground tracking service, boot resume | Working |
| SOS with countdown safeguard | Working |
| Device Test Center | Working |
| Debug console (debug builds only) | Working |
| Camera preview | Working |
| Live video publishing (WebRTC over WHIP) | Working, needs a gateway |
| Server-commanded camera start, with the app closed | Working |

---

## Building an APK

```bash
cd apps/device-android
./gradlew assembleDebug
```

Output lands in `app/build/outputs/apk/debug/`, split per architecture:

| File | Size | Use |
|---|---|---|
| `app-arm64-v8a-debug.apk` | ~37 MB | every phone made in the last decade |
| `app-armeabi-v7a-debug.apk` | ~31 MB | older 32-bit devices |
| `app-x86_64-debug.apk` | ~40 MB | emulator |
| `app-universal-debug.apk` | ~82 MB | when you do not know the target |

The split exists because libwebrtc ships native code for four architectures, and
without it half of an 82 MB download is machine code for a CPU the phone does not
have.

Install it:

```bash
adb install -r app/build/outputs/apk/debug/app-arm64-v8a-debug.apk
```

### Prerequisites

The Gradle wrapper is committed, so Gradle downloads itself. You need a JDK 17+
and the Android SDK — Android Studio supplies both. If it is installed but not on
your `PATH`:

```bash
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"      # Git Bash
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"      # PowerShell
```

Create `local.properties` pointing at the SDK. It is git-ignored, because it
names a path that exists only on your machine:

```properties
sdk.dir=C:/Users/you/AppData/Local/Android/Sdk
```

Forward slashes deliberately. This is a Java properties file, where a backslash
starts an escape sequence — `C:\Users` silently becomes `C:Users`, and the build
fails with `Invalid file path`, which points at nothing.

Opening `apps/device-android` in Android Studio does all of this for you.

### Release APK

```bash
./gradlew assembleRelease -PsaarthiApiUrl=https://api.yourdomain.com
```

Unsigned as it stands — no signing material belongs in this repository. Add a
`signingConfigs` block reading from a git-ignored `keystore.properties` before
distributing anything.

A release build compiles out the debug console and the telemetry simulator, so
fabricated engine data cannot reach a real fleet.

### Pointing it at your API

**Usually you do not have to.** The pairing QR carries the API address, and the
server derives it from the browser that asked for the QR — so opening the
dashboard at `http://192.168.1.20:5173` produces a code pointing at
`http://192.168.1.20:4000`, and one build serves development, staging and
production.

The compiled-in default only matters before the first pairing, and is
`http://10.0.2.2:4000` — the emulator's alias for the host. To change it:

```bash
./gradlew assembleDebug -PsaarthiApiUrl=http://192.168.1.20:4000
```

**Cleartext HTTP works in debug builds and nowhere else.** A LAN address has no
certificate and never will, so `src/debug` carries its own network security
config permitting cleartext; the release build refuses it to every host,
enforced by the platform before a request is made rather than by a check the
app could be talked out of. It also trusts user-installed certificates in debug
only, so a local HTTPS setup or mitmproxy works without further changes.

---

## Trying it end to end

1. Start the backend and web app — `npm run dev` from the repository root.
2. Sign in as a fleet owner and open a vehicle → **Hardware** → **Add device**.
3. A QR appears with a five-minute countdown.
4. Open Saarthi Device, tap **Connect Device**, then **Scan pairing code**.
5. The home screen now shows the vehicle registration. Tap **Start Device**.
6. Watch the vehicle move on the dashboard's live map.
7. Turn off mobile data and keep moving — the home screen shows buffered events.
8. Turn it back on — the buffer drains and the track fills in with no gaps and
   no duplicates.

Use a physical phone rather than the emulator for anything involving real GPS or
the camera.

---

## Architecture

```
  Compose UI ── DeviceViewModel ──┐
                                  ├── DeviceRepository ── DeviceApi ──HTTPS──▶ Saarthi
  TelemetryService ───────────────┘         │
   (foreground, location + heartbeat)       ├── DeviceIdentityStore  (encrypted)
                                            ├── DeviceSettings
                                            └── EventBuffer          (SQLite, bounded)
```

**Queue first, send second.** Every fix is written to the buffer before an upload
is attempted, and rows leave only when Saarthi confirms it holds them. A crash
between the two costs a duplicate upload, which the event id makes harmless; the
other order costs the data.

**One repository, no DI framework.** There is exactly one object with a lifetime,
needed by the UI, a service and a broadcast receiver. Hilt would add an
annotation processor to solve a ten-line problem.

**SQLite by hand, not Room.** One table, four columns, three queries. No
codegen, no generated schema to keep in step.

### Notable files

| File | What it decides |
|---|---|
| `data/DeviceRepository.kt` | what happens when the network is not there |
| `data/EventBuffer.kt` | the offline queue and its ceilings |
| `data/DeviceIdentityStore.kt` | credentials at rest |
| `network/DeviceApi.kt` | token refresh, and which failures are final |
| `service/TelemetryService.kt` | the tracking loop and its battery cost |
| `domain/TelemetrySimulator.kt` | the engine a phone does not have |
| `domain/MotionDetector.kt` | why a phone's accelerometer is not CAN data |
| `util/DebugLog.kt` | redaction, and why the console is compiled out of release |

---

## Honesty rules this app is built around

**Simulated is never presented as measured.** A phone's GPS, motion and battery
are real. Its RPM, fuel, coolant temperature and trouble codes are invented, and
they travel in a separate object, are stored per-metric as simulated, and are
labelled `SIMULATED` wherever they appear. A fabricated coolant temperature
mistaken for a reading puts a working truck in a workshop.

**Absent is never zero.** A fix with no bearing sends no bearing. A sensor that
is not there reports `null`.

**Refused is not the same as unreachable.** A 422 means stop; a timeout means
buffer and retry. Conflating them either loses data or flattens a battery.

**The notification is the privacy notice.** The foreground service shows a
permanent, undismissable notification naming the vehicle this phone is reporting
for, and the app says what it will do with the location before it asks for the
permission.

---

## Live video

Publishing is implemented, over WHIP (RFC 9725):

```
Camera2 ─▶ VideoSource ─▶ VideoTrack ─▶ PeerConnection ─▶ WHIP ─▶ gateway ─▶ dashboard
                └──────────────────────▶ local preview
```

The whole signalling protocol is one HTTP POST — an SDP offer out, an answer
back — and one DELETE at the end. No socket to hold open, no vendor SDK.

**The service owns the camera, not the screen.** Section 40 lets the dashboard
send `START_CAMERA`, so a stream has to start with the phone in somebody's
pocket and survive the app being closed. That needs a foreground service
declaring `camera`, which is what `TelemetryService` does — and the notification
says the camera is on for as long as it is.

**You need a gateway.** One is included:

```bash
docker compose --profile video up -d      # MediaMTX on :8889
```

Then in the repository-root `.env`:

```dotenv
VIDEO_PROVIDER=device
VIDEO_GATEWAY_URL=http://192.168.1.20:8889   # your LAN address, not localhost
VIDEO_GATEWAY_SECRET=<48 random bytes>
```

MediaMTX holds no user list of its own. Every publish and every view is referred
back to `POST /api/v1/video-gateway/authorize`, so a camera pointed at a driver
stays governed by the fleet's permissions and appears in the fleet's access log
— rather than by a config file on an SFU.

On a LAN the phone and the gateway find each other with host candidates. On a
mobile network behind carrier-grade NAT you will need STUN, and often TURN — set
`VIDEO_ICE_SERVERS`.

## Known limitations

**Not tested on a physical device.** It compiles cleanly and produces an APK,
and the protocol implementation follows RFC 9725, but nobody has yet held a
phone and watched the stream arrive. Expect the usual first-run friction:
codec negotiation against your particular gateway, and ICE on your particular
network.

**Audio is not sent.** The specification says "microphone where required", and
for a road-facing camera it is not. A cabin microphone streaming without a
separate explicit decision is a much bigger step than video.

**Server→device commands are collected but not all acted on.** Transport, queue,
acknowledgement and expiry are complete. `CHANGE_REPORTING_INTERVAL` takes
effect through the heartbeat echo and `START_CAMERA`/`STOP_CAMERA` work; the
rest are acknowledged without a behaviour attached yet.

**No unit tests.** The app's logic that is worth testing — the simulator, the
buffer, the motion filter — is testable, and tests should be written. They have
not been.

---

## The contract

The wire format is documented in
[`docs/SAARTHI_DEVICE_APP_CONTRACT.md`](../../docs/SAARTHI_DEVICE_APP_CONTRACT.md),
and its authority is `packages/shared/src/validation/device-client.ts`. When
that changes, `network/Dto.kt` changes with it.
