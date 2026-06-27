#!/usr/bin/env python3
"""Native Dittofeed orchestration: segment (audience=industrial) -> recompute -> broadcast -> send."""
import json, urllib.request, urllib.error, uuid, time

DF="http://localhost:3000"; WS="adfb18b4-9d92-4610-ada3-ab1fa9b158b7"
KEY=open("/tmp/cdp_admin_key").read().strip()
TEMPLATE="e64f38d2-e655-4c46-af99-9b0da429ac6c"
H={"Authorization":f"Bearer {KEY}","Content-Type":"application/json"}

def call(m,p,b=None):
    data=json.dumps(b).encode() if b is not None else None
    r=urllib.request.Request(DF+p,data=data,headers=H,method=m)
    try:
        with urllib.request.urlopen(r,timeout=30) as x: return x.status,x.read().decode()
    except urllib.error.HTTPError as e: return e.code,e.read().decode()

SEG_ID=str(uuid.uuid4()); NODE_ID=str(uuid.uuid4())
print("=== 1. create segment audience=industrial ===")
c,resp=call("PUT","/api/admin/segments/",{
  "workspaceId":WS,"id":SEG_ID,"name":"cdp-industrial-leads",
  "definition":{"entryNode":{"type":"Trait","id":NODE_ID,"path":"audience",
                             "operator":{"type":"Equals","value":"industrial"}},"nodes":[]},
})
print("  ->",c,resp[:160]);
if c>=400: raise SystemExit("segment create failed")

print("=== 2. trigger computed-properties recompute ===")
c,resp=call("POST","/api/admin/computed-properties/trigger-recompute",{"workspaceId":WS})
print("  ->",c,resp[:120])

print("=== 3. poll segment membership ===")
members=0
for i in range(20):
    c,resp=call("POST","/api/admin/users",{"workspaceId":WS,"segmentFilter":[SEG_ID]})
    try:
        d=json.loads(resp); users=d.get("users") or d.get("value",{}).get("users") or []
        members=len(users)
    except Exception: members=-1
    print(f"  poll {i}: members={members}")
    if members>=3: break
    time.sleep(6)

print("SEGMENT_ID",SEG_ID,"members",members)
