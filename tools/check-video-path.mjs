/**
 * Check the live-video path, without a phone.
 *
 *   node tools/check-video-path.mjs
 *
 * Answers the question that is otherwise very hard to answer — *will a phone on
 * a different network be able to send video* — by exercising everything except
 * the camera itself: Saarthi issues a real publish ticket, the gateway is asked
 * to accept it, and the ICE candidates it offers are printed.
 *
 * Those candidates are the whole story. WebRTC can only connect over a pair
 * both ends can reach, so what appears here decides which networks will work:
 *
 *   host   an address on the gateway's own network
 *          → works when the phone is on that network, and nowhere else
 *   srflx  the gateway's public address, discovered through STUN
 *          → works when the gateway's router forwards the media port
 *   relay  an address on a TURN server that will forward media
 *          → works from anywhere, including mobile data behind carrier NAT
 *
 * No relay candidate and no reachable srflx means a phone off the local network
 * has nothing to connect to, however healthy everything else looks. Signalling
 * will still succeed and the stream will sit at "Connecting" for ever, which is
 * why this exists as a check rather than something to discover in the field.
 *
 * Reads DEV_EMAIL / DEV_PASSWORD, or falls back to the seeded demo owner.
 */

import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(here, '..', '.env') });
loadEnv({ path: path.join(here, '..', '.env.local'), override: true });

const API = (process.env.CHECK_API_URL ?? 'http://localhost:4000').replace(/\/$/, '') + '/api/v1';
const EMAIL = process.env.DEV_EMAIL ?? 'owner@saarthi.local';
const PASSWORD = process.env.DEV_PASSWORD ?? 'Saarthi@2026';

const dim = (s) => `[2m${s}[0m`;
const bold = (s) => `[1m${s}[0m`;
const green = (s) => `[32m${s}[0m`;
const yellow = (s) => `[33m${s}[0m`;
const red = (s) => `[31m${s}[0m`;

async function call(pathname, { method = 'GET', body, token, deviceAuth } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (deviceAuth) {
    headers['x-device-id'] = deviceAuth.id;
    headers['x-device-secret'] = deviceAuth.secret;
  }

  const response = await fetch(`${API}${pathname}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed };
}

function fail(message, hint) {
  console.log(`\n${red('✗')} ${message}`);
  if (hint) console.log(dim(`  ${hint}`));
  process.exit(1);
}

// ---------------------------------------------------------------------------

console.log(bold('\nSaarthi — live video path check\n'));
console.log(dim(`  API       ${API}`));
console.log(dim(`  provider  ${process.env.VIDEO_PROVIDER || 'none'}`));
console.log(dim(`  gateway   ${process.env.VIDEO_GATEWAY_URL || '(not set)'}`));
console.log(dim(`  ICE       ${process.env.VIDEO_ICE_SERVERS || '(none — local network only)'}`));

if ((process.env.VIDEO_PROVIDER ?? 'none') !== 'device') {
  fail(
    `VIDEO_PROVIDER is "${process.env.VIDEO_PROVIDER || 'none'}", so no real tickets are issued.`,
    'Set VIDEO_PROVIDER=device, VIDEO_GATEWAY_URL and VIDEO_GATEWAY_SECRET, then restart the API.',
  );
}

const login = await call('/auth/login', {
  method: 'POST',
  body: { email: EMAIL, password: PASSWORD },
});
if (login.status !== 200) {
  fail(`Could not sign in as ${EMAIL}.`, 'Is the API running? Try `npm run dev`.');
}
const accessToken = login.body.data.accessToken;

// A throwaway vehicle and device, removed at the end. Using an existing one
// would risk unpairing hardware somebody is relying on.
const plate = `CHK${String(Math.floor(Math.random() * 90000) + 10000)}`;
const vehicle = await call('/fleet/vehicles', {
  method: 'POST',
  token: accessToken,
  body: { registrationNumber: plate, vehicleType: 'TRUCK', truckType: 'TIPPER', capacityTons: 25 },
});
if (!vehicle.body?.data?.id) fail('Could not create a temporary vehicle.');
const vehicleId = vehicle.body.data.id;

let deviceIdentifier = null;

try {
  const pairing = await call(`/fleet/vehicles/${vehicleId}/pairing-token`, {
    method: 'POST',
    token: accessToken,
    body: { deviceType: 'MOBILE_TEST_DEVICE' },
  });

  const enrol = await call('/device-gateway/enroll', {
    method: 'POST',
    body: {
      installationId: `check-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      platform: 'ANDROID',
      deviceModel: 'video path check',
    },
  });
  const deviceAuth = {
    id: enrol.body.data.deviceIdentifier,
    secret: enrol.body.data.secret,
  };
  deviceIdentifier = deviceAuth.id;

  const pair = await call('/device-gateway/pair', {
    method: 'POST',
    deviceAuth,
    body: { token: pairing.body.data.qrPayload.token },
  });
  if (!pair.body?.data?.token?.accessToken) {
    fail('Could not pair the temporary device.', JSON.stringify(pair.body?.error ?? {}));
  }
  const deviceToken = pair.body.data.token.accessToken;

  // --- the ticket ----------------------------------------------------------

  const ticketRes = await call('/device-gateway/camera/publish-ticket', {
    method: 'POST',
    token: deviceToken,
    body: { channel: 1 },
  });
  if (!ticketRes.body?.data) {
    fail(
      'Saarthi refused to issue a publish ticket.',
      ticketRes.body?.error?.message ?? `status ${ticketRes.status}`,
    );
  }
  const ticket = ticketRes.body.data;

  console.log(bold('\n1. The ticket Saarthi issues\n'));
  console.log(`   ingest    ${ticket.ingestUrl}`);
  console.log(
    `   encoding  ${ticket.constraints.maxWidth}x${ticket.constraints.maxHeight} @ ` +
      `${ticket.constraints.maxFrameRate}fps, ${ticket.constraints.maxBitrateKbps} kbps`,
  );
  if (ticket.iceServers.length === 0) {
    console.log(`   ICE       ${yellow('none')} ${dim('— local network only')}`);
  } else {
    for (const server of ticket.iceServers) {
      console.log(
        `   ICE       ${server.urls}${server.username ? dim(`  (user ${server.username})`) : ''}`,
      );
    }
  }

  // --- the gateway ---------------------------------------------------------

  const OFFER = [
    'v=0',
    'o=- 0 0 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'm=video 9 UDP/TLS/RTP/SAVPF 96',
    'c=IN IP4 0.0.0.0',
    'a=rtcp-mux',
    'a=ice-ufrag:chek',
    'a=ice-pwd:checkcheckcheckcheckch',
    'a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:' +
      '00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF',
    'a=setup:actpass',
    'a=mid:0',
    'a=sendonly',
    'a=rtpmap:96 VP8/90000',
    '',
  ].join('\r\n');

  let whip;
  try {
    whip = await fetch(ticket.ingestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sdp',
        Authorization: `Bearer ${ticket.token}`,
      },
      body: OFFER,
    });
  } catch (error) {
    fail(
      `Could not reach the gateway at ${ticket.ingestUrl}`,
      `${error.message} — is it running? \`docker compose --profile video up -d\``,
    );
  }

  if (whip.status === 401) {
    fail(
      'The gateway refused the ticket.',
      'VIDEO_GATEWAY_SECRET differs between the API and the gateway, or the gateway ' +
        'cannot reach POST /api/v1/video-gateway/authorize.',
    );
  }

  const answer = await whip.text();

  console.log(bold('\n2. What the gateway offers to connect on\n'));

  const seen = new Map();
  for (const line of answer.split(/\r?\n/)) {
    if (!line.startsWith('a=candidate:')) continue;
    const parts = line.split(' ');
    const type = parts[7];
    const key = `${type} ${parts[2]} ${parts[4]}:${parts[5]}`;
    if (seen.has(key)) continue;
    seen.set(key, true);
    const label =
      type === 'relay' ? green('relay') : type === 'srflx' ? green('srflx') : dim('host ');
    console.log(`   ${label}  ${String(parts[2]).padEnd(4)}  ${parts[4]}:${parts[5]}`);
  }
  if (seen.size === 0) console.log(`   ${red('none')}`);

  const types = new Set([...seen.keys()].map((k) => k.split(' ')[0]));

  // --- the verdict ---------------------------------------------------------

  console.log(bold('\n3. Which phones will be able to send video\n'));

  const line = (ok, text) => console.log(`   ${ok ? green('yes') : red(' no')}  ${text}`);

  line(types.has('host'), 'a phone on the same network as the gateway');
  line(
    types.has('srflx'),
    'a phone elsewhere, if the gateway’s router forwards its media port',
  );
  line(types.has('relay'), 'a phone anywhere, including mobile data');

  if (!types.has('relay')) {
    console.log(
      dim(
        '\n   No relay candidate. For video from any network, set VIDEO_ICE_SERVERS and\n' +
          '   VIDEO_TURN_URL to the same TURN server — both the phone and the gateway need\n' +
          '   it, and they must name the same one.',
      ),
    );
  } else {
    console.log(dim('\n   A relay candidate is present, so network location no longer matters.'));
  }

  console.log('');
} finally {
  // Leave nothing behind. A stray paired device would occupy the vehicle's one
  // telemetry slot and confuse the next person to look.
  await call(`/fleet/vehicles/${vehicleId}`, { method: 'DELETE', token: accessToken }).catch(
    () => undefined,
  );
  if (deviceIdentifier) {
    console.log(dim(`  cleaned up ${deviceIdentifier} and ${plate}\n`));
  }
}
