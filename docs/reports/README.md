# ERP master redesign — scheduled reports

- **Word-openable report:** `ERP_MASTER_REDESIGN_PROGRESS_latest.rtf` — open in Microsoft Word; use **File → Save As → Word Document (.docx)** if you need a `.docx`.
- **Regenerate:** from repo root run `npm run report:erp` (or `node scripts/generate-erp-progress-report.mjs`).
- **Hourly on your Mac:** add a `cron` line, for example:

```cron
0 * * * * cd /full/path/to/ih35_dispatch_v3_starter && node scripts/generate-erp-progress-report.mjs
```

That runs at the top of each hour. Adjust the path to match your machine.
