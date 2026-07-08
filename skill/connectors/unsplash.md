### Unsplash (stock photos)

---
source: https://unsplash.com/documentation
fetched: 2026-07-07
auth: Client-ID (server-injected)
---

Search photos:
```tool
{"name":"connector","args":{"provider":"unsplash","method":"GET","path":"/search/photos","params":{"query":"mountain sunset","per_page":5,"orientation":"landscape"}}}
```
Results: `results[].urls.regular` (display) / `.full` (hi-res), `.alt_description`, `.user.name` (credit).

Download a hit into the project:
```tool
{"name":"connector","args":{"provider":"unsplash","method":"GET","path":"/photos/<id>/download","params":{},"save_to":"assets/<name>.jpg"}}
```
(If that returns JSON with a `url` field instead of bytes, fetch that url via `save_to` again.)
