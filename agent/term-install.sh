#!/bin/sh
# Installa o aggiorna il servizio del Terminale di MarX (eseguire con sudo).
set -e
cd "$(dirname "$0")"
install -d -m 755 -o root -g root /opt/marx-agent
install -m 755 -o root -g root term.py /opt/marx-agent/term.py
# Segreto condiviso fra il sito (www-data) e il servizio (marco) per firmare i gettoni d'accesso
install -d -m 755 -o root -g root /etc/marx-term
if [ ! -s /etc/marx-term/secret ]; then
    head -c 48 /dev/urandom | base64 -w0 > /etc/marx-term/secret
fi
chown marco:www-data /etc/marx-term/secret
chmod 440 /etc/marx-term/secret
install -m 644 -o root -g root marx-term.service /etc/systemd/system/marx-term.service
systemctl daemon-reload
systemctl enable marx-term
systemctl restart marx-term
# Apache: inoltra /term/ws al servizio nel sito di MarX (una volta sola; se la configurazione non è valida torna indietro)
VHOST=/etc/apache2/sites-available/marx-le-ssl.conf
if [ -f "$VHOST" ] && ! grep -q marx-term "$VHOST"; then
    cp "$VHOST" "$VHOST.before-terminal"
    sed -i 's#^\(    ErrorLog .*marx-error.log\)#    \# Terminale di MarX: WebSocket inoltrato al servizio marx-term\n    ProxyPass /term/ws unix:/run/marx-term/term.sock|ws://localhost/term/ws\n\1#' "$VHOST"
    if apache2ctl configtest >/dev/null 2>&1; then
        systemctl reload apache2
    else
        cp "$VHOST.before-terminal" "$VHOST"
        echo "Configurazione Apache non valida: ripristinata" >&2
    fi
fi
echo "Terminale MarX attivo"
