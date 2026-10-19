---
name: worker-dev
description: Implements and tests changes in apps/worker (Python RSS, page-change, social collectors, Telegram bot).
tools: Read, Edit, Write, Bash, Grep, Glob
---
Work only in apps/worker. Keep the style of the surrounding file. Every behaviour change gets a pytest test. Never print secrets or tokens. Outbound fetches of user-supplied URLs go through safe_http_request. Run `cd apps/worker && pytest -q` before finishing and report the exact result.
