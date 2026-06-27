#!/usr/bin/env bash
# ТОТАЛЬНЫЙ default-deny firewall. Инцидент 2026-06-24 (ES ransomware через открытый 0.0.0.0:9200).
# Принцип: с интернета (eth0) к контейнерам ЗАПРЕЩЕНО ВСЁ, кроме явно разрешённого.
PUB=$(ip route get 8.8.8.8 2>/dev/null | grep -oP 'dev \K\S+'); PUB=${PUB:-eth0}
# --- DOCKER-USER: default-deny входящих из интернета ко ВСЕМ контейнерам ---
iptables -F DOCKER-USER
iptables -A DOCKER-USER -i "$PUB" -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
# разрешённые ПУБЛИЧНЫЕ контейнер-сервисы (Telegram MTProto-прокси):
iptables -A DOCKER-USER -i "$PUB" -p tcp -m multiport --dports 443,2053,9443 -j RETURN
# всё прочее с интернета к любому контейнеру = DROP (БД, gateway 8110, temporal 7233, будущие порты):
iptables -A DOCKER-USER -i "$PUB" -j DROP
iptables -A DOCKER-USER -j RETURN
# --- INPUT (host-сервисы): закрыть syslog-ng:1000 с интернета ---
for proto in tcp udp; do
  iptables -C INPUT -i "$PUB" -p $proto --dport 1000 -j DROP 2>/dev/null \
    || iptables -I INPUT -i "$PUB" -p $proto --dport 1000 -j DROP
done
