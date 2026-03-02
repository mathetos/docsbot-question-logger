# 🤖 DocsBot Q&A Audit Log

> Automatically sync your [DocsBot](https://docsbot.ai) Q&A history into a Google Sheet so your team can review every bot response, spot weak answers, and continuously improve your support.

---

## Why This Exists

When a chatbot answers customer questions, you need to know: **Did it answer correctly? Was something missing? Should we update our docs?**

This tool pulls every Q&A interaction from DocsBot into a Google Sheet where your team can review each response and decide what action (if any) to take.

---

## What It Does

- **Syncs automatically** — Runs once a day (or on-demand) and only fetches new questions. If nothing's new, it finishes in about a second.
- **Newest first** — New entries always appear at the top of the sheet so the most recent interactions are front and center.
- **Review workflow built in** — Each row has dropdown columns for **Review Status** and **Action Needed**, so your team can triage directly in the sheet.
- **Protects personal data** — Emails, phone numbers, SSNs, credit card numbers, and IP addresses are automatically redacted before anything is written to the sheet.
- **Handles large answers** — If a bot response exceeds Google Sheets' character limit, it's safely truncated with a `[truncated]` marker.
- **Secure** — Your API key is stored in a protected area of Google Apps Script, never in the sheet itself or in source code.

---

## Action Categories

When reviewing a Q&A entry, assign one of these actions:

| Action | When to use |
|--------|-------------|
| **Good response (no action needed)** | The bot answered correctly and completely. |
| **Needs Improvement in Docs** | The answer was weak because the underlying documentation is missing or unclear. |
| **Needs Improvement in Bot sources** | The bot has the wrong sources indexed, or key sources are missing. |
| **Needs Improvement in Custom Instructions** | The bot's behavior or tone needs tuning via its custom instructions/prompts. |

---

## Getting Started

### What you'll need

- A **Google account** with access to Google Sheets
- Your **DocsBot API key** (Bearer token), **Team ID**, and **Bot ID** — all found in your [DocsBot dashboard](https://docsbot.ai)
- **Node.js** installed on your computer (for the one-time setup)

### 1. Install and deploy

```bash
cd docsbot-audit
npm install
npx clasp login
npx clasp create --type sheets --title "DocsBot Q&A Audit Log"
```

Edit `.clasp.json` and set `"rootDir": "src"`, then push the code:

```bash
npx clasp push
```

### 2. Open the sheet

```bash
npx clasp open
```

### 3. Enter your credentials

From the sheet's menu bar, go to **🤖 DocsBot Audit**:

1. **Setup API Key** — paste your DocsBot API Bearer token
2. **Setup Team ID & Bot ID** — enter both values (found in your DocsBot dashboard URL)

### 4. Run your first sync

Go to **🤖 DocsBot Audit > Sync Now**. The first run fetches your full Q&A history and may take a moment. After that, syncs only pull in new entries and are much faster.

### 5. Set up daily sync (optional)

To have the sheet update automatically every morning, open the Apps Script editor (Extensions > Apps Script), select `createDailyTrigger` from the function dropdown, and run it once. The default is 6 AM in your script's timezone.

---

## How the Sheet Works

### Columns

| Column | What it shows |
|--------|---------------|
| **Question ID** | Internal DocsBot ID (used to avoid duplicates — don't delete this column). |
| **Date/Time** | When the question was asked. |
| **Question** | What the user asked (personal info redacted). |
| **Bot Answer** | What the bot replied (personal info redacted). |
| **Could Answer?** | `YES` or `NO` — whether DocsBot was able to answer. |
| **Sources** | Documentation pages the bot cited. |
| **User Rating** | Rating from the user, if they left one. |
| **Referrer** | The page the user was on when they asked. |
| **Review Status** | Dropdown: `Pending Review` or `Reviewed`. |
| **Action Needed** | Dropdown: see [Action Categories](#action-categories) above. |
| **Reviewer Notes** | Free text — add any context or follow-up notes. |
| **Reviewer** | Name of the person who reviewed this entry. |

### Config sheet

The script creates a **Config** sheet automatically. It stores your Team ID, Bot ID, and sync timestamps. You generally don't need to touch it after initial setup.

---

## Privacy & Data Protection

| What | How it's handled |
|------|-----------------|
| **API key** | Stored in Apps Script's protected Script Properties. Never in the sheet or code. |
| **Personal info in questions** | Automatically redacted before writing to the sheet (see below). |
| **Sheet access** | Standard Google Sheets sharing controls. Restrict to your review team. |

### What gets redacted

The script scans every question and answer for these patterns and replaces them with placeholder tags:

| Pattern | Replaced with |
|---------|---------------|
| Email addresses | `[EMAIL_REDACTED]` |
| Phone numbers | `[PHONE_REDACTED]` |
| Social Security Numbers | `[SSN_REDACTED]` |
| Credit card numbers | `[CC_REDACTED]` |
| IP addresses | `[IP_REDACTED]` |

> **Note:** This catches common structured patterns. It won't catch names, physical addresses, or other freeform personal info. If you need stricter compliance, consider additional review processes.

---

## Troubleshooting

| Problem | What to do |
|---------|------------|
| **"API key not set"** | Go to **🤖 DocsBot Audit > Setup API Key** and paste your token. |
| **"Team ID and Bot ID must be set"** | Go to **🤖 DocsBot Audit > Setup Team ID & Bot ID** and enter both values. |
| **Sync fails with 401 error** | Double-check that your API key is correct and has access to the team/bot. |
| **Seeing duplicate rows** | The script deduplicates by Question ID. Make sure the Question ID column hasn't been deleted or modified. |
| **A cell shows `[truncated]`** | The original content exceeded 50,000 characters. The full version is in the DocsBot dashboard. |
| **Sync stopped early** | The script has a 5-minute safety limit. Just run Sync Now again to continue where it left off. |

---

## For Developers

<details>
<summary>Project structure and dev commands</summary>

```
docsbot-audit/
  .clasp.json            # clasp config (git-ignored)
  .claspignore           # files excluded from push
  package.json
  README.md
  src/
    appsscript.json      # Apps Script manifest (scopes, timezone)
    Config.js            # IDs, sheet names, column layout, constants
    Main.js              # Menu, sync orchestration, triggers
    DocsBotApi.js        # API client — descending fetch, early-exit, retry
    SheetWriter.js       # Insert-at-top writes, dropdowns, config cache
    PiiScrubber.js       # Single-pass regex PII redaction
    Utils.js             # Date formatting, source formatting, truncation
    SyncModal.html       # Progress modal (reserved for future use)
```

```bash
npx clasp push      # deploy changes
npx clasp open      # open the sheet or script editor
npx clasp logs      # view execution logs
```

</details>

---

## License

MIT
