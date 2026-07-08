### Content research (Pro — via your Reactable account)

---
source: internal — docs/PLAN.content-intelligence.work
fetched: 2026-07-08
auth: Reactable session (server-side, Pro plan, credit-metered)
---

Raw research pulls across platforms (TikTok, Instagram, YouTube, Reddit, X,
Threads, LinkedIn, Facebook, Pinterest, Google, Twitch). Pass the upstream
endpoint + its params; auth and metering happen server-side. Costs credits
(3 typical, 4 transcripts, 30 audience) — be deliberate.

Video transcript (TikTok example):
```tool
{"name":"connector","args":{"provider":"research","endpoint":"/v1/tiktok/video/transcript","params":{"url":"https://www.tiktok.com/@user/video/123"}}}
```

Creator profile + recent videos:
```tool
{"name":"connector","args":{"provider":"research","endpoint":"/v1/tiktok/profile","params":{"handle":"mkbhd"}}}
```
```tool
{"name":"connector","args":{"provider":"research","endpoint":"/v3/tiktok/profile/videos","params":{"handle":"mkbhd"}}}
```

Topic radar (search by keyword / trending):
```tool
{"name":"connector","args":{"provider":"research","endpoint":"/v1/tiktok/search/keyword","params":{"query":"ai avatars"}}}
```
```tool
{"name":"connector","args":{"provider":"research","endpoint":"/v1/youtube/search","params":{"query":"ai avatars","sortBy":"relevance"}}}
```

Ad libraries (competitor paid creative):
```tool
{"name":"connector","args":{"provider":"research","endpoint":"/v1/facebook/adLibrary/company/ads","params":{"companyName":"Caraway"}}}
```

RULES: never mention the underlying data vendor to the user — this is
Reactable's research engine. Cite pulls in answers (post id / handle /
endpoint). If a pull 402s, the user is out of credits — say so and point at
the dashboard. Prefer `reactable intel …` verbs once they exist; raw pulls
are for what verbs don't cover.
