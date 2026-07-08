### Google Drive (Pro — via your Reactable account)

---
source: https://developers.google.com/drive/api/reference/rest/v3
fetched: 2026-07-07
auth: Reactable session (server-side, Pro plan)
---

List files the app can see (search by name):
```tool
{"name":"connector","args":{"provider":"drive","path":"/api/drive/files","params":{"q":"demo footage"}}}
```

Import a file into the project (id from the list):
```tool
{"name":"connector","args":{"provider":"drive","path":"/api/drive/file","params":{"id":"<fileId>"},"save_to":"assets/<name>.<ext>"}}
```

If it returns "Drive is part of Pro" or "not connected", the user connects in
Settings (Pro) — don't retry until they do.
