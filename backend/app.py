import json
import logging
import math
import os
import re
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from functools import wraps

from dotenv import load_dotenv
from flask import Flask, abort, g, has_request_context, jsonify, request
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

load_dotenv()

app = Flask(__name__)
CORS(app, origins=os.environ.get("CORS_ORIGINS", "*").split(","))
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
logger = logging.getLogger("emergency-response")

CATEGORIES = {"Medical", "Fire", "Crime/Safety", "Accident", "Harassment", "Natural hazard", "Other"}
RESPONDER_TYPES = {"medical", "security", "fire", "volunteer"}
PRIORITIES = {"Critical", "High", "Medium", "Low"}
INCIDENT_STATUSES = {"ACTIVE", "ASSIGNED", "EN_ROUTE", "ARRIVED", "RESOLVED", "CANCELLED", "ESCALATED"}
OPEN_STATUSES = {"ACTIVE", "ASSIGNED", "EN_ROUTE", "ARRIVED", "ESCALATED"}
MAX_INPUT = 1000
ACCEPT_TIMEOUT_SECONDS = 60
ESCALATION_SECONDS = 120
FRESH_RESPONDER_SECONDS = 120
DISPATCH_POLL_SECONDS = 5
SYSTEM_PROMPT = (
    "You classify emergency reports. Respond with JSON only, no prose, no code fences. "
    'Schema: {"type": "Medical|Fire|Crime/Safety|Accident|Harassment|Natural hazard|Other", '
    '"priority": "Critical|High|Medium|Low", "action": "<short imperative sentence>"}. '
    "Reports may be written in any language. Classify their meaning but return category and action in English. "
    "Never give medical procedure steps. For Critical and High priority the action must tell the user to contact emergency services."
)

RULES = [
    (r"unconscious|not breathing|not responding|seizure|bleeding|choking|overdose", "Medical", "Critical"),
    (r"fire|smoke|explosion|gas leak", "Fire", "Critical"),
    (r"earthquake|flood|landslide|hurricane|cyclone|tornado|wildfire|storm|lightning|avalanche", "Natural hazard", "Critical"),
    (r"harass|stalk|bully|sexual harassment", "Harassment", "High"),
    (r"assault|weapon|robbery|threat|unsafe|break-in|crime|attack", "Crime/Safety", "High"),
    (r"accident|crash|fell|trapped", "Accident", "High"),
    (r"pain|fever|dizzy", "Medical", "Medium"),
]

_firebase_lock = threading.Lock()
_firebase_services = None
_rate_lock = threading.Lock()
_classify_hits = defaultdict(deque)
_phone_verification_hits = defaultdict(deque)
_dispatch_lock = threading.Lock()
_last_retention_sweep = 0


def default_action(priority):
    if priority in ("Critical", "High"):
        return "Call emergency services"
    return "Stay safe and monitor the situation; call emergency services if it worsens"


def fallback_classify(text):
    for pattern, category, priority in RULES:
        if re.search(pattern, text.lower()):
            return {"type": category, "priority": priority, "action": default_action(priority), "source": "fallback"}
    return {"type": "Other", "priority": "Medium", "action": default_action("Medium"), "source": "fallback"}


def validate_classification(data):
    category = data.get("type")
    priority = data.get("priority")
    action = data.get("action")
    category = category if category in CATEGORIES else "Other"
    priority = priority if priority in PRIORITIES else "Medium"
    if not isinstance(action, str) or not action.strip():
        action = default_action(priority)
    action = action.strip()
    if priority in ("Critical", "High") and "emergency" not in action.lower():
        action = "Call emergency services. " + action
    return {"type": category, "priority": priority, "action": action, "source": "ai"}


def ai_classify(text):
    import anthropic

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    message = client.messages.create(
        model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5-5"),
        max_tokens=200,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": text}],
    )
    raw = "".join(block.text for block in message.content if getattr(block, "text", None))
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not match:
        raise ValueError("no JSON in model output")
    return validate_classification(json.loads(match.group(0)))


def firebase_services():
    global _firebase_services
    if _firebase_services:
        return _firebase_services
    with _firebase_lock:
        if _firebase_services:
            return _firebase_services
        import firebase_admin
        from firebase_admin import auth as admin_auth
        from firebase_admin import credentials, firestore

        try:
            firebase_admin.get_app()
        except ValueError:
            service_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
            if service_json:
                credential = credentials.Certificate(json.loads(service_json))
            elif os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
                credential = credentials.Certificate(os.environ["GOOGLE_APPLICATION_CREDENTIALS"])
            else:
                credential = credentials.ApplicationDefault()
            options = {}
            if os.environ.get("FIREBASE_PROJECT_ID"):
                options["projectId"] = os.environ["FIREBASE_PROJECT_ID"]
            firebase_admin.initialize_app(credential, options or None)
        _firebase_services = (admin_auth, firestore, firestore.client())
        return _firebase_services


def authenticated(handler):
    @wraps(handler)
    def wrapped(*args, **kwargs):
        authorization = request.headers.get("Authorization", "")
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token.strip():
            return jsonify({"error": "A Firebase ID token is required."}), 401
        try:
            admin_auth, _, db = firebase_services()
            g.identity = admin_auth.verify_id_token(token.strip(), check_revoked=True)
            g.db = db
        except Exception as error:
            logger.warning("API authentication failed: %s", error)
            return jsonify({"error": "Authentication failed or Firebase Admin is not configured."}), 401
        return handler(*args, **kwargs)

    return wrapped


def user_profile(uid):
    snapshot = g.db.collection("users").document(uid).get()
    if not snapshot.exists:
        abort(403, "An active user profile is required.")
    profile = snapshot.to_dict()
    if profile.get("disabled"):
        abort(403, "This account has been deactivated.")
    return profile


def normalized_role(profile):
    return {"student": "user", "guard": "responder"}.get(profile.get("role"), profile.get("role"))


def require_role(*roles):
    profile = user_profile(g.identity["uid"])
    allowed = {"user" if role == "student" else "responder" if role == "guard" else role for role in roles}
    if normalized_role(profile) not in allowed:
        abort(403, "This action is not allowed for your role.")
    return profile


def is_operator_or_admin(profile):
    return normalized_role(profile) in {"operator", "admin"}


def get_incident_ref(incident_id):
    if not re.fullmatch(r"[A-Za-z0-9-]{4,80}", incident_id or ""):
        abort(400, "Invalid incident ID.")
    return g.db.collection("incidents").document(incident_id)


def require_incident(ref):
    snapshot = ref.get()
    if not snapshot.exists:
        abort(404, "Incident not found.")
    return snapshot.to_dict()


def incident_owner_id(db, incident_id, incident):
    owner = incident.get("userId")
    if owner:
        return owner
    private_snapshot = db.collection("incidentsPrivate").document(incident_id).get()
    return private_snapshot.to_dict().get("userId") if private_snapshot.exists else None


def now_utc():
    return datetime.now(timezone.utc)


def age_seconds(value):
    if not value:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return max(0, (now_utc() - value).total_seconds())


def append_timeline(data, status, by, at=None):
    timeline = list(data.get("timeline") or [])
    timeline.append({"status": status, "at": at or now_utc(), "by": by})
    return timeline


def write_audit(db, action, target_type, target_id, details=None):
    db.collection("auditLog").add({
        "actorId": g.identity["uid"] if has_request_context() and getattr(g, "identity", None) else "system",
        "action": action,
        "targetType": target_type,
        "targetId": target_id,
        "details": details or {},
        "createdAt": now_utc(),
    })


def record_false_alarm(db, uid):
    if not uid:
        return False
    _, firestore, _ = firebase_services()
    profile_ref = db.collection("users").document(uid)
    transaction = db.transaction()
    now = now_utc()

    @firestore.transactional
    def update_review_flag(txn):
        snapshot = profile_ref.get(transaction=txn)
        if not snapshot.exists:
            return False
        profile = snapshot.to_dict()
        recent = [value for value in profile.get("falseAlarmCancellations", []) if age_seconds(value) is not None and age_seconds(value) < 86400]
        recent.append(now)
        newly_flagged = len(recent) >= 3 and not profile.get("reviewFlag")
        txn.update(profile_ref, {
            "falseAlarmCancellations": recent[-10:],
            "reviewFlag": bool(profile.get("reviewFlag") or len(recent) >= 3),
            "reviewFlagReason": "Three false-alarm cancellations within 24 hours" if len(recent) >= 3 else profile.get("reviewFlagReason", ""),
            "reviewFlagAt": now if newly_flagged else profile.get("reviewFlagAt"),
        })
        return newly_flagged

    return update_review_flag(transaction)


def distance_meters(a, b):
    radians = lambda value: value * math.pi / 180
    d_lat = radians(b["lat"] - a["lat"])
    d_lng = radians(b["lng"] - a["lng"])
    haversine = math.sin(d_lat / 2) ** 2 + math.cos(radians(a["lat"])) * math.cos(radians(b["lat"])) * math.sin(d_lng / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(haversine))


def valid_location(value):
    if not isinstance(value, dict):
        return False
    try:
        lat = float(value.get("lat"))
        lng = float(value.get("lng"))
        return -90 <= lat <= 90 and -180 <= lng <= 180
    except (TypeError, ValueError):
        return False


def send_expo_push(tokens, title, body, data=None, silent=False):
    usable = [
        token for token in tokens
        if isinstance(token, str) and token.startswith(("ExponentPushToken[", "ExpoPushToken["))
    ]
    if not usable:
        return
    try:
        import requests

        payload = [
            {
                "to": token,
                "title": title,
                "body": body,
                "data": {**(data or {}), **({"silent": True} if silent else {})},
                "sound": None if silent else "default",
            }
            for token in usable
        ]
        response = requests.post(
            "https://exp.host/--/api/v2/push/send",
            json=payload,
            headers={"Accept": "application/json", "Content-Type": "application/json"},
            timeout=8,
        )
        response.raise_for_status()
    except Exception as error:
        logger.warning("Expo push request failed: %s", error)


def notify_user(db, uid, title, body, data=None, silent=False):
    if not uid:
        return
    snapshot = db.collection("users").document(uid).get()
    if snapshot.exists:
        send_expo_push([snapshot.to_dict().get("pushToken")], title, body, data, silent=silent)


def notify_admins(db, incident_id):
    for snapshot in db.collection("users").stream():
        profile = snapshot.to_dict()
        if normalized_role(profile) in {"operator", "admin"} and not profile.get("disabled"):
            send_expo_push(
                [profile.get("pushToken")],
                "Emergency incident needs attention",
                f"Incident {incident_id} has been escalated.",
                {"incidentId": incident_id},
            )


def sync_public_tracking(db, incident_id, incident):
    location = incident.get("userLocation") or incident.get("location")
    record = {
        "status": incident.get("status", "ACTIVE"),
        "generalArea": incident.get("generalArea"),
        "nearestLandmark": incident.get("nearestLandmark"),
        "landmarkDistanceM": incident.get("landmarkDistanceM"),
        "frozen": incident.get("status") in {"RESOLVED", "CANCELLED"},
        "updatedAt": now_utc(),
    }
    if valid_location(location):
        record["userLocation"] = {"lat": float(location["lat"]), "lng": float(location["lng"])}
    db.collection("publicTracking").document(incident_id).set(record, merge=True)


def responder_matches(category, responder_type):
    responder_type = responder_type if responder_type in RESPONDER_TYPES else "volunteer"
    category = category or "Other"
    if category == "Medical":
        return responder_type in {"medical", "volunteer"}
    if category == "Fire":
        return responder_type == "fire"
    if category in {"Crime/Safety", "Harassment"}:
        return responder_type == "security"
    return True


def available_responders(db, category=None):
    result = []
    for snapshot in db.collection("users").stream():
        profile = snapshot.to_dict()
        role = normalized_role(profile)
        verified = bool(profile.get("verified")) or profile.get("role") == "guard"
        seen = profile.get("lastSeen")
        if role != "responder" or not verified or profile.get("disabled") or not profile.get("onDuty") or not valid_location(profile.get("location")):
            continue
        if not responder_matches(category, profile.get("responderType")):
            continue
        if not seen or age_seconds(seen) is None or age_seconds(seen) > FRESH_RESPONDER_SECONDS:
            continue
        result.append({"id": snapshot.id, **profile})
    return result


def available_guards(db):
    # Older installations used the "guard" role; keep its alias during migration.
    return available_responders(db)


def active_guard_ids(db, exclude_incident_id=None):
    occupied = set()
    for snapshot in db.collection("incidents").stream():
        if snapshot.id == exclude_incident_id:
            continue
        data = snapshot.to_dict()
        assigned = data.get("assignedResponderId") or data.get("assignedGuardId")
        if data.get("status") in OPEN_STATUSES and assigned:
            occupied.add(assigned)
    return occupied


def escalate_incident(db, ref, data, reason):
    _, firestore, _ = firebase_services()
    transaction = db.transaction()

    @firestore.transactional
    def apply(txn):
        snapshot = ref.get(transaction=txn)
        if not snapshot.exists:
            return False
        latest = snapshot.to_dict()
        if latest.get("status") in {"RESOLVED", "CANCELLED"} or latest.get("acceptedAt"):
            return False
        if latest.get("status") == "ESCALATED" and latest.get("escalationNotifiedAt"):
            return False
        now = now_utc()
        txn.update(
            ref,
            {
                "status": "ESCALATED",
                "assignedResponderId": None,
                "assignedResponderName": None,
                "assignedGuardId": None,
                "assignedGuardName": None,
                "assignedAt": None,
                "escalationLevel": int(latest.get("escalationLevel") or 0) + 1,
                "escalationReason": reason,
                "escalatedAt": now,
                "escalationNotifiedAt": now,
                "timeline": append_timeline(latest, "ESCALATED", "dispatch", now),
            },
        )
        return True

    changed = apply(transaction)
    if changed:
        updated = require_incident(ref)
        sync_public_tracking(db, ref.id, updated)
        notify_user(db, incident_owner_id(db, ref.id, updated), "Incident escalated", "Operations staff have been alerted and are coordinating a response.", {"incidentId": ref.id}, silent=bool(updated.get("silent")))
        notify_admins(db, ref.id)
    return changed


def dispatch_incident(db, ref, data=None):
    data = data or require_incident(ref)
    status = data.get("status")
    if status not in {"ACTIVE", "ESCALATED"} or data.get("assignedResponderId") or data.get("assignedGuardId") or data.get("acceptedAt"):
        return None
    responders = available_responders(db, data.get("category") or data.get("type"))
    created_age = age_seconds(data.get("createdAt")) or 0
    if created_age >= ESCALATION_SECONDS and status != "ESCALATED":
        escalate_incident(db, ref, data, "no responder accepted within two minutes")
        return None
    if not responders:
        return None

    occupied = active_guard_ids(db, ref.id)
    declined = set(data.get("declinedGuardIds") or [])
    origin = data.get("userLocation") or data.get("location")
    candidates = [responder for responder in responders if responder["id"] not in occupied and responder["id"] not in declined]
    if not candidates:
        if created_age >= ESCALATION_SECONDS and status != "ESCALATED":
            escalate_incident(db, ref, data, "no available responder accepted within two minutes")
        return None
    if valid_location(origin):
        candidates.sort(key=lambda responder: distance_meters(origin, responder["location"]))
    responder = candidates[0]
    _, firestore, _ = firebase_services()
    transaction = db.transaction()

    @firestore.transactional
    def apply(txn):
        snapshot = ref.get(transaction=txn)
        if not snapshot.exists:
            return None
        latest = snapshot.to_dict()
        if latest.get("status") not in {"ACTIVE", "ESCALATED"} or latest.get("assignedResponderId") or latest.get("assignedGuardId") or latest.get("acceptedAt"):
            return None
        now = now_utc()
        responder_name = responder.get("name") or "Emergency responder"
        txn.update(
            ref,
            {
                "status": "ASSIGNED",
                "assignedResponderId": responder["id"],
                "assignedResponderName": responder_name,
                "assignedGuardId": responder["id"],
                "assignedGuardName": responder_name,
                "assignedAt": now,
                "acceptedAt": None,
                "escalationNotifiedAt": None,
                "timeline": append_timeline(latest, "ASSIGNED", "dispatch", now),
            },
        )
        return {"responderId": responder["id"], "responderName": responder_name}

    assignment = apply(transaction)
    if not assignment:
        return None
    updated_incident = require_incident(ref)
    sync_public_tracking(db, ref.id, updated_incident)
    send_expo_push(
        [responder.get("pushToken")],
        "New emergency assignment",
        f"{data.get('type', 'Emergency')} · {data.get('priority', 'High')}",
        {"incidentId": ref.id},
    )
    notify_user(db, incident_owner_id(db, ref.id, updated_incident), "Responder assigned", f"{responder.get('name') or 'A responder'} is responding.", {"incidentId": ref.id}, silent=bool(updated_incident.get("silent")))
    return assignment


def requeue_after_timeout(db, ref, data):
    responder_id = data.get("assignedResponderId") or data.get("assignedGuardId")
    if not responder_id:
        return
    _, firestore, _ = firebase_services()
    transaction = db.transaction()

    @firestore.transactional
    def apply(txn):
        snapshot = ref.get(transaction=txn)
        if not snapshot.exists:
            return None
        latest = snapshot.to_dict()
        latest_assigned = latest.get("assignedResponderId") or latest.get("assignedGuardId")
        if latest.get("status") != "ASSIGNED" or latest.get("acceptedAt") or latest_assigned != responder_id:
            return None
        if (age_seconds(latest.get("assignedAt")) or 0) < ACCEPT_TIMEOUT_SECONDS:
            return None
        declined = list(latest.get("declinedGuardIds") or [])
        if responder_id not in declined:
            declined.append(responder_id)
        now = now_utc()
        txn.update(
            ref,
            {
                "status": "ACTIVE",
                "assignedResponderId": None,
                "assignedResponderName": None,
                "assignedGuardId": None,
                "assignedGuardName": None,
                "assignedAt": None,
                "acceptedAt": None,
                "declinedGuardIds": declined,
                "escalationLevel": int(latest.get("escalationLevel") or 0) + 1,
                "timeline": append_timeline(latest, "ACTIVE", "dispatch", now),
            },
        )
        return latest

    updated = apply(transaction)
    if updated:
        sync_public_tracking(db, ref.id, require_incident(ref))
        notify_user(db, incident_owner_id(db, ref.id, updated), "Finding another responder", "The assigned responder could not accept. Dispatch is contacting another responder.", {"incidentId": ref.id}, silent=bool(updated.get("silent")))


def dispatch_tick(db):
    with _dispatch_lock:
        for snapshot in db.collection("incidents").stream():
            data = snapshot.to_dict()
            status = data.get("status")
            if status not in {"ACTIVE", "ASSIGNED", "ESCALATED"}:
                continue
            ref = snapshot.reference
            created_age = age_seconds(data.get("createdAt")) or 0
            if status == "ASSIGNED" and not data.get("acceptedAt"):
                if created_age >= ESCALATION_SECONDS:
                    escalate_incident(db, ref, data, "no responder accepted within two minutes")
                    continue
                assignment_age = age_seconds(data.get("assignedAt"))
                if assignment_age is not None and assignment_age >= ACCEPT_TIMEOUT_SECONDS:
                    requeue_after_timeout(db, ref, data)
                    data = require_incident(ref)
                    dispatch_incident(db, ref, data)
                continue
            if not data.get("assignedResponderId") and not data.get("assignedGuardId"):
                dispatch_incident(db, ref, data)
    process_expired_safe_walks(db)
    purge_expired_locations(db)


def purge_expired_locations(db):
    global _last_retention_sweep
    now_epoch = time.time()
    if now_epoch - _last_retention_sweep < 86400:
        return
    _last_retention_sweep = now_epoch
    retention_days = max(1, int(os.environ.get("LOCATION_RETENTION_DAYS", "30")))
    _, firestore, _ = firebase_services()
    cutoff_seconds = retention_days * 86400
    for snapshot in db.collection("incidents").stream():
        incident = snapshot.to_dict()
        if incident.get("status") not in {"RESOLVED", "CANCELLED"} or incident.get("locationPurgedAt"):
            continue
        closed_at = incident.get("resolvedAt") or incident.get("cancelledAt") or incident.get("createdAt")
        if age_seconds(closed_at) is None or age_seconds(closed_at) < cutoff_seconds:
            continue
        now = now_utc()
        snapshot.reference.update({
            "location": firestore.DELETE_FIELD,
            "userLocation": firestore.DELETE_FIELD,
            "address": firestore.DELETE_FIELD,
            "generalArea": firestore.DELETE_FIELD,
            "nearestLandmark": firestore.DELETE_FIELD,
            "landmarkDistanceM": firestore.DELETE_FIELD,
            "locationPurgedAt": now,
        })
        db.collection("publicTracking").document(snapshot.id).set({
            "userLocation": firestore.DELETE_FIELD,
            "generalArea": firestore.DELETE_FIELD,
            "nearestLandmark": firestore.DELETE_FIELD,
            "landmarkDistanceM": firestore.DELETE_FIELD,
            "locationPurgedAt": now,
            "frozen": True,
            "updatedAt": now,
        }, merge=True)
        logger.info("Purged retained location for incident %s after %s days", snapshot.id, retention_days)

    for snapshot in db.collection("users").stream():
        profile = snapshot.to_dict()
        seen_age = age_seconds(profile.get("lastSeen") or profile.get("createdAt"))
        if profile.get("location") and seen_age is not None and seen_age >= cutoff_seconds:
            snapshot.reference.update({
                "location": firestore.DELETE_FIELD,
                "lastSeen": firestore.DELETE_FIELD,
                "onDuty": False,
            })

    for snapshot in db.collection("safeWalks").stream():
        walk = snapshot.to_dict()
        if walk.get("status") not in {"SAFE", "TRIGGERED", "ALERTED"}:
            continue
        ended_at = walk.get("checkedInAt") or walk.get("endsAt")
        ended_age = age_seconds(ended_at)
        if ended_age is not None and ended_age >= cutoff_seconds and not walk.get("locationPurgedAt"):
            snapshot.reference.update({
                "lastLocation": firestore.DELETE_FIELD,
                "lastLocationAt": firestore.DELETE_FIELD,
                "destination": firestore.DELETE_FIELD,
                "locationPurgedAt": now_utc(),
            })


def nearest_configured_site(db, location):
    if not valid_location(location):
        return None, None
    nearest = None
    distance = None
    for snapshot in db.collection("campusLocations").stream():
        item = snapshot.to_dict()
        if not valid_location(item):
            continue
        meters = distance_meters(location, item)
        if distance is None or meters < distance:
            nearest, distance = item.get("name"), meters
    return nearest, round(distance) if distance is not None else None


def process_expired_safe_walks(db):
    now = now_utc()
    for snapshot in db.collection("safeWalks").where("status", "in", ["ACTIVE", "TRIGGERED"]).stream():
        walk = snapshot.to_dict()
        ends_at = walk.get("endsAt")
        if not ends_at or walk.get("status") == "SAFE":
            continue
        if ends_at.tzinfo is None:
            ends_at = ends_at.replace(tzinfo=timezone.utc)
        if ends_at > now:
            continue
        walk_id = snapshot.id
        incident_id = walk.get("incidentId") or f"INC-{now:%Y%m%d}-{secrets.token_hex(2).upper()}"
        owner_id = walk.get("userId")
        owner_profile = db.collection("users").document(owner_id).get() if owner_id else None
        location = walk.get("lastLocation")
        if not valid_location(location) and owner_id:
            location = owner_profile.to_dict().get("location") if owner_profile and owner_profile.exists else None
        if not valid_location(location):
            destination = walk.get("destination") or {}
            location = destination if valid_location(destination) else None
        landmark, distance = nearest_configured_site(db, location)
        ref = db.collection("incidents").document(incident_id)
        if not ref.get().exists:
            incident = {
                "id": incident_id,
                "userId": owner_id,
                "location": location,
                "userLocation": location,
                "description": "Safe journey timer expired without a check-in.",
                "type": "Other",
                "category": "Other",
                "priority": "High",
                "recommendedAction": "Check in with the user and contact emergency services if needed.",
                "classifiedBy": "safe_walk",
                "nearestLandmark": landmark,
                "landmarkDistanceM": distance,
                "generalArea": landmark or "",
                "address": (walk.get("destination") or {}).get("address") or (walk.get("destination") or {}).get("name") or "",
                "status": "ACTIVE",
                "assignedGuardId": None,
                "assignedGuardName": None,
                "assignedResponderId": None,
                "assignedResponderName": None,
                "assignedAt": None,
                "acceptedAt": None,
                "arrivedAt": None,
                "resolvedAt": None,
                "cancelledAt": None,
                "escalationLevel": 0,
                "anonymous": False,
                "timeline": [{"status": "ACTIVE", "at": now, "by": owner_id or "safe_walk"}],
                "createdAt": now,
                "safeWalkId": walk_id,
            }
            batch = db.batch()
            batch.set(ref, incident)
            owner_data = owner_profile.to_dict() if owner_profile and owner_profile.exists else {}
            batch.set(db.collection("incidentsPrivate").document(incident_id), {
                "userId": owner_id,
                "name": owner_data.get("name", ""),
                "email": owner_data.get("email", ""),
                "phone": owner_data.get("phone", ""),
                "createdAt": now,
            })
            public_data = {
                "status": "ACTIVE", "nearestLandmark": landmark, "landmarkDistanceM": distance,
                "generalArea": landmark or "",
                "updatedAt": now, "frozen": False,
            }
            if valid_location(location):
                public_data["userLocation"] = location
            batch.set(db.collection("publicTracking").document(incident_id), public_data)
            batch.commit()
        db.collection("safeWalks").document(walk_id).set(
            {"status": "TRIGGERED", "incidentId": incident_id, "triggeredAt": now}, merge=True
        )
        incident_data = require_incident(ref)
        if not walk.get("expiryNotifiedAt"):
            mode = "none"
            sid = os.environ.get("TWILIO_SID", "").strip()
            token = os.environ.get("TWILIO_TOKEN", "").strip()
            sender = os.environ.get("TWILIO_FROM", "").strip()
            tracking_base = os.environ.get("PUBLIC_TRACKING_BASE_URL", "").rstrip("/")
            contacts = list(db.collection("contacts").where("userId", "==", owner_id).stream())[:3] if owner_id else []
            mode = "mock" if contacts else "none"
            if sid and token and sender and tracking_base and contacts:
                try:
                    import requests
                    message = f"Emergency response safe-journey alert {incident_id}: the user missed a check-in near {landmark or 'the reported area'}. Track: {tracking_base}/track/{incident_id}"
                    for contact_snapshot in contacts:
                        phone = str(contact_snapshot.to_dict().get("phone", "")).strip()
                        response = requests.post(
                            f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
                            auth=(sid, token),
                            data={"From": sender, "To": phone, "Body": message[:1500]},
                            timeout=10,
                        )
                        response.raise_for_status()
                    mode = "sent"
                except Exception:
                    logger.exception("Safe Walk contact SMS failed for %s", walk_id)
                    mode = "failed"
            ref.update({"contactSmsMode": mode})
            db.collection("safeWalks").document(walk_id).update({"expiryNotifiedAt": now})
            notify_user(db, owner_id, "Safe journey check-in missed", "Responders have been alerted because your check-in timer expired.", {"incidentId": incident_id})
            notify_admins(db, incident_id)
        with _dispatch_lock:
            dispatch_incident(db, ref, incident_data)
        db.collection("safeWalks").document(walk_id).set({"status": "ALERTED"}, merge=True)


def dispatch_worker():
    while True:
        try:
            _, _, db = firebase_services()
            dispatch_tick(db)
        except Exception as error:
            logger.warning("Dispatch worker cycle failed: %s", error)
        time.sleep(DISPATCH_POLL_SECONDS)


def start_dispatch_worker():
    enabled = os.environ.get("DISPATCH_WORKER_ENABLED", "true").lower() == "true"
    has_credentials = any(
        os.environ.get(name)
        for name in ("FIREBASE_PROJECT_ID", "FIREBASE_SERVICE_ACCOUNT_JSON", "GOOGLE_APPLICATION_CREDENTIALS")
    )
    if enabled and has_credentials:
        threading.Thread(target=dispatch_worker, name="emergency-response-dispatch", daemon=True).start()


def check_classify_limit():
    now = time.monotonic()
    key = request.remote_addr or "unknown"
    with _rate_lock:
        hits = _classify_hits[key]
        while hits and now - hits[0] >= 60:
            hits.popleft()
        if len(hits) >= 10:
            return False
        hits.append(now)
        return True


def check_phone_verification_limit(uid):
    now = time.monotonic()
    with _rate_lock:
        hits = _phone_verification_hits[uid]
        while hits and now - hits[0] >= 600:
            hits.popleft()
        if len(hits) >= 3:
            return False
        hits.append(now)
        return True


def validate_e164(phone):
    return isinstance(phone, str) and bool(re.fullmatch(r"\+[1-9]\d{7,14}", phone))


@app.errorhandler(HTTPException)
def json_http_error(error):
    return jsonify({"error": error.description}), error.code


@app.get("/health")
def health():
    return jsonify({"ok": True, "ai": bool(os.environ.get("ANTHROPIC_API_KEY"))})


@app.post("/phone-verification/start")
@authenticated
def start_phone_verification():
    user_profile(g.identity["uid"])
    body = request.get_json(silent=True)
    phone = body.get("phone") if isinstance(body, dict) else None
    service_sid = os.environ.get("TWILIO_VERIFY_SERVICE_SID", "").strip()
    sid = os.environ.get("TWILIO_SID", "").strip()
    token = os.environ.get("TWILIO_TOKEN", "").strip()
    if not validate_e164(phone):
        return jsonify({"error": "Enter a valid phone number in international format, such as +15555550123."}), 400
    if not service_sid or not sid or not token:
        return jsonify({"error": "Optional phone verification is not configured. Set Twilio Verify credentials on the backend."}), 503
    if not check_phone_verification_limit(g.identity["uid"]):
        return jsonify({"error": "Too many verification requests. Wait ten minutes before trying again."}), 429
    try:
        import requests
        response = requests.post(
            f"https://verify.twilio.com/v2/Services/{service_sid}/Verifications",
            auth=(sid, token),
            data={"To": phone, "Channel": "sms"},
            timeout=10,
        )
        if not response.ok:
            logger.warning("Twilio Verify could not start a phone challenge (HTTP %s).", response.status_code)
            return jsonify({"error": "The SMS verification could not be started. Check the phone number and Twilio Verify setup."}), 502
    except Exception:
        logger.exception("Twilio Verify request failed while starting a phone challenge.")
        return jsonify({"error": "The SMS verification service is temporarily unavailable."}), 502
    return jsonify({"sent": True})


@app.post("/phone-verification/check")
@authenticated
def check_phone_verification():
    profile = user_profile(g.identity["uid"])
    body = request.get_json(silent=True)
    phone = body.get("phone") if isinstance(body, dict) else None
    code = body.get("code") if isinstance(body, dict) else None
    service_sid = os.environ.get("TWILIO_VERIFY_SERVICE_SID", "").strip()
    sid = os.environ.get("TWILIO_SID", "").strip()
    token = os.environ.get("TWILIO_TOKEN", "").strip()
    if not validate_e164(phone) or not isinstance(code, str) or not re.fullmatch(r"\d{4,10}", code.strip()):
        return jsonify({"error": "Enter the phone number and SMS code."}), 400
    if not service_sid or not sid or not token:
        return jsonify({"error": "Optional phone verification is not configured. Set Twilio Verify credentials on the backend."}), 503
    try:
        import requests
        response = requests.post(
            f"https://verify.twilio.com/v2/Services/{service_sid}/VerificationCheck",
            auth=(sid, token),
            data={"To": phone, "Code": code.strip()},
            timeout=10,
        )
        if not response.ok:
            return jsonify({"error": "That verification code is invalid or expired."}), 400
        result = response.json()
    except Exception:
        logger.exception("Twilio Verify request failed while checking a phone challenge.")
        return jsonify({"error": "The SMS verification service is temporarily unavailable."}), 502
    if result.get("status") != "approved":
        return jsonify({"error": "That verification code is invalid or expired."}), 400
    g.db.collection("users").document(g.identity["uid"]).update({
        "phone": phone,
        "phoneVerified": True,
        "phoneVerifiedAt": now_utc(),
    })
    write_audit(g.db, "user.phone_verified", "user", g.identity["uid"])
    return jsonify({"verified": True})


@app.get("/operators/responders")
@authenticated
def operator_responders():
    require_role("operator", "admin")
    responders = []
    for snapshot in g.db.collection("users").stream():
        profile = snapshot.to_dict()
        if normalized_role(profile) != "responder" or profile.get("disabled"):
            continue
        if not profile.get("verified") and profile.get("role") != "guard":
            continue
        last_seen = profile.get("lastSeen")
        on_duty = bool(profile.get("onDuty"))
        location_is_fresh = (
            on_duty
            and valid_location(profile.get("location"))
            and age_seconds(last_seen) is not None
            and age_seconds(last_seen) <= FRESH_RESPONDER_SECONDS
        )
        responders.append({
            "id": snapshot.id,
            "name": profile.get("name") or "Responder",
            "responderType": profile.get("responderType") or "volunteer",
            "verified": True,
            "onDuty": on_duty,
            "location": profile.get("location") if location_is_fresh else None,
            "lastSeen": last_seen.isoformat() if last_seen else None,
        })
    return jsonify({"responders": responders})


@app.post("/classify")
@authenticated
def classify():
    if not check_classify_limit():
        return jsonify({"error": "Rate limit reached. Try again in a minute."}), 429
    body = request.get_json(silent=True)
    if not isinstance(body, dict) or not isinstance(body.get("text"), str):
        return jsonify({"error": "text must be a string."}), 400
    text = body["text"].strip()
    if not text:
        return jsonify({"error": "text is required."}), 400
    text = text[:MAX_INPUT]
    if os.environ.get("ANTHROPIC_API_KEY"):
        try:
            return jsonify(ai_classify(text))
        except Exception as error:
            logger.info("AI classification fell back to keyword rules: %s", error)
    return jsonify(fallback_classify(text))


@app.get("/guard/queue")
@app.get("/responder/queue")
@authenticated
def guard_queue():
    responder = require_role("responder")
    if not responder.get("verified") and responder.get("role") != "guard":
        abort(403, "An administrator must verify your responder application first.")
    if not responder.get("onDuty"):
        abort(403, "Go on duty to view the dispatch queue.")
    responders = available_responders(g.db)
    responder_location = next((item["location"] for item in responders if item["id"] == g.identity["uid"]), None)
    rows = []
    for snapshot in g.db.collection("incidents").stream():
        incident = snapshot.to_dict()
        if incident.get("status") not in {"ACTIVE", "ESCALATED"} or incident.get("assignedResponderId") or incident.get("assignedGuardId"):
            continue
        if not responder_matches(incident.get("category") or incident.get("type"), responder.get("responderType")):
            continue
        origin = incident.get("userLocation") or incident.get("location")
        row = {
            "id": snapshot.id,
            "status": incident.get("status"),
            "type": incident.get("type"),
            "category": incident.get("category") or incident.get("type"),
            "priority": incident.get("priority"),
            "description": incident.get("description", ""),
            "address": incident.get("address", ""),
            "generalArea": incident.get("generalArea", ""),
            "location": origin,
            "nearestLandmark": incident.get("nearestLandmark"),
            "landmarkDistanceM": incident.get("landmarkDistanceM"),
            "createdAt": incident.get("createdAt").isoformat() if incident.get("createdAt") else None,
            "anonymous": bool(incident.get("anonymous")),
        }
        owner_id = incident_owner_id(g.db, snapshot.id, incident)
        if not row["anonymous"] and owner_id:
            owner = g.db.collection("users").document(owner_id).get()
            if owner.exists:
                row["userName"] = owner.to_dict().get("name")
        row["distanceM"] = distance_meters(responder_location, origin) if valid_location(responder_location) and valid_location(origin) else None
        rows.append(row)
    priority_order = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3}
    rows.sort(key=lambda item: (priority_order.get(item.get("priority"), 4), item.get("distanceM") if item.get("distanceM") is not None else float("inf")))
    return jsonify({"incidents": rows})


@app.post("/incidents/<incident_id>/dispatch")
@authenticated
def dispatch_request(incident_id):
    ref = get_incident_ref(incident_id)
    incident = require_incident(ref)
    profile = user_profile(g.identity["uid"])
    if not is_operator_or_admin(profile) and incident_owner_id(g.db, incident_id, incident) != g.identity["uid"]:
        abort(403, "Only the incident owner or an operator can request dispatch.")
    with _dispatch_lock:
        assignment = dispatch_incident(g.db, ref, incident)
    try:
        notify_contacts(incident_id)
    except Exception as error:
        logger.warning("Contact notification deferred for %s: %s", incident_id, error)
    return jsonify({"assigned": bool(assignment), "assignment": assignment, "incidentId": incident_id})


@app.get("/incidents/<incident_id>/tracking")
@authenticated
def incident_tracking(incident_id):
    ref = get_incident_ref(incident_id)
    incident = require_incident(ref)
    profile = user_profile(g.identity["uid"])
    assigned_id = incident.get("assignedResponderId") or incident.get("assignedGuardId")
    can_read = (
        is_operator_or_admin(profile)
        or incident_owner_id(g.db, incident_id, incident) == g.identity["uid"]
        or assigned_id == g.identity["uid"]
    )
    if not can_read:
        abort(403, "You cannot view this incident's tracking data.")
    guard_location = None
    if assigned_id and incident.get("status") not in {"RESOLVED", "CANCELLED"}:
        responder_snapshot = g.db.collection("users").document(assigned_id).get()
        if responder_snapshot.exists:
            responder_profile = responder_snapshot.to_dict()
            last_seen = responder_profile.get("lastSeen")
            is_fresh = age_seconds(last_seen) is not None and age_seconds(last_seen) <= FRESH_RESPONDER_SECONDS
            if responder_profile.get("onDuty") and is_fresh and valid_location(responder_profile.get("location")):
                guard_location = responder_profile.get("location")
    return jsonify(
        {
            "incidentId": incident_id,
            "status": incident.get("status"),
            "userLocation": incident.get("userLocation") or incident.get("location"),
            "guardLocation": guard_location,
            "guardName": incident.get("assignedResponderName") or incident.get("assignedGuardName"),
            "responderLocation": guard_location,
            "responderName": incident.get("assignedResponderName") or incident.get("assignedGuardName"),
            "nearestLandmark": incident.get("nearestLandmark"),
            "landmarkDistanceM": incident.get("landmarkDistanceM"),
        }
    )


@app.post("/incidents/<incident_id>/notify-contacts")
@authenticated
def notify_contacts(incident_id):
    ref = get_incident_ref(incident_id)
    incident = require_incident(ref)
    profile = user_profile(g.identity["uid"])
    owner_id = incident_owner_id(g.db, incident_id, incident)
    if not is_operator_or_admin(profile) and owner_id != g.identity["uid"]:
        abort(403, "Only the incident owner or an admin can notify contacts.")
    if incident.get("contactSmsAt"):
        return jsonify({
            "mode": incident.get("contactSmsMode", "pending"),
            "sentCount": incident.get("contactSmsCount", 0),
            "alreadyProcessed": True,
        })

    contacts = list(g.db.collection("contacts").where("userId", "==", owner_id).stream())[:3]
    sid = os.environ.get("TWILIO_SID", "").strip()
    token = os.environ.get("TWILIO_TOKEN", "").strip()
    sender = os.environ.get("TWILIO_FROM", "").strip()
    tracking_base = os.environ.get("PUBLIC_TRACKING_BASE_URL", "").rstrip("/")
    mode = "none" if not contacts else "mock"
    sent_count = 0
    error_message = ""
    if sid and token and sender and tracking_base and contacts:
        try:
            import requests

            tracking_url = f"{tracking_base}/track/{incident_id}"
            message = (
                f"Emergency {incident_id}: {incident.get('category') or incident.get('type', 'Emergency')} reported "
                f"near {incident.get('address') or incident.get('generalArea') or 'the reported location'}. "
                f"Track: {tracking_url}"
            )[:1500]
            for contact_snapshot in contacts:
                contact = contact_snapshot.to_dict()
                phone = str(contact.get("phone", "")).strip()
                if not re.fullmatch(r"\+?[0-9()\s.-]{5,25}", phone):
                    raise ValueError("A saved contact has an invalid phone number.")
                response = requests.post(
                    f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
                    auth=(sid, token),
                    data={"From": sender, "To": phone, "Body": message},
                    timeout=10,
                )
                response.raise_for_status()
                sent_count += 1
            mode = "sent"
        except Exception as error:
            logger.warning("Contact SMS failed for incident %s: %s", incident_id, error)
            mode = "failed"
            error_message = "One or more contact messages could not be sent."

    ref.update({
        "contactSmsMode": mode,
        "contactSmsCount": sent_count,
        "contactSmsAt": now_utc(),
        "contactSmsError": error_message,
    })
    return jsonify({"mode": mode, "sentCount": sent_count, "contactCount": len(contacts), "error": error_message})


@app.get("/incidents/<incident_id>/medical-id")
@authenticated
def incident_medical_id(incident_id):
    incident = require_incident(get_incident_ref(incident_id))
    profile = user_profile(g.identity["uid"])
    assigned_id = incident.get("assignedResponderId") or incident.get("assignedGuardId")
    owner_id = incident_owner_id(g.db, incident_id, incident)
    allowed = is_operator_or_admin(profile) or assigned_id == g.identity["uid"] or owner_id == g.identity["uid"]
    if not allowed or incident.get("status") in {"RESOLVED", "CANCELLED"}:
        abort(403, "Medical ID is only available to the incident owner and active responders during an open incident.")
    if normalized_role(profile) == "responder" and assigned_id != g.identity["uid"]:
        abort(403, "Only the assigned responder can view this Medical ID.")
    snapshot = g.db.collection("medicalIds").document(owner_id).get() if owner_id else None
    return jsonify({"medicalId": snapshot.to_dict() if snapshot and snapshot.exists else None})


@app.post("/incidents/<incident_id>/accept")
@authenticated
def accept_incident(incident_id):
    responder = require_role("responder")
    if not responder.get("verified") and responder.get("role") != "guard":
        abort(403, "An administrator must verify your responder application first.")
    if not responder.get("onDuty"):
        abort(403, "Go on duty before accepting an incident.")
    if not valid_location(responder.get("location")) or age_seconds(responder.get("lastSeen")) is None or age_seconds(responder.get("lastSeen")) > FRESH_RESPONDER_SECONDS:
        abort(403, "A recent responder location is required before accepting an incident.")
    ref = get_incident_ref(incident_id)
    transaction = g.db.transaction()
    _, firestore, _ = firebase_services()
    now = now_utc()

    @firestore.transactional
    def accept_in_transaction(txn):
        snapshot = ref.get(transaction=txn)
        if not snapshot.exists:
            abort(404, "Incident not found.")
        incident = snapshot.to_dict()
        if not responder_matches(incident.get("category") or incident.get("type"), responder.get("responderType")):
            abort(403, "This incident does not match your verified responder specialty.")
        assigned_responder = incident.get("assignedResponderId") or incident.get("assignedGuardId")
        if assigned_responder and assigned_responder != g.identity["uid"]:
            abort(409, "This incident has already been assigned to another responder.")
        if incident.get("status") not in {"ACTIVE", "ASSIGNED", "ESCALATED"}:
            abort(409, "This incident is no longer available.")
        if incident.get("acceptedAt"):
            if assigned_responder == g.identity["uid"]:
                return incident
            abort(409, "This incident was already accepted.")
        updates = {
            "status": "ASSIGNED",
            "assignedResponderId": g.identity["uid"],
            "assignedResponderName": responder.get("name") or "Emergency responder",
            "assignedGuardId": g.identity["uid"],
            "assignedGuardName": responder.get("name") or "Emergency responder",
            "assignedAt": incident.get("assignedAt") or now,
            "acceptedAt": now,
            "timeline": append_timeline(incident, "ASSIGNED", g.identity["uid"], now),
        }
        txn.update(ref, updates)
        incident.update(updates)
        return incident

    incident = accept_in_transaction(transaction)
    incident = require_incident(ref)
    sync_public_tracking(g.db, incident_id, incident)
    notify_user(g.db, incident_owner_id(g.db, incident_id, incident), "Responder accepted", f"{incident.get('assignedResponderName') or incident.get('assignedGuardName')} accepted your request.", {"incidentId": incident_id}, silent=bool(incident.get("silent")))
    return jsonify({"incidentId": incident_id, "status": "ASSIGNED", "accepted": True})


@app.post("/incidents/<incident_id>/decline")
@authenticated
def decline_incident(incident_id):
    responder = require_role("responder")
    if not responder.get("verified") and responder.get("role") != "guard":
        abort(403, "An administrator must verify your responder application first.")
    if not responder.get("onDuty"):
        abort(403, "Go on duty before declining an incident.")
    ref = get_incident_ref(incident_id)
    _, firestore, _ = firebase_services()
    transaction = g.db.transaction()

    @firestore.transactional
    def decline_in_transaction(txn):
        snapshot = ref.get(transaction=txn)
        if not snapshot.exists:
            abort(404, "Incident not found.")
        incident = snapshot.to_dict()
        if (incident.get("assignedResponderId") or incident.get("assignedGuardId")) != g.identity["uid"] or incident.get("status") != "ASSIGNED":
            abort(403, "Only the assigned responder can decline this incident.")
        declined = list(incident.get("declinedGuardIds") or [])
        if g.identity["uid"] not in declined:
            declined.append(g.identity["uid"])
        now = now_utc()
        txn.update(
            ref,
            {
                "status": "ACTIVE",
                "assignedResponderId": None,
                "assignedResponderName": None,
                "assignedGuardId": None,
                "assignedGuardName": None,
                "assignedAt": None,
                "acceptedAt": None,
                "declinedGuardIds": declined,
                "escalationLevel": int(incident.get("escalationLevel") or 0) + 1,
                "timeline": append_timeline(incident, "ACTIVE", g.identity["uid"], now),
            },
        )
        return incident

    incident = decline_in_transaction(transaction)
    incident = require_incident(ref)
    sync_public_tracking(g.db, incident_id, incident)
    notify_user(g.db, incident_owner_id(g.db, incident_id, incident), "Finding another responder", "The assigned responder declined. Dispatch is contacting another responder.", {"incidentId": incident_id}, silent=bool(incident.get("silent")))
    with _dispatch_lock:
        assignment = dispatch_incident(g.db, ref)
    return jsonify({"incidentId": incident_id, "reassigned": bool(assignment)})


@app.post("/incidents/<incident_id>/status")
@authenticated
def update_incident_status(incident_id):
    body = request.get_json(silent=True)
    status = body.get("status") if isinstance(body, dict) else None
    if status not in INCIDENT_STATUSES:
        return jsonify({"error": "Choose a valid incident status."}), 400
    ref = get_incident_ref(incident_id)
    profile = user_profile(g.identity["uid"])
    role = normalized_role(profile)
    owner_id = incident_owner_id(g.db, incident_id, require_incident(ref))
    allowed = {
        "ACTIVE": {"ASSIGNED", "CANCELLED", "ESCALATED"},
        "ASSIGNED": {"EN_ROUTE", "CANCELLED", "ESCALATED"},
        "EN_ROUTE": {"ARRIVED", "CANCELLED", "ESCALATED"},
        "ARRIVED": {"RESOLVED"},
        "ESCALATED": {"ASSIGNED", "CANCELLED", "RESOLVED"},
        "RESOLVED": set(),
        "CANCELLED": set(),
    }
    _, firestore, _ = firebase_services()
    transaction = g.db.transaction()

    @firestore.transactional
    def update_in_transaction(txn):
        snapshot = ref.get(transaction=txn)
        if not snapshot.exists:
            abort(404, "Incident not found.")
        incident = snapshot.to_dict()
        owner = owner_id == g.identity["uid"]
        assigned_responder = (incident.get("assignedResponderId") or incident.get("assignedGuardId")) == g.identity["uid"]
        if status not in allowed.get(incident.get("status"), set()):
            abort(409, f"Cannot move an incident from {incident.get('status')} to {status}.")
        if role in {"admin", "operator"}:
            pass
        elif owner and status == "CANCELLED" and incident.get("status") not in {"RESOLVED", "CANCELLED"}:
            pass
        elif role == "responder" and assigned_responder and profile.get("verified", profile.get("role") == "guard") and status in {"EN_ROUTE", "ARRIVED", "RESOLVED"}:
            if status == "EN_ROUTE" and not incident.get("acceptedAt"):
                abort(409, "Accept the assignment before marking En route.")
        else:
            abort(403, "You cannot update this incident.")
        now = now_utc()
        actor = "user" if owner and incident.get("anonymous") else g.identity["uid"]
        update = {"status": status, "timeline": append_timeline(incident, status, actor, now)}
        if status == "ARRIVED":
            update["arrivedAt"] = now
        if status == "RESOLVED":
            update["resolvedAt"] = now
        if status == "CANCELLED":
            update["cancelledAt"] = now
        if status == "ESCALATED":
            update["escalationLevel"] = int(incident.get("escalationLevel") or 0) + 1
        txn.update(ref, update)
        incident.update(update)
        return incident

    incident = update_in_transaction(transaction)
    sync_public_tracking(g.db, incident_id, incident)
    assigned_responder = incident.get("assignedResponderId") or incident.get("assignedGuardId")
    if status != "CANCELLED" or assigned_responder:
        notify_user(g.db, incident_owner_id(g.db, incident_id, incident), f"Incident {status.lower().replace('_', ' ')}", f"Your incident is now {status.replace('_', ' ').lower()}.", {"incidentId": incident_id}, silent=bool(incident.get("silent")))
    if status == "CANCELLED":
        owner_id = incident_owner_id(g.db, incident_id, incident)
        notify_user(g.db, assigned_responder, "Incident cancelled", "The user cancelled this report as a false alarm.", {"incidentId": incident_id})
        try:
            if record_false_alarm(g.db, owner_id):
                notify_admins(g.db, incident_id)
                write_audit(g.db, "user.false_alarm_review_flagged", "user", owner_id, {"incidentId": incident_id})
        except Exception as error:
            logger.warning("Could not flag repeated false alarms for incident %s: %s", incident_id, error)
    if role in {"admin", "operator"}:
        write_audit(g.db, "incident.status_changed", "incident", incident_id, {"status": status})
    if status == "ESCALATED":
        notify_admins(g.db, incident_id)
    return jsonify({"incidentId": incident_id, "status": status})


@app.post("/admin/incidents/<incident_id>/assign")
@authenticated
def admin_assign_incident(incident_id):
    require_role("operator", "admin")
    body = request.get_json(silent=True)
    responder_id = (body.get("responderId") or body.get("guardId")) if isinstance(body, dict) else None
    if not isinstance(responder_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", responder_id):
        return jsonify({"error": "A valid responderId is required."}), 400
    ref = get_incident_ref(incident_id)
    incident = require_incident(ref)
    if incident.get("status") in {"RESOLVED", "CANCELLED"}:
        abort(409, "Closed incidents cannot be assigned.")
    responders = {item["id"]: item for item in available_responders(g.db, incident.get("category") or incident.get("type"))}
    responder = responders.get(responder_id)
    if not responder:
        abort(409, "Choose a verified, suitable responder on duty with a recent location.")
    previous_responder_id = incident.get("assignedResponderId") or incident.get("assignedGuardId")
    now = now_utc()
    responder_name = responder.get("name") or "Emergency responder"
    ref.update({
        "status": "ASSIGNED",
        "assignedResponderId": responder_id,
        "assignedResponderName": responder_name,
        "assignedGuardId": responder_id,
        "assignedGuardName": responder_name,
        "assignedAt": now,
        "acceptedAt": None,
        "timeline": append_timeline(incident, "ASSIGNED", g.identity["uid"], now),
    })
    updated = require_incident(ref)
    sync_public_tracking(g.db, incident_id, updated)
    write_audit(g.db, "incident.reassigned", "incident", incident_id, {"from": previous_responder_id, "to": responder_id})
    if previous_responder_id and previous_responder_id != responder_id:
        notify_user(g.db, previous_responder_id, "Assignment changed", f"Incident {incident_id} was reassigned by an operator.", {"incidentId": incident_id})
    notify_user(g.db, responder_id, "New emergency assignment", f"{updated.get('category') or updated.get('type', 'Emergency')} · {updated.get('priority', 'High')}", {"incidentId": incident_id})
    notify_user(g.db, incident_owner_id(g.db, incident_id, updated), "Responder assigned", f"{responder_name} is responding.", {"incidentId": incident_id}, silent=bool(updated.get("silent")))
    return jsonify({"incidentId": incident_id, "responderId": responder_id, "status": "ASSIGNED"})


@app.post("/admin/incidents/<incident_id>/identity")
@authenticated
def admin_incident_identity(incident_id):
    require_role("admin")
    get_incident_ref(incident_id)
    private_snapshot = g.db.collection("incidentsPrivate").document(incident_id).get()
    if not private_snapshot.exists:
        abort(404, "Private incident identity is not available.")
    private_data = private_snapshot.to_dict()
    return jsonify({key: private_data.get(key, "") for key in ("name", "email", "phone")})


@app.post("/admin/users")
@authenticated
def admin_manage_user():
    require_role("admin")
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "A JSON request is required."}), 400
    email = body.get("email")
    role = body.get("role")
    disabled = body.get("disabled")
    if not isinstance(email, str) or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email.strip()):
        return jsonify({"error": "Enter a valid account email."}), 400
    role = {"student": "user", "guard": "responder"}.get(role, role)
    if role not in {"user", "operator", "admin", "responder"} or not isinstance(disabled, bool):
        return jsonify({"error": "Choose a valid role and disabled value."}), 400
    admin_auth, _, _ = firebase_services()
    try:
        target = admin_auth.get_user_by_email(email.strip().lower())
    except Exception:
        abort(404, "No Firebase account uses that email.")
    if target.uid == g.identity["uid"] and (disabled or role != "admin"):
        abort(409, "You cannot deactivate or demote your own admin account.")
    try:
        profile_ref = g.db.collection("users").document(target.uid)
        profile_snapshot = profile_ref.get()
        existing_profile = profile_snapshot.to_dict() if profile_snapshot.exists else {}
        if role == "responder" and normalized_role(existing_profile) != "responder":
            abort(400, "Responders must be approved from a pending application.")
        admin_auth.update_user(target.uid, disabled=disabled)
        profile = {"role": role, "disabled": disabled, "email": target.email}
        if role != "responder":
            _, firestore, _ = firebase_services()
            profile.update({
                "verified": False,
                "onDuty": False,
                "location": firestore.DELETE_FIELD,
                "lastSeen": firestore.DELETE_FIELD,
            })
        elif disabled:
            _, firestore, _ = firebase_services()
            profile.update({"onDuty": False, "location": firestore.DELETE_FIELD, "lastSeen": firestore.DELETE_FIELD})
        if not profile_snapshot.exists:
            profile.update({"name": target.display_name or "", "phone": "", "createdAt": now_utc()})
        profile_ref.set(profile, merge=True)
        write_audit(g.db, "user.role_changed", "user", target.uid, {"role": role, "disabled": disabled})
    except Exception as error:
        logger.exception("Admin user update failed")
        abort(400, str(error))
    return jsonify({"uid": target.uid, "email": target.email, "role": role, "disabled": disabled})


@app.post("/admin/responders/<uid>/decision")
@authenticated
def admin_responder_decision(uid):
    require_role("admin")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", uid or ""):
        return jsonify({"error": "A valid user ID is required."}), 400
    body = request.get_json(silent=True)
    decision = body.get("decision") if isinstance(body, dict) else None
    if decision not in {"approve", "reject"}:
        return jsonify({"error": "Decision must be approve or reject."}), 400
    profile_ref = g.db.collection("users").document(uid)
    snapshot = profile_ref.get()
    if not snapshot.exists:
        abort(404, "User profile not found.")
    profile = snapshot.to_dict()
    application = profile.get("responderApplication") or {}
    if application.get("status") != "pending" or application.get("type") not in RESPONDER_TYPES:
        abort(409, "There is no pending responder application for this account.")
    if decision == "approve":
        updates = {
            "role": "responder",
            "responderType": application["type"],
            "verified": True,
            "responderApplication.status": "approved",
            "responderApplication.reviewedAt": now_utc(),
            "responderApplication.reviewedBy": g.identity["uid"],
        }
    else:
        updates = {
            "role": "user",
            "verified": False,
            "responderApplication.status": "rejected",
            "responderApplication.reviewedAt": now_utc(),
            "responderApplication.reviewedBy": g.identity["uid"],
        }
    profile_ref.update(updates)
    action = "responder.application_approved" if decision == "approve" else "responder.application_rejected"
    write_audit(g.db, action, "user", uid, {"responderType": application["type"]})
    return jsonify({"uid": uid, "decision": decision, "role": updates["role"], "verified": updates["verified"]})


@app.post("/admin/partners")
@authenticated
def admin_create_partner():
    require_role("admin")
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "A JSON request is required."}), 400
    name = str(body.get("name") or "").strip()
    partner_type = body.get("type")
    phone = str(body.get("phone") or "").strip()
    try:
        lat, lng = float(body.get("lat")), float(body.get("lng"))
    except (TypeError, ValueError):
        return jsonify({"error": "Enter valid latitude and longitude coordinates."}), 400
    if not name or len(name) > 120 or partner_type not in {"hospital", "ngo", "helpline", "police", "fire"}:
        return jsonify({"error": "Enter a name and supported partner type."}), 400
    if not (-90 <= lat <= 90 and -180 <= lng <= 180) or len(phone) > 40:
        return jsonify({"error": "Partner coordinates or phone are invalid."}), 400
    ref = g.db.collection("partners").document()
    ref.set({"name": name, "type": partner_type, "phone": phone, "lat": lat, "lng": lng, "createdAt": now_utc(), "createdBy": g.identity["uid"]})
    write_audit(g.db, "partner.created", "partner", ref.id, {"type": partner_type, "name": name})
    return jsonify({"id": ref.id}), 201


@app.post("/admin/partners/<partner_id>/delete")
@authenticated
def admin_delete_partner(partner_id):
    require_role("admin")
    ref = g.db.collection("partners").document(partner_id)
    if not ref.get().exists:
        abort(404, "Partner not found.")
    ref.delete()
    write_audit(g.db, "partner.deleted", "partner", partner_id)
    return jsonify({"deleted": True, "id": partner_id})


start_dispatch_worker()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), threaded=True)
