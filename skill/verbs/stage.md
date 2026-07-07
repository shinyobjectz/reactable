# Stage — preview and record

**Hard rule:** use `reactable stage open --deck <slug>` — never open `/present` in a browser tab.

```bash
just reactable dev                    # menu-bar app + nexus
reactable stage open --deck demo
reactable stage load --deck showcase
reactable stage status --json
reactable record                      # checklist
```

Pipeline: [stage-pipeline.md](../references/stage-pipeline.md)
