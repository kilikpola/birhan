#!/bin/bash
set -e
npm run build
rm -f dist/assets/*.map
ssh -t birhan@191.215.40.44 'sudo chown -R birhan:birhan /var/www/admin.birhan.online'
rsync -avz --delete ./dist/ birhan@191.215.40.44:/var/www/admin.birhan.online/
ssh -t birhan@191.215.40.44 'sudo chown -R www-data:www-data /var/www/admin.birhan.online'
