---
name: music-streaming-licensing-architecture
description: Design social music products around lawful playback sources and synchronization constraints.
---

# Music Streaming Licensing Architecture

Use this skill for music catalogs, synchronized listening, playback integrations, or social music applications.
1. Separate metadata/catalog search from actual playback rights and provider playback.
2. Use official APIs/SDKs and verify current terms, quotas, and supported playback contexts.
3. Do not scrape protected content or bypass DRM, paywalls, or access controls.
4. Model playback state, timestamps, drift correction, host authority, reconnects, and provider limitations.
5. Respect user authentication, regional availability, and licensing constraints.
6. Test multi-client synchronization and provider failure behavior.
7. Do not imply that metadata access grants rights to stream audio.
