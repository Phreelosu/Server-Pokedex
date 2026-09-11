@echo off
REM Serves the wiki on http://localhost:8080 and opens it.
REM Opening index.html directly will not work - browsers block fetch() on file:// URLs.
start "" http://localhost:8080
python -m http.server 8080
