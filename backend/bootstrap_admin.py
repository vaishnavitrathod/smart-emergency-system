import argparse
import json
import os
from datetime import datetime, timezone

from dotenv import load_dotenv


def main():
    load_dotenv()
    parser = argparse.ArgumentParser(description="Promote one existing Firebase account to the first Campus SOS admin.")
    parser.add_argument("email", help="Email address of the account to bootstrap as admin")
    args = parser.parse_args()

    import firebase_admin
    from firebase_admin import auth, credentials, firestore

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
        options = {"projectId": os.environ["FIREBASE_PROJECT_ID"]} if os.environ.get("FIREBASE_PROJECT_ID") else None
        firebase_admin.initialize_app(credential, options)

    account = auth.get_user_by_email(args.email.strip().lower())
    auth.update_user(account.uid, disabled=False)
    db = firestore.client()
    profile_ref = db.collection("users").document(account.uid)
    profile = profile_ref.get()
    data = {"role": "admin", "disabled": False, "email": account.email}
    if not profile.exists:
        data.update({"name": account.display_name or "Campus administrator", "phone": "", "createdAt": datetime.now(timezone.utc)})
    profile_ref.set(data, merge=True)
    print(f"Bootstrapped {account.email} ({account.uid}) as a Campus SOS admin.")


if __name__ == "__main__":
    main()
