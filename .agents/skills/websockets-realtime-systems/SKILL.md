---
name: websockets-realtime-systems
description: Build resilient WebSocket and real-time synchronization behavior.
---

# Websockets Realtime Systems

Use this skill for live chat, presence, collaborative features, or synchronized playback.
1. Define message schemas, ordering expectations, authorization, and ownership.
2. Handle reconnects, heartbeats, duplicate messages, timeouts, and stale clients.
3. Make state reconciliation deterministic after reconnect.
4. Validate messages and enforce room/resource permissions server-side.
5. Avoid unbounded queues and uncontrolled fan-out.
6. Test network loss, reconnect, multiple clients, and race conditions.
7. Do not assume delivery guarantees not provided by the transport.
