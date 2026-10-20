---
name: codebase-reconnaissance
description: Understand a repository efficiently before making changes.
---

# Codebase Reconnaissance

Use this skill when entering a repository, touching an unfamiliar subsystem, or debugging a poorly understood issue.
1. Inspect Git status, top-level structure, package/build manifests, and relevant AGENTS.md files.
2. Identify the entry points and trace only the code path relevant to the request.
3. Search for existing implementations, tests, conventions, and dependency versions.
4. Check whether generated files or migrations are involved before editing.
5. Summarize the smallest useful architecture map with exact paths.
6. Do not read every file by default or infer a framework from folder names alone.
7. Preserve uncommitted user changes.
