#!/bin/sh

echo "const API_URL = '${API_URL}';" > /app/params.js
echo "const TRANSLATIONS = '${TRANSLATIONS}';" >> /app/params.js

nginx -g 'daemon off;'
