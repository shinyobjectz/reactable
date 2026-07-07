# Post — ffmpeg lane (fast)

Zoom, PIP, slide-index captions, multi-aspect exports.

```bash
reactable takes list
reactable takes render <id> [--aspect 16:9,9:16,1:1]
reactable takes edit get|set <id>
```

Requires **ffmpeg** on PATH (`reactable doctor`).

Implementation: `scripts/composite.py`
