### FAL (generative media)

---
source: https://docs.fal.ai/model-apis
fetched: 2026-07-07
auth: Key (server-injected)
---

Generate an image (FLUX, sync endpoint — body JSON carries image URLs):
```tool
{"name":"connector","args":{"provider":"fal","method":"POST","path":"/fal-ai/flux/schnell","params":{"prompt":"isometric illustration of a recording studio, clean vector style","image_size":"landscape_16_9"}}}
```
Response: `images[].url` — download it with a second call using `save_to":"assets/<name>.png"`.

Other models swap the path: `/fal-ai/flux/dev` (quality), `/fal-ai/recraft/v3/text-to-image` (vector/brand).
