import os
import httpx
import time
from uuid import uuid4

# Constants
ADMIN_USERS_PATH = '/api/admin/users'
DITTOFEED_API = os.getenv('DITTOFEED_API')
DITTOFEED_ADMIN_KEY = os.getenv('DITTOFEED_ADMIN_KEY')
WRITE_KEY = os.getenv('WRITE_KEY')

class DittofeedClient:
    def __init__(self):
        self.base_url = DITTOFEED_API
        self.admin_key = DITTOFEED_ADMIN_KEY
        self.write_key = WRITE_KEY
        self.workspace_id = os.getenv('DITTOFEED_WORKSPACE_ID')
        self.email_group = os.getenv('EMAIL_SUBSCRIPTION_GROUP')

    def get_audience(self, segment_id=None) -> list:
        url = f"{self.base_url}{ADMIN_USERS_PATH}"
        headers = {
            "Authorization": f"Bearer {self.admin_key}",
            "Content-Type": "application/json"
        }
        data = {"segmentId": segment_id} if segment_id else {}
        
        users = []
        cursor = None
        
        while True:
            if cursor:
                data['cursor'] = cursor
            
            response = httpx.post(url, headers=headers, json=data)
            response.raise_for_status()
            page_data = response.json()
            users.extend(page_data.get('users', []))
            cursor = page_data.get('nextCursor')
            
            if not cursor:
                break
            
            time.sleep(1)  # Simple rate limiting for pagination

        return users

    def write_traits(self, user_id, traits):
        url = f"{self.base_url}/api/public/apps/identify"
        headers = {
            # WRITE_KEY is already the base64(secretId:value) token from Dittofeed — send verbatim
            "Authorization": f"Basic {self.write_key}",
            "Content-Type": "application/json"
        }
        body = {
            "userId": user_id,
            "messageId": str(uuid4()),
            "traits": traits
        }

        while True:
            response = httpx.post(url, headers=headers, json=body)
            if response.status_code == 429:
                time.sleep(2)  # Exponential backoff could be more advanced
                continue
            response.raise_for_status()
            break

    # --- deliverability: per-user email subscription (VERIFIED live 2026-06-19) ---
    # Dittofeed has no bulk "list unsubscribed" endpoint; suppression is a per-user subscription
    # to an Email subscription group (OptOut type). Broadcasts honor it natively.
    def __init_email_group(self):
        return self.email_group or os.getenv("EMAIL_SUBSCRIPTION_GROUP")

    def is_subscribed(self, user_id, group_id=None) -> bool:
        """GET /api/admin/users/subscriptions -> isSubscribed for the Email group (default True)."""
        group_id = group_id or self.__init_email_group()
        url = f"{self.base_url}/api/admin/users/subscriptions"
        headers = {"Authorization": f"Bearer {self.admin_key}"}
        params = {"workspaceId": self.workspace_id, "userId": user_id}
        resp = httpx.get(url, headers=headers, params=params, timeout=20)
        resp.raise_for_status()
        for g in resp.json().get("subscriptionGroups", []):
            if g.get("channel") == "Email" and (group_id is None or g.get("id") == group_id):
                return bool(g.get("isSubscribed"))
        return True

    def unsubscribe(self, user_id, group_id=None):
        """PUT /api/admin/subscription-groups/assignments -> opt the user out of the Email group."""
        group_id = group_id or self.__init_email_group()
        if not group_id:
            return False
        url = f"{self.base_url}/api/admin/subscription-groups/assignments"
        headers = {"Authorization": f"Bearer {self.admin_key}", "Content-Type": "application/json"}
        body = {"workspaceId": self.workspace_id, "userUpdates": [{"userId": user_id, "changes": {group_id: False}}]}
        resp = httpx.put(url, headers=headers, json=body, timeout=20)
        resp.raise_for_status()
        return True