import os
import json
import urllib.request
import uuid

# Constants for API
NAMESPACE = uuid.NAMESPACE_DNS
API_URL = os.getenv("DITTOFEED_API", "http://localhost:3000")
ADMIN_KEY = os.getenv("DITTOFEED_ADMIN_KEY")
WORKSPACE_ID = os.getenv("WORKSPACE_ID")
RESEND_API_KEY = os.getenv("RESEND_API_KEY")

# Authorization header
headers = {
    "Authorization": f"Bearer {ADMIN_KEY}",
    "Content-Type": "application/json"
}

def put_request(endpoint, payload):
    # Send a PUT request to the API
    url = f"{API_URL}{endpoint}"
    req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers=headers, method='PUT')
    try:
        with urllib.request.urlopen(req) as response:
            print(f"{endpoint}: {response.getcode()}")
    except urllib.error.HTTPError as e:
        print(f"{endpoint}: {e.code}")
        # Continue execution even on non-2xx

def main():
    # User properties definition
    user_properties = [
        "email", "company", "region", "section", "last_category", "gen_subject", "gen_body_html"
    ]
    
    for name in user_properties:
        id = str(uuid.uuid5(NAMESPACE, name))
        payload = {
            "workspaceId": WORKSPACE_ID,
            "id": id,
            "name": name,
            "definition": {
                "type": "Trait",
                "path": name
            }
        }
        put_request("/api/admin/user-properties/", payload)

    # Email template
    email_template_id = str(uuid.uuid5(NAMESPACE, "zavod-welcome"))
    with open("services/dittofeed-assets/zavod-email.liquid.html", "r") as file:
        email_body = file.read()
    
    email_payload = {
        "workspaceId": WORKSPACE_ID,
        "id": email_template_id,
        "name": "zavod-welcome",
        "definition": {
            "type": "Email",
            "from": "Zavod <onboarding@resend.dev>",
            "subject": "{{ user.gen_subject | default: \"Обновление каталога\" }}",
            "body": email_body,
            "emailContentsType": "Code"
        }
    }
    put_request("/api/admin/content/templates", email_payload)

    # Segments definition
    segments = [
        {
            "name": "all-storefront",
            "path": "audience",
            "operator": {"type": "Equals", "value": "storefront"}
        },
        {
            "name": "viewed-category",
            "path": "last_category",
            "operator": {"type": "Exists"}
        }
    ]
    
    for segment in segments:
        segment_id = str(uuid.uuid5(NAMESPACE, segment["name"]))
        segment_payload = {
            "workspaceId": WORKSPACE_ID,
            "id": segment_id,
            "name": segment["name"],
            "definition": {
                "entryNode": {
                    "type": "Trait",
                    "id": segment_id,
                    "path": segment["path"],
                    "operator": segment["operator"]
                },
                "nodes": []
            }
        }
        put_request("/api/admin/segments/", segment_payload)

    # Email provider configuration
    email_provider_payload = {
        "workspaceId": WORKSPACE_ID,
        "setDefault": True,
        "config": {
            "type": "Resend",
            "apiKey": RESEND_API_KEY
        }
    }
    put_request("/api/admin/settings/email-providers", email_provider_payload)

if __name__ == "__main__":
    main()