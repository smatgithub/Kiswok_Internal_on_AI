#!/bin/bash
# Run on KIPL-AZ-WEB-PROD as kiswok: sudo bash deploy/kiswok-prod/enable-apache.sh
# Requires DNS: internalv3.kiswok.com A -> 10.1.1.36
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)/internalv3.kiswok.com.conf"
install -m 644 "$SRC" /etc/apache2/sites-available/internalv3.kiswok.com.conf
a2enmod proxy proxy_http ssl rewrite headers >/dev/null
a2ensite internalv3.kiswok.com.conf
apache2ctl configtest
systemctl reload apache2
echo "Apache site enabled for internalv3.kiswok.com"
echo "If DNS is not live yet, add an A record to 10.1.1.36, then:"
echo "  sudo certbot --apache -d internalv3.kiswok.com"
