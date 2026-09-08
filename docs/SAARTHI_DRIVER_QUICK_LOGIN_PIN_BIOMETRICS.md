# Saarthi Driver — Quick Login (4-Digit PIN + Biometrics)
## Implementation Specification / Claude Code Prompt

### Objective

Add a secure, fast-login experience to the **existing Saarthi Driver APK**.

This is an extension of the existing Driver authentication/session system.

**Do NOT create a second Driver APK, second account system, or separate authentication backend.**

The feature should be called:

> **Saarthi Quick Login**

It provides two device-local quick-unlock methods:

1. **4-digit Saarthi PIN**
2. **Device Biometrics** (fingerprint, face, or another biometric supported by Android)

The existing normal authentication remains the primary account authentication mechanism.

---

# 1. First: Inspect Before Coding

Before changing anything:

1. Read `CLAUDE.md`.
2. Read all relevant Markdown documentation.
3. Inspect the complete Android project.
4. Inspect `apps/terminal-android`.
5. Inspect `:core`, `:terminal`, and `:driver`.
6. Inspect authentication.
7. Inspect access-token and refresh-token handling.
8. Inspect secure/local storage.
9. Inspect session restoration.
10. Inspect logout behavior.
11. Inspect device identity handling.
12. Inspect existing Android security dependencies and SDK versions.
13. Inspect existing tests.

Classify the feature as:

- Already implemented
- Partially implemented
- Missing
- Conflicting
- Requires refactor

Reuse existing architecture.

Do not blindly introduce another credential/session system.

---

# 2. Product Experience

After the driver's first successful normal login:

```text
Normal Saarthi Login
        ↓
Authentication succeeds
        ↓
Device/session established
        ↓
"Enable Saarthi Quick Login?"
        ↓
┌─────────────────────────────┐
│ 🔢 Create 4-Digit PIN       │
│                             │
│ 👆 Enable Biometrics        │
└─────────────────────────────┘
```

The driver may enable:

- PIN only
- Biometrics only
- both
- neither

Do not force either quick-login method.

---

# 3. Returning Driver Flow

When Saarthi is opened again on a trusted device:

```text
          Saarthi Driver
                ↓
       Existing session found
                ↓
        Saarthi Quick Login
                ↓
       ┌────────┴────────┐
       │                 │
    Biometrics          PIN
       │                 │
       └────────┬────────┘
                ↓
       Unlock local session
                ↓
       Validate/refresh session
                ↓
      Restore Driver workspace
                ↓
    Assignment / Vehicle / Trip
                ↓
             Cockpit
```

The goal is to let the driver get back into Saarthi quickly without repeatedly entering the full account password/OTP.

---

# 4. Critical Security Principle

The 4-digit PIN and biometrics are **quick-unlock mechanisms**, NOT replacements for the account's underlying authentication.

Do NOT treat:

```text
PIN = account password
```

The PIN only unlocks the locally protected Saarthi session/credential on the trusted device.

The backend continues to validate the actual authenticated session.

---

# 5. PIN Security

The PIN must never be stored as plaintext.

Do NOT store:

```text
PIN = 1234
```

in:

- SharedPreferences
- plain SQLite
- ordinary files
- logs
- analytics
- crash reports
- unencrypted local storage

Use Android's secure credential mechanisms and Android Keystore where appropriate.

Design the implementation so that possession/copying of application data does not simply reveal the PIN or underlying refresh token.

Do not invent custom cryptography if a secure Android/Jetpack mechanism already exists and is appropriate.

---

# 6. PIN Creation

PIN requirements:

- exactly 4 digits
- confirm PIN before saving
- never display the complete PIN after entry
- no logging
- no analytics containing the PIN
- prevent accidental whitespace/non-digit input
- reject invalid confirmation
- provide clear retry feedback

Suggested flow:

```text
Create Saarthi PIN

Enter 4-digit PIN
        ↓
Confirm 4-digit PIN
        ↓
Match?
   ┌────┴────┐
   No       Yes
   ↓         ↓
Retry     Securely store
             ↓
        Quick Login enabled
```

Avoid overly weak choices such as `0000`, `1111`, `1234`, and other obvious sequential/repeated PINs if this does not conflict with the product's intended UX.

If the existing security policy has a PIN policy, reuse it.

---

# 7. PIN Unlock

Returning user:

```text
Enter Saarthi PIN
        ↓
Verify against secure local credential
        ↓
Valid?
  ┌────┴────┐
 Yes        No
  ↓          ↓
Unlock    Failed attempt
session       ↓
  ↓       Retry / lockout
Refresh
session
```

Never send the PIN to the backend as the user's password.

Never transmit the PIN over the network merely to verify the local unlock.

---

# 8. Failed PIN Attempts

Implement a reasonable brute-force protection mechanism.

At minimum:

- count failed attempts
- progressively restrict repeated failures
- after the configured threshold, require normal account authentication

Example:

```text
Attempt 1 ❌
Attempt 2 ❌
Attempt 3 ❌
Attempt 4 ❌
Attempt 5 ❌
       ↓
Temporary PIN lock
       ↓
Normal authentication required
```

Do not permanently lock the driver's account because of local PIN failures.

The exact thresholds should follow existing security conventions if the repository already defines them.

---

# 9. Biometric Authentication

Use Android's supported biometric authentication APIs.

Do NOT implement custom fingerprint recognition.

Do NOT access or store biometric data.

The app should invoke the Android system biometric prompt.

Support whatever biometric methods the device officially exposes, such as:

- fingerprint
- face
- other Android-supported biometric authentication

The app should receive only the authentication result.

Conceptually:

```text
Saarthi
   ↓
Android BiometricPrompt
   ↓
Device verifies biometric
   ↓
Success / Failure
```

Biometric data must remain under Android/device security controls.

---

# 10. Biometric Enrollment Changes

Handle cases where the device biometric configuration changes.

Examples:

- new fingerprint added
- fingerprint removed
- face data changed
- biometric enrollment reset
- device security settings changed

If the secure key is invalidated by biometric enrollment changes:

```text
Biometric Quick Login unavailable
        ↓
Normal Saarthi authentication
        ↓
Re-enable biometrics
```

Do not silently fall back to insecure behavior.

---

# 11. PIN + Biometrics Together

Allow both methods to coexist.

Example:

```text
Saarthi Quick Login

[ Use Biometrics ]

or

[ Use 4-Digit PIN ]
```

If biometric authentication is unavailable, the PIN can remain available if configured.

If the PIN is disabled, biometric authentication can remain available.

The driver controls which quick-login methods are enabled.

---

# 12. Quick Login Settings

Add an appropriate section in the existing Driver settings/security area:

### Saarthi Quick Login

```text
Saarthi Quick Login
────────────────────────

Use PIN                         ON/OFF

Change PIN                      >

Use Biometrics                  ON/OFF

Disable Quick Login             >

Sign out from this device       >
```

Use the existing Saarthi design system.

Do not create a new settings architecture.

---

# 13. Disable Quick Login

If the driver chooses:

> Disable Quick Login

require appropriate authentication before disabling it if the current session/security policy requires it.

After disabling:

```text
App reopen
    ↓
Normal authentication
```

The underlying account remains intact.

---

# 14. Change PIN

Changing the PIN should require appropriate verification.

Recommended:

```text
Current PIN / biometric
        ↓
New PIN
        ↓
Confirm new PIN
        ↓
Securely replace local PIN credential
```

Do not require a network request simply to change a local PIN unless the existing security architecture requires server-side registration.

---

# 15. Logout Behavior

Define clear semantics.

### "Sign out from this device"

Should:

- terminate the local authenticated session
- remove locally stored session credentials as appropriate
- disable Quick Login credentials associated with that session/device
- require normal authentication next time

### Normal session expiry

If the backend session expires:

```text
Quick Login
     ↓
Attempt session refresh
     ↓
Refresh unavailable/invalid
     ↓
Normal authentication required
```

Do not let PIN/biometric unlock bypass server authentication.

---

# 16. Device Binding

Quick Login should be associated with the specific trusted Android device/session.

Do not assume a PIN configured on one phone should automatically work on another phone.

The design should prevent simple copying of application data from creating a usable Quick Login credential on another device.

Reuse any existing Saarthi device identity architecture if present.

Do not create a conflicting device-registration system.

---

# 17. Android Auto Relationship

Quick Login is a **phone authentication mechanism**.

Do NOT put PIN entry or biometric authentication on the Android Auto car screen.

Desired flow:

```text
Driver
  ↓
Unlocks Saarthi on phone
  ↓
Authenticated Driver session
  ↓
Phone connects to Android Auto
  ↓
Saarthi Android Auto interface becomes available
```

The car display must not request the driver's Saarthi password/PIN.

Avoid entering credentials while driving.

---

# 18. Interaction With Vehicle Pairing

Quick Login must NOT automatically authorize a vehicle.

Example:

```text
Quick Login
    ↓
Restore Driver identity
    ↓
Fetch server state
    ↓
Existing assignment?
   ┌──────┴──────┐
  Yes            No
   ↓              ↓
Restore        Show vehicle
assignment     selection
```

Vehicle identification still uses:

- QR scanning
- vehicle-number entry

Authorization still requires:

- fleet approval
- existing assignment rules

Pairing still uses:

- existing vehicle-pairing mechanism

Quick Login must never bypass these controls.

---

# 19. Interaction With OBD

Quick Login only unlocks the Driver session.

It must not create a second OBD connection.

After session restoration:

```text
Quick Login
    ↓
Restore Driver session
    ↓
Restore vehicle/assignment
    ↓
Shared :core
    ↓
Existing OBD connection state
```

Preserve existing OBD behavior.

Do not generate simulated readings.

---

# 20. Interaction With Offline Mode

Quick Login should work according to the device's locally available authentication state, but important server-authoritative state must still be reconciled when connectivity is available.

Do not use Quick Login to bypass server-side authorization.

After unlocking:

- restore cached state where appropriate
- attempt token refresh
- synchronize with backend
- reconcile assignment/pairing/trip state

Reuse the existing offline architecture.

---

# 21. Security and Privacy

Do NOT log:

- PIN
- refresh token
- access token
- biometric result details
- sensitive authentication data

Do not send PINs to analytics.

Do not include credentials in crash reports.

Do not expose credentials through:

- screenshots
- debug logs
- clipboard
- notifications
- intents
- deep links

Use secure Android mechanisms.

---

# 22. Testing

Add unit/integration tests for:

### PIN

- create PIN
- confirm PIN
- mismatched PIN
- invalid PIN
- correct PIN
- incorrect PIN
- repeated incorrect attempts
- lockout
- PIN change
- PIN disable
- PIN reset/recovery

### Session

- session restored after app restart
- access token refresh
- expired refresh token
- invalid refresh token
- normal authentication fallback

### Biometrics

Test the application's biometric state handling:

- biometric available
- biometric unavailable
- authentication success
- authentication failure
- user cancellation
- lockout
- biometric enrollment changed
- secure key invalidation

Use Android test abstractions where appropriate rather than trying to fake real biometric hardware in unit tests.

### Device Binding

- Quick Login works on enrolled device
- copied/untrusted device cannot simply reuse the credential

### Vehicle Flow

- Quick Login does not bypass approval
- Quick Login does not bypass pairing
- QR still requires authorization
- vehicle number still requires authorization

### Android Auto

- authenticated Driver state is visible to Auto integration
- unauthenticated state is handled safely
- Auto does not request PIN
- Auto does not request password
- Auto does not request biometric interaction
- Auto reflects current driver/vehicle/trip state

---

# 23. Physical Device Validation

The feature must be tested on a real Android phone.

Validate:

1. Normal Saarthi login.
2. Enable Quick Login.
3. Create PIN.
4. Close app.
5. Reopen.
6. Unlock with PIN.
7. Confirm session restored.
8. Lock/reopen.
9. Test biometric.
10. Disable biometric.
11. Test PIN again.
12. Change PIN.
13. Test old PIN fails.
14. Test new PIN works.
15. Trigger repeated incorrect PIN attempts.
16. Confirm fallback to normal authentication.
17. Sign out from device.
18. Confirm Quick Login is removed.
19. Sign in normally again.
20. Re-enable Quick Login.
21. Scan vehicle QR.
22. Enter vehicle number through the alternative flow.
23. Confirm approval is still required.
24. Confirm pairing is still required.
25. Connect ELM327.
26. Confirm OBD continues working.
27. Connect Android Auto.
28. Confirm Auto works only after the phone session is authenticated.

Do not claim biometric support based solely on compilation.

---

# 24. Acceptance Criteria

The implementation is successful when:

- There remains only one Saarthi Driver APK.
- Existing login still works.
- Existing refresh-token/session behavior still works.
- Driver can create a 4-digit Saarthi PIN.
- PIN is never stored or transmitted as plaintext.
- Driver can unlock Saarthi using the PIN.
- Driver can enable Android-supported biometrics.
- Driver can unlock Saarthi using biometrics.
- PIN and biometrics can coexist.
- Failed PIN attempts are protected against brute force.
- Quick Login is device/session-bound.
- Logout removes Quick Login access appropriately.
- Session expiry forces normal authentication when required.
- Quick Login cannot bypass fleet approval.
- Quick Login cannot bypass vehicle pairing.
- QR vehicle selection continues working.
- Vehicle-number entry continues working.
- OBD behavior is unchanged.
- Android Auto never asks the driver for Saarthi credentials.
- Existing `:terminal` is not broken.
- Existing tests continue passing.
- New security/authentication tests pass.
- Real-device validation confirms PIN and biometric behavior.

---

# 25. Final Implementation Report

At completion, provide:

1. Files changed.
2. Existing authentication functionality reused.
3. Secure storage mechanism selected and why.
4. PIN implementation status.
5. Biometric implementation status.
6. Device-binding implementation status.
7. Lockout implementation.
8. Logout behavior.
9. Session-expiry behavior.
10. Android Auto interaction.
11. Tests added.
12. Tests passed.
13. `:core` build result.
14. `:terminal` build result.
15. `:driver` build result.
16. Physical-device validation status.
17. Any remaining limitations.

Clearly distinguish:

- **IMPLEMENTED + TESTED**
- **IMPLEMENTED + BUILD VERIFIED**
- **REQUIRES PHYSICAL DEVICE VALIDATION**

Never claim biometric or PIN functionality works on real hardware unless it has actually been tested.

---

# Final Architectural Principle

Saarthi should have:

```text
                  SAARTHI DRIVER APK
                         │
             ┌───────────┴───────────┐
             │                       │
        Normal Login          Saarthi Quick Login
             │                 ┌─────┴─────┐
             │                 │           │
             │                PIN      Biometrics
             │                 │           │
             └─────────────────┴───────────┘
                         │
                  Existing Session
                         │
                   Shared :core
                         │
        ┌────────────────┼────────────────┐
        │                │                │
     Vehicle           OBD             Trips
    QR / Number       GPS/Telemetry    Cockpit
        │                │                │
        └────────────────┼────────────────┘
                         │
                    Android Auto
                         │
                  Car Display UI
```

**Quick Login is a secure convenience layer, not a replacement for Saarthi's real authentication or authorization system.**
