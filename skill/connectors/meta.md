### Meta ads (Pro — via your Reactable account)

---
source: https://developers.facebook.com/docs/marketing-api
fetched: 2026-07-07
auth: Reactable session (server-side, Pro plan)
---

Your ad accounts:
```tool
{"name":"connector","args":{"provider":"meta","path":"/me/adaccounts","params":{"fields":"id,name,account_status,currency"}}}
```

Campaigns in an account (id like act_123…):
```tool
{"name":"connector","args":{"provider":"meta","path":"/act_<id>/campaigns","params":{"fields":"id,name,status,objective"}}}
```

Performance:
```tool
{"name":"connector","args":{"provider":"meta","path":"/act_<id>/insights","params":{"date_preset":"last_30d","fields":"campaign_name,impressions,clicks,spend,cpm"}}}
```

If "not connected" / "part of Pro": the user connects in Settings — don't retry.
