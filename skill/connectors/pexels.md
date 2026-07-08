### Pexels (stock photos + video)

---
source: https://www.pexels.com/api/documentation/
fetched: 2026-07-07
auth: Authorization header (server-injected)
---

Search photos:
```tool
{"name":"connector","args":{"provider":"pexels","method":"GET","path":"/v1/search","params":{"query":"city timelapse","per_page":5}}}
```
Results: `photos[].src.large2x`, `.photographer`.

Search videos:
```tool
{"name":"connector","args":{"provider":"pexels","method":"GET","path":"/videos/search","params":{"query":"typing keyboard","per_page":3}}}
```
Results: `videos[].video_files[]` — pick `quality:"hd"`, then download its `link` with `save_to":"assets/<name>.mp4"`.
