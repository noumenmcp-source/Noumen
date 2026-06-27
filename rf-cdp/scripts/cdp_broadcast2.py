#!/usr/bin/env python3
"""Phase 2: create + start a broadcast over the industrial segment, verify sends in mailpit."""
import json, urllib.request, urllib.error, uuid, time

DF="http://localhost:3000"; WS="adfb18b4-9d92-4610-ada3-ab1fa9b158b7"
KEY=open("/tmp/cdp_admin_key").read().strip()
TEMPLATE="e64f38d2-e655-4c46-af99-9b0da429ac6c"
SEGMENT="09e9bc86-598e-4420-9d0a-84fdb9185163"
H={"Authorization":f"Bearer {KEY}","Content-Type":"application/json"}

def call(m,p,b=None,base=DF):
    data=json.dumps(b).encode() if b is not None else None
    r=urllib.request.Request(base+p,data=data,headers=H if base==DF else {},method=m)
    try:
        with urllib.request.urlopen(r,timeout=30) as x: return x.status,x.read().decode()
    except urllib.error.HTTPError as e: return e.code,e.read().decode()

def mailpit_count():
    try:
        d=json.loads(urllib.request.urlopen("http://localhost:8025/api/v1/messages",timeout=8).read())
        return d.get("total"), d.get("messages",[])
    except Exception as e: return -1,[]

before,_=mailpit_count(); print("mailpit before:",before)

BID=str(uuid.uuid4())
print("=== create broadcast v2 ===")
c,resp=call("PUT","/api/admin/broadcasts/v2",{
  "workspaceId":WS,"id":BID,"name":"cdp-industrial-blast",
  "segmentId":SEGMENT,"messageTemplateId":TEMPLATE,
  "config":{"type":"V2","message":{"type":"Email","providerOverride":"Smtp"},
            "errorHandling":"SkipOnError","batchSize":10,"rateLimit":100},
})
print("  ->",c,resp[:200])

print("=== start broadcast ===")
for path,body in [("/api/admin/broadcasts/start",{"workspaceId":WS,"broadcastId":BID}),
                  ("/api/admin/broadcasts/start",{"workspaceId":WS,"id":BID})]:
    c,resp=call("POST",path,body)
    print(f"  start {body} -> {c} {resp[:160]}")
    if c<400: break

print("=== poll mailpit for new sends ===")
for i in range(20):
    total,msgs=mailpit_count()
    new=[m for m in msgs if any(a.get('Address','').endswith(('metallprom.ru','agrotech.ru','stroymonolit.ru')) for a in m.get('To',[]))]
    print(f"  poll {i}: mailpit total={total}")
    if total>before:
        print("  NEW MESSAGES detected")
        break
    time.sleep(6)
print("\nBROADCAST_ID",BID)
total,msgs=mailpit_count()
print("final mailpit total:",total)
for m in msgs[:8]:
    print("  to:",[a.get('Address') for a in m.get('To',[])],"| subj:",m.get('Subject'))
