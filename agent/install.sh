#!/bin/sh
# Installa o aggiorna l'agente MarX (eseguire con sudo dalla cartella agent/).
set -e
cd "$(dirname "$0")"
install -d -m 755 -o root -g root /opt/marx-agent
install -m 755 -o root -g root agent.py /opt/marx-agent/agent.py
rm -rf /opt/marx-agent/catalog
cp -r catalog /opt/marx-agent/catalog
chown -R root:root /opt/marx-agent/catalog
chmod -R go-w /opt/marx-agent
install -m 644 -o root -g root marx-agent.service /etc/systemd/system/marx-agent.service
systemctl daemon-reload
systemctl enable --now marx-agent
systemctl restart marx-agent
echo "Agente MarX attivo"
