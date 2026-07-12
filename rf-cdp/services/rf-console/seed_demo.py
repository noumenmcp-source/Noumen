#!/usr/bin/env python3
# Генератор демо-датасета для тенанта demo (rf-console / Аксиома).
# Цель: каждый раздел консоли показывает реалистичные данные.
# Вывод: NDJSON для ES _bulk (events + consent), в stdout.
import json, random, hashlib, sys
from datetime import datetime, timedelta, timezone

random.seed(42)
# анкер чуть в прошлом относительно реального времени сервера (~07:06Z),
# чтобы "свежие" события попадали в окно триггеров now-3h..now-24h
NOW = datetime(2026, 7, 2, 5, 30, 0, tzinfo=timezone.utc)

def iso(days_ago=0, hours_ago=0, mins=0):
    return (NOW - timedelta(days=days_ago, hours=hours_ago, minutes=mins)).strftime('%Y-%m-%dT%H:%M:%S.000Z')

events = []   # docs for cdp_events_demo
consents = [] # docs for cdp_consent_demo

FIRST = ["Анна","Дмитрий","Елена","Сергей","Ольга","Иван","Мария","Алексей","Наталья","Павел",
         "Екатерина","Андрей","Татьяна","Михаил","Юлия","Роман","Ирина","Виктор","Светлана","Денис",
         "Оксана","Артём","Галина","Никита","Вера","Кирилл","Полина","Максим","Людмила","Егор",
         "Дарья","Владимир","Алина","Григорий","Марина","Тимур","Валентина","Степан","Ксения","Борис",
         "Жанна","Фёдор","Лариса","Антон","Нина","Глеб","Софья","Руслан","Зоя","Матвей"]
CITY = ["Москва","Санкт-Петербург","Новосибирск","Екатеринбург","Казань","Нижний Новгород","Челябинск","Самара","Ростов-на-Дону","Уфа"]
OWN = ["ecoma.ru","(direct)","vk.com","t.me/ecoma","market.yandex.ru"]
PRODUCTS = ["Многоразовые бахилы","Эко-набор для кухни","Бамбуковые щётки","Средство без хлора",
            "Стеклянные контейнеры","Хлопковые мешочки","Твёрдый шампунь","Салфетки из целлюлозы"]

def uid(n): return "u_demo_%03d" % n
def aid(n): return "a_demo_%03d" % n
def email(name, n): return "demo%d@example.com" % n

def profile(n):
    name = FIRST[(n-1) % len(FIRST)]
    return {"n": n, "uid": uid(n), "aid": aid(n), "name": name, "email": email(name, n),
            "city": random.choice(CITY)}

def ev(p, event, days_ago, hours_ago=0, origin=None, props=None):
    d = {"event": event, "ts": iso(days_ago, hours_ago),
         "anonymous_id": p["aid"], "user_id": p["uid"],
         "origin": origin or "ecoma.ru", "properties": props or {}}
    events.append(d)

def order(p, days_ago, revenue, origin=None):
    ev(p, "order_completed", days_ago, origin=origin,
       props={"order_id": "ord_%s" % hashlib.md5((p["uid"]+str(days_ago)).encode()).hexdigest()[:8],
              "revenue": revenue, "items": random.randint(1,4),
              "product": random.choice(PRODUCTS)})

def give_consent(p, marketing=True):
    st = {"personal_data": True}
    purposes = ["personal_data"]
    if marketing:
        st["marketing_email"] = True
        purposes.append("marketing_email")
    consents.append({"ts": iso(random.randint(30,120)),
                     "consent": {"email": p["email"], "subject": p["uid"],
                                 "purposes": purposes, "state": st, "source": "form:popup"}})

def signup(p, days_ago, hours_ago=0):
    ev(p, "signup", days_ago, hours_ago, origin="form:popup",
       props={"formType": "popup", "formId": "demo-popup", "email": p["email"], "source": "embedded_form"})

def views(p, days_ago_list):
    for d in days_ago_list:
        ev(p, "product_viewed", d if d>=1 else 0, hours_ago=(0 if d>=1 else random.randint(4,20)),
           props={"product": random.choice(PRODUCTS)})

n = 0
def nxt():
    global n; n += 1; return profile(n)

# ── 1. VIP: 5-8 заказов, высокий чек, активны, согласие ──
for _ in range(5):
    p = nxt(); give_consent(p)
    signup(p, random.randint(150,220))
    k = random.randint(5,8)
    span = random.randint(160,210)
    for i in range(k):
        d = int(span - i*(span/k)) + random.randint(-3,3)
        d = max(2, d)
        order(p, d, random.choice([1890,2450,3200,4100,5300,6200]))
    views(p, [1,3,8])

# ── 2. Повторные покупатели: 2-4 заказа, активны ──
for _ in range(8):
    p = nxt(); give_consent(p)
    signup(p, random.randint(80,140))
    k = random.randint(2,4)
    last = random.randint(4,25)
    for i in range(k):
        order(p, last + i*random.randint(25,45), random.choice([990,1490,1850,2300,2800]))
    views(p, [2,10])

# ── 3. "Пора докупить" (repeat_purchase): ровно 2 заказа, последний ~40д назад ──
for _ in range(3):
    p = nxt(); give_consent(p)
    signup(p, 120)
    interval = random.randint(28,34)
    last = interval + random.randint(6,16)   # в окне [interval, 2*interval]
    order(p, last + interval, 1650)
    order(p, last, 1720)

# ── 4. Разовые покупатели ──
for _ in range(10):
    p = nxt(); give_consent(p, marketing=(random.random()>0.15))
    signup(p, random.randint(40,110))
    order(p, random.randint(8,95), random.choice([790,1190,1590,2100]))

# ── 5. Возврат с маркетплейсов: заказ на WB/Ozon за 180д, нет прямого за 30д ──
for _ in range(5):
    p = nxt(); give_consent(p)
    mp = random.choice(["ozon.ru","wildberries.ru","wb.ru"])
    signup(p, random.randint(60,120))
    order(p, random.randint(35,150), random.choice([1290,1900,2600]), origin=mp)
    views(p, [3,12])

# ── 6. Брошенные корзины: add_to_cart в 6-20ч (окно триггера), без заказа ──
for i in range(6):
    p = nxt(); give_consent(p)
    signup(p, random.randint(10,40))
    views(p, [2,1])
    if i < 3:
        ev(p, "add_to_cart", 0, hours_ago=random.randint(6,20), props={"product": random.choice(PRODUCTS)})
    else:
        ev(p, "add_to_cart", random.randint(1,3), props={"product": random.choice(PRODUCTS)})
    if i < 2:
        ev(p, "checkout_started", 0, hours_ago=random.randint(6,18), props={})

# ── 7. Интересовавшиеся (browse без корзины и заказа) ──
for i in range(6):
    p = nxt(); give_consent(p)
    signup(p, random.randint(12,45))
    if i < 3:
        ev(p, "product_viewed", 0, hours_ago=random.randint(6,20), props={"product": random.choice(PRODUCTS)})
    views(p, [random.randint(2,20), random.randint(2,25)])

# ── 8. Свежие сигнапы 6-20ч (welcome-триггер) ──
for _ in range(4):
    p = nxt(); give_consent(p)
    signup(p, 0, hours_ago=random.randint(6,20))

# ── 8b. После покупки (post_purchase): заказ 8-20ч назад ──
for _ in range(3):
    p = nxt(); give_consent(p)
    signup(p, random.randint(20,60))
    order(p, 0, random.choice([1290,1790,2400]))
    events[-1]["ts"] = iso(0, hours_ago=random.randint(8,20))

# ── 9. Подписаны, но не открывают (noopen + re_permission): 5-6 отправок, 0 открытий ──
noopen_users = []
for _ in range(5):
    p = nxt(); give_consent(p); noopen_users.append(p)
    signup(p, random.randint(50,90))

# ── 10. Пара без marketing-согласия (показать работу гейта) ──
for _ in range(3):
    p = nxt(); give_consent(p, marketing=False)
    signup(p, random.randint(20,60))
    views(p, [5])

# ── 11. Спящие/потерянные (визит 7-30д и >30д, был 1 заказ давно) ──
for _ in range(6):
    p = nxt(); give_consent(p)
    signup(p, random.randint(90,160))
    order(p, random.randint(70,150), random.choice([990,1490]))
    views(p, [random.randint(9,28)])   # last_seen 9-28д → спящий
for _ in range(4):
    p = nxt(); give_consent(p)
    signup(p, random.randint(120,200))
    views(p, [random.randint(35,80)])  # >30д → потерянный

# ── EMAIL: рассылки, A/B, триггерные письма ──
# emailable — только "активные" группы (1-13, 17-50); спящие/потерянные/repeat_due/noopen/
# без-согласия НЕ получают массовых писем, чтобы их last_seen оставался старым.
emailable = [profile(i) for i in range(1, n+1) if (1 <= i <= 13) or (17 <= i <= 50)]

def send_email(p, subject, days_ago, msgid, opened, clicked, campaign_id=None, variant=None, automated=False, trigger=None):
    props = {"subject": subject, "messageId": msgid, "to": p["email"]}
    if campaign_id: props["campaignId"] = campaign_id
    if variant: props["variant"] = variant
    if automated: props["automated"] = True
    if trigger: props["trigger"] = trigger
    ev(p, "email_sent", days_ago, origin="email", props=dict(props))
    # открытия/клики несут те же messageId/campaignId/variant — иначе A/B-агрегация их не свяжет
    oc = {"messageId": msgid}
    if campaign_id: oc["campaignId"] = campaign_id
    if variant: oc["variant"] = variant
    if opened:
        ev(p, "email_opened", days_ago, hours_ago=-1, props=dict(oc))
    if clicked:
        ev(p, "email_clicked", days_ago, hours_ago=-2, props=dict(oc))

mid = 0
def newmid():
    global mid; mid += 1; return "m_demo_%04d" % mid

# Рассылка 1: "Летняя подборка эко-товаров" — 40 отправок, 18 откр, 6 клик
pool = emailable[:40]
for i, p in enumerate(pool):
    send_email(p, "Летняя подборка эко-товаров", 11, newmid(), opened=(i<18), clicked=(i<6))
# Рассылка 2: "Новинки июля" — 35 отправок, 15 откр, 4 клик
pool2 = emailable[:35]
for i, p in enumerate(pool2):
    send_email(p, "Новинки июля уже в наличии", 4, newmid(), opened=(i<15), clicked=(i<4))

# A/B: campaignId cAB — A "Почему мы ушли с маркетплейсов" 50/20, B "На сайте дешевле на 15%" 50/30
abpool = [emailable[i % len(emailable)] for i in range(100)]
for i in range(50):
    send_email(abpool[i], "Почему мы ушли с маркетплейсов", 6, newmid(), opened=(i<20), clicked=(i<7),
               campaign_id="cAB", variant="A")
for i in range(50):
    send_email(abpool[50+i], "На сайте дешевле на 15%", 6, newmid(), opened=(i<30), clicked=(i<12),
               campaign_id="cAB", variant="B")

# Триггерное письмо: брошенная корзина (automated)
for i in range(12):
    p = emailable[i % len(emailable)]
    send_email(p, "Вы забыли товары в корзине", random.randint(1,5), newmid(),
               opened=(i<7), clicked=(i<3), automated=True, trigger="abandoned_cart")
# Триггерное письмо: welcome (automated)
for i in range(8):
    p = emailable[(i+12) % len(emailable)]
    send_email(p, "Добро пожаловать — дарим −15%", random.randint(1,6), newmid(),
               opened=(i<5), clicked=(i<2), automated=True, trigger="welcome")

# noopen (+ re_permission): ≥5 отправок, 0 открытий. Каждое письмо — уникальный anonymous_id
# "email:<messageId>" + properties.to (как реальный трекинг), иначе join по anonymous_id даёт size=1.
for p in noopen_users:
    for _ in range(6):
        m = newmid()
        events.append({"event": "email_sent", "ts": iso(random.randint(2,25)),
                       "anonymous_id": "email:" + m, "origin": "email",
                       "properties": {"subject": "Дайджест недели", "messageId": m, "to": p["email"]}})

# ── automation_fired: история срабатываний автопилота (для вкладки «Сценарии» — inflow/конверсия) ──
TRIGGER_FIRES = {
    "abandoned_cart": 34, "welcome": 41, "reactivation": 22, "post_purchase": 28,
    "abandoned_browse": 19, "checkout_abandoned": 15, "win_back_marketplace": 12,
    "repeat_purchase": 9, "re_permission": 17,
}
for trig, cnt in TRIGGER_FIRES.items():
    for i in range(cnt):
        p = profile((i % 50) + 1)  # опознанные пользователи 1..50
        d = random.randint(1, 29)
        events.append({"event": "automation_fired", "ts": iso(d),
                       "anonymous_id": p["aid"], "user_id": p["uid"],
                       "origin": "automation", "properties": {"trigger": trig}})
        # ~35% конверсия — заказ через 1-5 дней после срабатывания
        if random.random() < 0.35 and d > 5:
            order(p, d - random.randint(1,5), random.choice([990,1490,1990,2600]))

# ── ВЫВОД bulk NDJSON ──
out = sys.stdout
for d in events:
    out.write(json.dumps({"index": {"_index": "cdp_events_demo"}}) + "\n")
    out.write(json.dumps(d, ensure_ascii=False) + "\n")
for d in consents:
    out.write(json.dumps({"index": {"_index": "cdp_consent_demo"}}) + "\n")
    out.write(json.dumps(d, ensure_ascii=False) + "\n")

sys.stderr.write("profiles=%d events=%d consents=%d\n" % (n, len(events), len(consents)))
