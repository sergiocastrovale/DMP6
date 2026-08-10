---
name: analyze-errors
description: SSH to NAS, fetch errors.log from Docker container, analyze last sync session errors grouped by category with fix suggestions.
user-invocable: true
---

# Analyze Errors

Fetch and analyze error logs from the NAS Docker container. Groups errors by category and suggests fixes.

---

## Steps

1. **Fetch log**: `ssh nas "sudo docker exec dmp cat /app/errors.log"`
2. **Identify last session**: Find the most recent contiguous block of log entries (gap > 2 hours = new session boundary)
3. **Categorize errors** into these known types:

### Error Categories

| Category | Pattern | Severity | Typical Fix |
|----------|---------|----------|-------------|
| MB Rate Limiting | `HTTP 503 - Waiting for MusicBrainz` | Low | Self-recovering, and mostly absent from newer logs: load-shed 503s are absorbed silently and only counted in the run summary. Raising `MB_MIN_DELAY_MS` does not help — we sit at ~1/15 of the allowance |
| Connection Failures | `Request failed: error sending request for url` | Medium | Transient network errors. Retry logic improvement |
| Compound Artist Search | `Search error:` + artist name with "&", "feat.", "with", "presents", commas | Low | Expected for collaboration artists. The index-time MusicBrainz resolver decides splits now - re-run `./index --resolve-artists` rather than splitting by hand |
| File Permissions | `Permission denied (os error 13)` | Medium | Fix file ownership/permissions on NAS |
| Release Sync Failures | `Failed to sync` or `N release(s) synced, M failed` | Medium | Usually caused by connection failures above |
| Artist Detail Errors | `Detail error: Request failed` | Medium | MB API timeout fetching artist metadata |
| Release Group Errors | `Release groups error: Request failed` | Medium | MB API timeout fetching release groups |
| Embed Art Failures | `Embed art ... Permission denied` | Low | File permission issue for cover art embedding |

4. **Count occurrences** per category
5. **Report** with:
   - Session time range
   - Table: category, count, severity, actionable?
   - Per-category details with specific artist/release names affected
   - Suggested fixes ranked by impact

## Output Format

```
## Session: [start] → [end] ([duration])

### Summary Table
| Category | Count | Severity | Actionable? |
...

### Category Details
#### 1. [Category Name] — N occurrences
- What: ...
- Impact: ...
- Fix: ...
- Affected: [list specific artists/releases if relevant]
```

## Notes

- Warnings (WARN) are informational, not errors — include but separate
- 503s are normal for MB API under load — only flag if attempt count regularly hits 3+. `./dissect` turns the same log into `reports/errors.xlsx` if a spreadsheet is easier than a summary
- Compound artist names (containing "&", "feat.", "with", "presents", commas) will almost always fail search — these are expected
- `errors.log` is append-only; grows across sessions. Use timestamps to isolate sessions
