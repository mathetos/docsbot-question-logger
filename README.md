# DocsBot Q&A Audit Log

> Automatically sync your [DocsBot](https://docsbot.ai) Q&A history into a Google Sheet for team review, auditing, and continuous improvement of your bot's responses.

---

## Overview

When a chatbot answers customer questions, you need visibility into **what** it said, **whether** it was helpful, and **what to do next**. This project pulls every Q&A interaction from the DocsBot Admin API into a structured Google Sheet where your team can review and triage each response.

**Built with** [Google Apps Script](https://developers.google.com/apps-script) and developed locally via [clasp](https://github.com/google/clasp).

---

## Features

- **Incremental sync** -- Only fetches new questions since the last run. A fast-path check compares the latest API entry with the sheet before doing any heavy lifting.
- **Manual or daily** -- Run "Sync Now" from the sheet menu anytime, or set a daily trigger to run automatically.
- **Review workflow** -- Each row gets dropdown columns for **Review Status** and **Action Needed**, so the team can triage directly in the sheet.
- **PII scrubbing** -- Emails, phone numbers, SSNs, credit card numbers, and IPv4 addresses are redacted before data reaches the sheet.
- **Cell-safe** -- Values exceeding Google Sheets' 50,000-character limit are automatically truncated with a `[truncated]` marker and logged.
- **Newest first** -- The log auto-sorts by date descending after every sync.
- **Secure by default** -- API keys live in Apps Script Script Properties, never in source code. `.clasp.json` is git-ignored.

---

## Action Categories

Each synced Q&A entry can be triaged with one of these actions:

| Action | When to use |
|--------|-------------|
| **Good response (no action needed)** | The bot answered correctly and completely. |
| **Needs Improvement in Docs** | The answer was weak because the underlying documentation is missing or unclear. |
| **Needs Improvement in Bot sources** | The bot has the wrong sources indexed, or key sources are missing. |
| **Needs Improvement in Custom Instructions** | The bot's behavior or tone needs tuning via its custom instructions/prompts. |

---

## Prerequisites

- **Node.js** (LTS recommended) -- for running `clasp` locally
- **Google account** with access to Google Sheets
- **DocsBot account** -- you'll need your API key (Bearer token), Team ID, and Bot ID

---

## Quick Start

### 1. Install dependencies

```bash
cd docsbot-audit
npm install
```

### 2. Authenticate with Google

```bash
npx clasp login
```

### 3. Create the Apps Script project

**New project:**

```bash
npx clasp create --type sheets --title "DocsBot Q&A Audit Log"
```

Then edit `.clasp.json` and set `"rootDir": "src"` so only the `src/` folder is pushed.

**Existing project:**

```bash
npx clasp clone <scriptId>
```

Ensure `.clasp.json` has `"rootDir": "src"`.

### 4. Push the code

```bash
npx clasp push
```

### 5. Open the sheet

```bash
npx clasp open
```

---

## Sheet Setup

### Config sheet

The script auto-creates a **Config** sheet if one doesn't exist. Fill in the required values:

| Key | Value |
|-----|-------|
| `teamId` | Your DocsBot Team ID (from the dashboard URL) |
| `botId` | Your DocsBot Bot ID (from the dashboard URL) |

### API key

From the sheet menu: **DocsBot Audit > Setup API Key**

Enter your DocsBot API Bearer token. It's stored in Apps Script **Script Properties** -- never in the sheet or source code.

### First sync

Use **DocsBot Audit > Sync Now**. The first run fetches all existing questions and may take a moment.

### Daily sync (optional)

In the Apps Script editor, select `createDailyTrigger` from the function dropdown and run it once. This installs a daily trigger (default: 6 AM in the script's timezone). Change the hour in `Config.js` via `DAILY_TRIGGER_HOUR`.

---

## Development

```bash
# Edit files in src/, then deploy
npx clasp push

# Open the sheet or script editor
npx clasp open

# View logs
npx clasp logs
```

---

## Project Structure

```
docsbot-audit/
  .clasp.json            # clasp config (git-ignored)
  .claspignore           # files excluded from push
  .gitignore
  .env.example           # documents required config values
  package.json
  README.md
  src/
    appsscript.json      # Apps Script manifest (scopes, timezone)
    Config.js            # IDs, sheet names, column layout, constants
    Main.js              # onOpen menu, sync orchestration, triggers
    DocsBotApi.js        # API client with pagination and fast-path check
    SheetWriter.js       # Row appending, dropdowns, sorting, config I/O
    PiiScrubber.js       # Regex-based PII redaction
    Utils.js             # Date formatting, source formatting, truncation
    SyncModal.html       # Progress modal (not active; reserved for future use)
```

---

## Sheet Columns

| Column | Description |
|--------|-------------|
| **Question ID** | DocsBot question ID (used for deduplication). |
| **Date/Time** | When the question was asked (local time). |
| **Question** | User's question (PII-scrubbed). |
| **Bot Answer** | Bot's response (PII-scrubbed). |
| **Could Answer?** | `YES` or `NO` -- whether DocsBot could answer. |
| **Sources** | Titles and URLs the bot cited (newline-separated). |
| **User Rating** | Rating value if the user provided one. |
| **Referrer** | Page the user came from (`metadata.referrer`). |
| **Review Status** | Dropdown: `Pending Review` / `Reviewed`. |
| **Action Needed** | Dropdown: see [Action Categories](#action-categories) above. |
| **Reviewer Notes** | Free text for team commentary. |
| **Reviewer** | Name of the person who reviewed. |

---

## Security

| Concern | How it's handled |
|---------|-----------------|
| **API key** | Stored in Apps Script **Script Properties** via the sheet menu. Never committed to source. |
| **Team/Bot IDs** | Set in the Config sheet at runtime, or as empty defaults in `Config.js`. |
| **Sheet access** | Standard Google Sheets sharing. Restrict to your review team. |
| **`.clasp.json`** | Contains the script ID. Git-ignored by default. |

---

## PII Scrubbing

Before writing to the sheet, the script redacts these patterns from **Question** and **Bot Answer** text:

| Pattern | Replacement |
|---------|-------------|
| Email addresses | `[PII-EMAIL]` |
| Phone numbers (US/international) | `[PII-PHONE]` |
| SSN (`xxx-xx-xxxx`) | `[PII-SSN]` |
| Credit card numbers (16 digits) | `[PII-CC]` |
| IPv4 addresses | `[PII-IP]` |

> **Limitation:** Detection is regex-based. It does not catch names, physical addresses, or other unstructured PII. For stricter compliance, consider additional tooling or manual review.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **"API key not set"** | Run **DocsBot Audit > Setup API Key** and enter your Bearer token. |
| **"Team ID and Bot ID must be set"** | Add `teamId` and `botId` rows in the **Config** sheet. |
| **Sync fails with 401** | Verify the API key is correct and has access to the team/bot. |
| **Duplicate rows** | The script deduplicates by Question ID and last-synced timestamp. Don't delete the Question ID column. |
| **50,000 character cell limit** | The script auto-truncates with `[truncated]`. Check **View > Executions** in the script editor for details on which fields were truncated. |

---

## License

MIT
