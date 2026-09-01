# Saarthi Device — setup

From a fresh checkout to a phone reporting on the live map, and then to live
video.

Three stages. Stage 2 is the whole product working — pairing, GPS, telemetry,
SOS, offline buffering. Stage 3 is live video only, which has its own network
requirements and is worth leaving until the rest is proven.

| Stage | What you get | Time |
|---|---|---|
| 1. Once | Backend configured, APK built and installed | 20 min |
| 2. Data | Paired phone reporting over a dev tunnel | 5 min |
| 3. Video | Live camera in the dashboard | 15 min |

---

## Before you start

| | |
|---|---|
| Node | 20.11+ |
| PostgreSQL | running, with a database for Saarthi |
| Android Studio | supplies both the SDK and a JDK |
| A physical Android phone | 8.0+ |
| Docker | stage 3 only |

The emulator is fine for clicking through screens but has no real GPS and no
real camera. Anything worth testing needs a handset.

---

# Stage 1 — Once

## 1.1 Configure

```bash
npm install
cp .env.example .env
```

Generate the three secrets and paste them into `.env`:

```bash
node -e "const c=require('crypto');for(const k of ['JWT_ACCESS_SECRET','JWT_REFRESH_SECRET','COOKIE_SECRET'])console.log(k+'='+c.randomBytes(48).toString('base64url'))"
```

Point `DATABASE_URL` at your PostgreSQL. Leave everything else as it ships.

`DEVICE_JWT_SECRET` is optional in development — device tokens fall back to the
user access secret. Production refuses to start without its own, because a
leaked device token and a leaked user token must not be forgeable from one key.

## 1.2 Create the schema

```bash
npm run db:migrate
npm run db:seed
```

## 1.3 Build the app

```bash
cd apps/device-android
```

Create `local.properties`:

```properties
sdk.dir=C:/Users/you/AppData/Local/Android/Sdk
```

**Forward slashes.** This is a Java properties file, where a backslash starts an
escape sequence — `C:\Users` silently becomes `C:Users` and the build fails with
`Invalid file path`, which points at nothing. On macOS or Linux:
`/Users/you/Library/Android/sdk`.

Point the shell at a JDK:

```bash
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"      # Git Bash
```
```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"      # PowerShell
```

```bash
./gradlew assembleDebug
```

First run downloads Gradle and the dependencies. After that, about twenty
seconds. Four APKs appear in `app/build/outputs/apk/debug/`, differing only in
which CPU's copy of libwebrtc they carry:

| File | Size | Use |
|---|---|---|
| `app-arm64-v8a-debug.apk` | 37 MB | **any phone from the last decade** |
| `app-armeabi-v7a-debug.apk` | 31 MB | older 32-bit handsets |
| `app-x86_64-debug.apk` | 40 MB | emulator |
| `app-universal-debug.apk` | 82 MB | when you do not know the target |

Opening `apps/device-android` in Android Studio does all of the above for you.

## 1.4 Install

Enable USB debugging (Settings → About phone → tap Build number seven times →
Developer options → USB debugging):

```bash
adb install -r app/build/outputs/apk/debug/app-arm64-v8a-debug.apk
```

No cable: copy the APK to the phone and open it, allowing installation from
unknown sources.

---

# Stage 2 — Data, over a dev tunnel

The phone must reach your machine, and it cannot reach `localhost` — on a phone,
localhost is the phone. A tunnel is the easiest way and works from any network,
including mobile data.

Only port **5173** needs forwarding. The dev server proxies `/api` and `/ws`
straight through, so the phone and the dashboard share one address.

## 2.1 Run

```bash
npm run dev
```

## 2.2 Forward the port

In VS Code: **Ports** panel → **Forward a Port** → `5173` → right-click →
**Port Visibility** → **Public**. Or:

```bash
devtunnel host -p 5173 --allow-anonymous
```

Public matters. A private tunnel asks for a Microsoft login the app cannot
complete, and the failure looks like a network error.

Nothing else to configure: the dev-tunnel domains are already on Vite's
allow-list and the API's CORS policy, and `DEV_HOST` can stay `false` because
the tunnel agent runs on this machine and connects to localhost itself.

ngrok and cloudflared work identically:

```bash
ngrok http 5173
cloudflared tunnel --url http://localhost:5173
```

## 2.3 Open the dashboard at the tunnel URL

**Not localhost.** The pairing QR encodes whichever address the *browser* was on
when it was generated. Open it on localhost and the QR tells the phone to
connect to itself — both origins are accepted, so nothing warns you, and the
pairing fails later with a network error that points at nothing.

Sign in as `owner@saarthi.local` / `Saarthi@2026`.

## 2.4 Pair

1. **Fleet → Vehicles**, open one, or create one.
2. **Hardware** tab → **Add device**. A QR appears with a five-minute countdown.
3. On the phone: **Saarthi Device** → **Connect Device** → **Scan pairing code**.
4. The home screen names the vehicle.

Grant location as **Allow all the time**. "Only while using the app" stops
tracking the moment the screen locks.

## 2.5 Watch it work

Tap **Start Device**. A permanent notification appears naming the vehicle whose
location is being shared.

Open **Live map**. Walk around; the marker follows.

Two things worth trying, because they are what usually goes wrong elsewhere:

- **Turn off Wi-Fi and mobile data.** Keep walking. The home screen shows
  buffered events climbing. Turn it back on — the buffer drains and the track
  fills in with no gaps and no duplicates.
- **Telemetry → simulation profile.** RPM and coolant appear on the dashboard
  badged **Simulated**, while the position beside them is not. The distinction
  is recorded per metric, not per reading.

---

# Stage 3 — Live video

Video does not go through the API. The phone opens a direct WebRTC connection to
a gateway, which is what makes four cameras on a truck affordable to watch — and
also why it has network requirements the rest of the product does not.

**An HTTP tunnel cannot carry it.** The media leg is a separate connection on
port 8189; a tunnel forwards HTTP on 443 and nothing else. Signalling would
succeed and the stream would sit at "Connecting" for ever.

So the phone needs a real route to port 8189. Pick one:

| Route | Phone can be | Cost |
|---|---|---|
| **Tailscale** (recommended) | anywhere, incl. mobile data | free |
| Same Wi-Fi | same network only | free |
| Router port-forward | anywhere | free, needs a real public IP |
| TURN relay | anywhere | a TURN service |

## 3.1 Start the gateway

```bash
docker compose --profile video up -d
```

MediaMTX on `:8889` (WHIP/WHEP signalling) and `:8189` (media, UDP and TCP).
Everything else it can do — RTSP, RTMP, HLS, recording — is switched off.

## 3.2 Give the phone a route

### Tailscale — works from anywhere, no TURN

Install [Tailscale](https://tailscale.com) on the laptop and the phone and sign
both into the same account. Both get a `100.x` address that routes between them
on any network. `tailscale ip -4` prints the laptop's.

### Same Wi-Fi

Nothing to install. Use the laptop's LAN address; the phone must stay on that
network.

### Router port-forward

Forward UDP **and** TCP 8189 to the laptop, and use your public address. Free,
but it changes unless you use dynamic DNS, and there is nothing to forward if
your ISP puts you behind CGNAT.

## 3.3 Configure

In `.env` — `ADDRESS` is the Tailscale IP, the LAN IP or the public IP,
depending on 3.2:

```dotenv
VIDEO_PROVIDER=device
VIDEO_GATEWAY_URL=http://ADDRESS:8889
VIDEO_GATEWAY_PUBLIC_HOST=ADDRESS
VIDEO_GATEWAY_SECRET=<generate below>
DEV_HOST=true
```

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

`VIDEO_GATEWAY_PUBLIC_HOST` is what makes the gateway advertise an address the
phone can dial. Without it MediaMTX offers only the address it sees from inside
its container, which nothing outside can reach.

`DEV_HOST=true` lets the dev server bind beyond localhost, which is needed for
step 3.5.

Restart both:

```bash
docker compose --profile video up -d --force-recreate
npm run dev
```

The API log should say `Video provider ready  provider: "device-webrtc"`.

## 3.4 Check before trusting it

```bash
npm run check:video
```

Issues a real ticket, asks the gateway to accept it, and prints which networks a
phone will be able to publish from. Your configured address should appear in the
candidate list.

Worth running first, because the failure it catches is otherwise invisible:
signalling succeeds, the ticket validates, the access log fills in, and the
stream sits at "Connecting" because the two ends share no route.

The third line — *a phone anywhere, including mobile data* — checks specifically
for a TURN **relay** candidate. It reads `no` on the Tailscale and port-forward
routes, and that is correct: nothing is being relayed because nothing needs to
be.

## 3.5 Watch

The phone can stay paired over the dev tunnel — the API address and the gateway
address are independent, and the phone does not care which address the dashboard
is on.

The **dashboard** does have to move. A page served over HTTPS cannot open a
plain-HTTP gateway; the browser blocks it as mixed content before a request
leaves. So to watch video, open the dashboard at `http://ADDRESS:5173` instead
of the tunnel URL — both sides HTTP, no mixed content. The player says so
plainly if you forget.

Then: **Camera** → **Start streaming** on the phone. The notification changes to
say the camera is on. On the dashboard, the vehicle's **Hardware** tab → camera
tile → **Watch**.

Everyday use can go back to the tunnel URL. Only watching video needs the other
address.

---

# When it does not work

**Phone cannot reach the server.** The QR encoded `localhost` — you generated it
from a localhost dashboard. Regenerate from the tunnel URL; an issued QR cannot
be repaired, and they expire in five minutes.

To see what a QR actually contains, generate one and look at the response in the
browser's network tab: `qrPayload.api` is the address the phone will use.

**Tunnel returns 404 with an empty body.** The endpoint is registered but nothing
is hosting it. Start forwarding the port in VS Code.

**Tunnel asks for a Microsoft login.** It is private. Set visibility to Public.

**Vite says "Blocked request. This host is not allowed."** A tunnel provider
outside the four already allow-listed. Add its domain to `DEV_ALLOWED_HOSTS`.

**Pairing token expired.** Five minutes, single use. Generate another.

**Vehicle already has a device.** A vehicle may carry only one *telemetry*
source; cameras and auxiliary units are unrestricted. Unpair the existing one
from the Hardware tab, or use another vehicle.

**Marker will not move.** Location permission is "while using the app", or
battery optimisation is killing the service. Settings → Apps → Saarthi Device →
Battery → Unrestricted.

**`Invalid file path` from Gradle.** Backslashes in `local.properties`. See 1.3.

**Gateway container restarts in a loop, logging `invalid ICE server: ''`.** An
empty `VIDEO_TURN_URL` reached MediaMTX, which treats an empty URL as invalid
rather than absent. `docker compose --profile video up -d --force-recreate`
after updating; the compose file defaults it to public STUN.

**Video sits at "Connecting".** The two ends share no route. Run
`npm run check:video` and look at the candidate list — if your configured
address is not in it, `VIDEO_GATEWAY_PUBLIC_HOST` is not set or the gateway was
not recreated after setting it.

**Video says the page is HTTPS and the gateway is HTTP.** You are on the tunnel
URL. Open the dashboard at `http://ADDRESS:5173` — see 3.5.

---

# What this does not cover

Production. Everything here is development on plain HTTP, which the release
build of the app refuses outright. `docs/PRODUCTION.md` covers the migration:
TLS throughout, a signed APK, a dedicated `DEVICE_JWT_SECRET`, Redis drivers
instead of memory, and the gateway behind a real certificate.
