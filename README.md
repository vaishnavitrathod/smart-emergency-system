# Smart Emergency Response

Smart Emergency Response coordinates SOS reports, verified responders, emergency operators, and system administrators. It is designed for use in a community, workplace, public venue, or campus. It supports local emergency services and does not replace them. Configure the official local emergency number before deployment.

## What is included

- Email and password accounts for users. An email-domain restriction is optional. Phone numbers are optional; SMS OTP verification can be enabled with Twilio Verify.
- Responder applications with administrator approval, verified status, specialties, duty controls, live foreground location, and category-aware dispatch.
- Incident IDs in the `INC-YYYYMMDD-XXXX` format, silent SOS, anonymous reporting, saved contacts, safe-journey timers, offline retry, and incident status tracking.
- Automatic assignment to the nearest available matching responder. An unaccepted assignment is offered again after 60 seconds; open requests escalate after two minutes.
- Operator and administrator dashboards with a live map, filters, manual assignment, analytics, CSV export, and role-appropriate access. Administrators can approve responders, manage accounts and partners, and review audit history.
- OpenStreetMap searches for nearby hospitals, police stations, and fire stations; address lookup; and adaptive walking or driving routes. Map data may be incomplete or outdated.
- Owner-managed Medical ID. The user, assigned responder, and authorized operations staff can retrieve it through the API while an incident is open.
- English and Hindi for core user flows. First-aid protocols are fixed, source-linked adult guidance in English, with read-aloud support.

## Architecture

1. Expo React Native and React Native Web share the JavaScript app. Native maps use `react-native-maps`; web maps use Leaflet.
2. Firebase Authentication handles accounts. Firestore stores user profiles, incidents, private identity, contacts, safe journeys, Medical IDs, partners, audit events, and public tracking records.
3. The Flask API verifies Firebase ID tokens and owns dispatch, incident transitions, contact SMS, phone OTP, and protected Medical ID access.
4. A single in-process Flask worker polls Firestore, retries assignments, escalates incidents, triggers missed safe-journey check-ins, and purges retained location data.
5. Expo push notifications alert users, responders, operators, and administrators. Twilio sends contact SMS if configured; otherwise the app records mock mode.

The worker runs inside the Flask process. Deploy one always-running API instance with one Gunicorn worker. Scale-to-zero hosting pauses dispatch and safe-journey checks.

## Requirements

- Windows 10/11 with PowerShell.
- Node.js 24.12 or newer and Python 3.10 or newer.
- A Firebase project with Email/Password Authentication, Firestore, and Hosting.
- A stable HTTPS host for the Flask API in production.

The commands below assume the repository is at `C:\Projects\smart-emergency`. Replace that path if needed.

## Firebase setup

1. In Firebase Console, enable **Authentication → Sign-in method → Email/Password**.
2. Create a Firestore database and register a Firebase Web app.
3. Copy the Firebase Web app config into `app/.env` using the names in `app/.env.example`.
4. Install the Firebase CLI if needed, sign in, and deploy the rules and indexes:

   ```powershell
   npm install --global firebase-tools
   firebase login
   Set-Location C:\Projects\smart-emergency\app
   firebase use --add
   firebase deploy --only firestore:rules,firestore:indexes
   ```

5. Build and deploy the web app after configuring the app and API:

   ```powershell
   Set-Location C:\Projects\smart-emergency\app
   npx expo export --platform web
   firebase deploy --only hosting
   ```

Firebase Hosting serves the app at `/` and the public tracking view at `/track/<incidentId>`.

## Configure and run the app

```powershell
Set-Location C:\Projects\smart-emergency\app
Copy-Item .env.example .env
notepad .env
npm install
npx expo start --web
```

For Expo Go on a phone, run `npx expo start`, scan the QR code, and set `EXPO_PUBLIC_API_URL` to the PC's LAN address, such as `http://192.168.1.20:5000`. Restart Expo with `npx expo start -c` after changing environment variables.

Important app settings:

| Variable | Purpose |
| --- | --- |
| `EXPO_PUBLIC_API_URL` | Flask API base URL. Use HTTPS in production. |
| `EXPO_PUBLIC_EMERGENCY_NUMBER` | Official emergency number for the deployment region. There is no region-specific default. |
| `EXPO_PUBLIC_LOCAL_RESPONSE_NUMBER` | Optional local response or organization number. |
| `EXPO_PUBLIC_ALLOWED_EMAIL_DOMAIN` | Optional domain restriction without `@`. Leave blank to accept any valid email domain. |
| `EXPO_PUBLIC_DEFAULT_COUNTRY_CODE` | Optional digits-only country code for phone numbers entered without `+`. |
| `EXPO_PUBLIC_MAP_CENTER` | Optional initial map center as `latitude,longitude`. User GPS normally centers maps. |
| `EXPO_PUBLIC_SUPPORTED_LANGUAGES` | Comma-separated language codes. Defaults to `en,hi`. |
| `EXPO_PUBLIC_TRACKING_BASE_URL` | Public HTTPS web origin used in contact SMS links. |
| `EXPO_PUBLIC_OSRM_FOOT_URL`, `EXPO_PUBLIC_OSRM_DRIVING_URL` | Optional routing providers. |
| `EXPO_PUBLIC_OVERPASS_URLS`, `EXPO_PUBLIC_NOMINATIM_URL` | Optional OpenStreetMap provider endpoints. |
| `EXPO_PUBLIC_FIREBASE_*` | Firebase Web app configuration values. |

Use `app/.env.example` as the full list. Do not put Firebase Admin, Twilio, or Anthropic secrets in the Expo app environment.

## Configure and run the Flask API

Use Firebase Admin credentials only on the server. Prefer Application Default Credentials or a service-account JSON path. The app folder ignores service-account JSON files; never commit or copy a key into the client bundle.

```powershell
Set-Location C:\Projects\smart-emergency\backend
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
Copy-Item .env.example .env
notepad .env
python -m flask --app app run --host 0.0.0.0 --port 5000
```

Set backend variables in `backend/.env` or the host's secret manager:

| Variable | Purpose |
| --- | --- |
| `FIREBASE_PROJECT_ID` | Firebase project ID used by the client. |
| `GOOGLE_APPLICATION_CREDENTIALS` | Server path to the Firebase Admin service-account JSON file. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Alternative server-side JSON value. Use one credential source only. |
| `DISPATCH_WORKER_ENABLED` | Set `true` to run dispatch and safe-journey polling. |
| `LOCATION_RETENTION_DAYS` | Closed incident, responder, and safe-journey location retention; defaults to 30 days. |
| `CORS_ORIGINS` | Comma-separated allowed browser origins. `*` is for local development; use the exact production origin in deployment. |
| `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM` | Twilio credentials and sender for contact SMS. `TWILIO_FROM` must be a Twilio-approved sender in E.164 format. |
| `TWILIO_VERIFY_SERVICE_SID` | Optional Twilio Verify service for SMS phone OTP. This is separate from the contact-SMS sender. |
| `PUBLIC_TRACKING_BASE_URL` | Public web origin used in contact SMS tracking links. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Optional incident classifier. Keyword fallback is used without a working key. |
| `LOG_LEVEL` | Optional Flask log level. |

Deploy the `backend` directory to a Python host with an always-running process and environment secrets. The Procfile runs:

```text
gunicorn --workers 1 --threads 8 app:app
```

Run one instance only. `/health` is the unauthenticated health check.

## First administrator and responder setup

1. Register a normal account in the app and sign out.
2. Configure backend Firebase Admin credentials, then promote that account:

   ```powershell
   Set-Location C:\Projects\smart-emergency\backend
   python .\bootstrap_admin.py your-admin@example.com
   ```

3. Sign in again. Administrators can assign `user`, `operator`, or `admin` roles from the operations dashboard.
4. A user can apply for a responder specialty in **Profile**. An administrator approves or rejects the application. Only verified responders can go on duty or receive assignments.
5. If a response organization uses fixed sites or landmarks, administrators may add them under **Configured locations**. Nearby emergency service search does not depend on those records.

## Phone OTP and SMS

Phone OTP is optional. To enable it, create a Twilio Verify service and configure `TWILIO_SID`, `TWILIO_TOKEN`, and `TWILIO_VERIFY_SERVICE_SID` on the backend. Users can request and confirm a code in **Profile**. Without these settings, account creation and ordinary app use still work, but phone verification is unavailable.

For contact SMS, configure `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`, and `PUBLIC_TRACKING_BASE_URL`. Saved contact phone numbers must include a country code. Missing contact-SMS settings produce `mock` mode; the app does not claim an SMS was delivered.

## Privacy and emergency-service notes

- Exact location is shared with dispatch during an open incident, while a safe-journey timer is active, and while a verified responder is on duty. Location capture is foreground-only.
- Closed incident locations, expired safe-journey location records, and stale responder location are purged after `LOCATION_RETENTION_DAYS` (30 by default). User identity and incident descriptions have separate lifecycles.
- Anonymous reports keep name, email, phone, and account ID in a private record. Responders do not receive that identity. Administrators can use the protected identity endpoint for follow-up.
- Anyone with a public tracking link can see the current incident location while it is open. The view freezes when closed; retained location is later purged.
- Medical ID is private and served to the incident owner, assigned responder, or authorized operations staff only while the incident is open.
- OpenStreetMap, Overpass, Nominatim, and OSRM data or availability can vary. Confirm emergency locations and routes with local authorities.
- First-aid cards are adult protocols and do not replace dispatch advice, training, or medical care. They link to the British Red Cross and NHS source pages.

## Verification checklist

From the repository root:

```powershell
Set-Location C:\Projects\smart-emergency\app
npx expo export --platform web
Set-Location C:\Projects\smart-emergency\backend
python -m py_compile app.py bootstrap_admin.py
```

Then verify in the configured Firebase project: register a user, submit and approve a responder application, go on duty and accept a test incident, observe 60-second reassignment and two-minute escalation, test safe-journey expiry, test SMS mock and configured modes, confirm anonymous identity access is admin-only, and confirm the tracking location is removed after the configured retention period.
