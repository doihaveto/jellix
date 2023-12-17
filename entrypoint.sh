#!/bin/sh
echo "const API_URL = '${API_URL}';" > /app/params.js
# Start the Python HTTP server
python -m http.server 3000
