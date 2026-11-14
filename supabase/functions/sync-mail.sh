#!/bin/sh
# מעתיק את חישוב החובות מהאפליקציה לפונקציית המיילים, כדי ששניהם יחשבו אותו דבר. להריץ לפני כל פריסה
cd "$(dirname "$0")/.." && cp ../js/duties.js functions/safety-mail/duties.js
cp ../js/monthly.js functions/safety-mail/monthly.js
