# Nonprofit Books

A simple, free bookkeeping web app for small nonprofit organizations.

It runs entirely in your web browser. There is no server, no account to create, and nothing to install.

## What it does

| Page | What it's for |
|---|---|
| **Dashboard** | Cash on hand, year-to-date revenue and expenses, a monthly chart, and how spending splits between program, admin, and fundraising |
| **Transactions** | Record income, expenses, and transfers between bank accounts. Mark whether a receipt is on file. Search, filter, and export to a spreadsheet (CSV) |
| **Bank Feed** | Import the activity file from your bank (CSV, OFX, QFX or QBO). Each bank transaction is matched to an entry you already recorded, or added as a new one with a suggested category |
| **Reconcile** | Match your records to each bank statement and save a reconciliation report listing outstanding checks and deposits |
| **Donors** | Donor list with giving totals, plus a printable **year-end tax receipt letter** for each donor |
| **Budget** | Enter an annual budget per category and see budget vs. actual with variances |
| **Reports** | See the list below. Each report can be printed or saved as a PDF |
| **Ask Claude** | Ask questions about your books in plain English (needs the Claude AI assistant, below) |
| **Settings** | Organization info, fiscal year, closing periods, chart of accounts (with account numbers and Form 990 lines), backup/restore, and change history |

The Reports page drafts a full set of nonprofit financial statements:

- **Statement of Activities** (the nonprofit version of a profit & loss), with columns for money *without* and *with* donor restrictions and a "net assets released from restrictions" line
- **Statement of Financial Position** (the nonprofit balance sheet)
- **Statement of Cash Flows**, using the direct method, with a reconciliation to the change in net assets
- **Statement of Functional Expenses**, split into program / management & general / fundraising, as on IRS Form 990 Part IX
- **Fund Activity**, which shows beginning balance, revenue, expenses, and ending balance for each fund
- **Notes to Financial Statements**, a draft filled in from your numbers: accounting policies, liquidity, restricted net assets, and donor concentrations

The four main statements can show **this year next to the prior year**: tick "Compare to prior year".

It also produces the working papers an accountant asks for:

- **Trial Balance**, which lists every account by number and checks that debits equal credits
- **General Ledger**, which lists every transaction by account with running balances
- **Form 990 Worksheet**, which totals your categories by IRS Form 990 line (Part VIII revenue, Part IX expenses by function)
- **Donor Giving**, a summary of gifts by donor

Any report can be printed, saved as PDF, or **exported to Excel (CSV)**.

### Built-in controls accountants look for

- **Bank reconciliation:** each month, tick the items on your bank statement until the difference is $0.00. The app saves a report your accountant can review. Reconciled transactions can't have their amount or date changed by accident.
- **Closing the books:** in Settings, set "Books closed through" a date. Nothing on or before it can be added, edited, or deleted.
- **Change history:** every add, edit, delete, reconciliation, and period close is logged (an audit trail).
- **Receipt tracking:** mark each expense "receipt on file". The dashboard checklist shows what's missing.

### Bank feed: bringing in your bank transactions

1. In your bank's website, download the account activity. Choose **QuickBooks (QBO)**, **Quicken (QFX)** or **OFX** if offered, otherwise **CSV**.
2. In the app, open **Bank Feed**, pick the account, and choose the file. CSV files show a preview so you can check which column is which.
3. Review each bank transaction:
   - **Match**: it's already in your books, so the two are linked.
   - **Add**: it's new. The category is suggested from your **bank rules** ("description contains AMAZON → Office Supplies") or from how you recorded similar entries before.
   - **Exclude**: it doesn't belong in the books, or it's a duplicate.
4. **Accept suggested** handles every match and every item that has a suggestion in one click.

Details:
- Transactions you've already imported are skipped automatically, so it's safe to download overlapping date ranges.
- Everything matched or added is marked as cleared, which makes bank reconciliation quick.
- QBO/QFX/OFX files also include your bank balance. The page compares it with your books.
- The file is read on your computer and never uploaded.

**About automatic (live) bank connections.** Pulling transactions every day without downloading a file needs a paid bank-data service, such as Plaid, which typically charges per connected account. It also needs a small secure server to hold that service's secret keys, which this browser-only app doesn't have. The bank feed above is built so a live connection can feed into the same review screen later.

### Key ideas, in plain English

- **Accounts** are where money physically sits, such as checking, savings, or petty cash.
- **Funds** track *whose rules* apply to the money:
  - "General Operating" is unrestricted and can be used for anything.
  - A restricted fund, such as a grant for a youth program, can only be spent on that purpose.
- **Categories** describe *what kind* of income or expense it is, such as Grants or Rent.
- **Function** says *what an expense supported*:
  - **Program** is your mission work.
  - **Management & general** is admin and overhead.
  - **Fundraising** is the cost of raising money.

  Donors and grantmakers often look at the percentage spent on programs.

## Claude AI assistant (optional)

Four features use Claude, Anthropic's AI:

| Feature | Where | What it does |
|---|---|---|
| **Ask Claude** | Ask Claude page | Answers questions like "How are we doing against the budget?" from your actual books |
| **Board summary** | Reports → "Write board summary with Claude" | Drafts the plain-English summary that goes with the statements in a board packet. It's saved with your books |
| **Smart categorizing** | Bank Feed → "Ask Claude to categorize" | Suggests category, fund, and function for bank transactions your rules don't cover. Low-confidence guesses are never auto-accepted |
| **Scan a receipt** | Transactions → "Scan a receipt" | Reads a receipt photo or PDF and fills in the expense form for you to check and save |

Claude can make mistakes. Everything it suggests waits for you to review it, and nothing is added to your books until you click Add or Save.

### How it's connected

The app runs in the browser, which can't keep a secret. So it talks to Claude through a **small server you own** (a free Cloudflare Worker, in the `worker/` folder). The server holds your Anthropic API key, and it only does these four jobs.

```
Your browser  →  your Cloudflare Worker (holds the API key)  →  Claude
```

People using the app need two things from you: the Worker's web address and an **access code** you choose. Only your website (set in `worker/wrangler.toml`) can use the Worker.

### Costs

- Each use is billed to your Anthropic account, usually a few cents. The Ask feature sends a copy of your books with each question, so larger books cost a little more per question.
- Cloudflare Workers are free at this scale.
- Set a monthly spending limit in the Anthropic Console so there are no surprises.

### One-time setup (about 20 minutes)

1. **Get an Anthropic API key.** Sign up at [console.anthropic.com](https://console.anthropic.com), add a payment method and some credit under Billing, set a monthly limit, then create a key under API Keys. Copy it somewhere safe for a few minutes.
2. **Create a free Cloudflare account** at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up).
3. **Install Node.js** (the "LTS" version) from [nodejs.org](https://nodejs.org). This lets your computer run the setup commands.
4. **Download this project** (green **Code** button → **Download ZIP**, then unzip it).
5. **Open a terminal in the `worker` folder.** On Windows, open the folder and type `cmd` in the address bar. On a Mac, right-click the folder and choose "New Terminal at Folder".
6. **Check your website address** in `worker/wrangler.toml`: `ALLOWED_ORIGINS` must be your GitHub Pages address (for example `https://your-name.github.io`). Open the file in any text editor if you need to change it.
7. **Run these commands one at a time:**
   ```
   npm install
   npx wrangler login
   npx wrangler deploy
   npx wrangler secret put ANTHROPIC_API_KEY
   npx wrangler secret put APP_ACCESS_CODE
   ```
   - `wrangler login` opens your browser to approve access to your Cloudflare account.
   - `wrangler deploy` prints your Worker's address, like `https://nonprofit-books-claude.your-name.workers.dev`.
   - The two `secret put` commands each ask you to paste a value: first your Anthropic API key, then an access code you make up (a long passphrase, like `tomato-river-garden-42`).
8. **In the app,** go to **Settings → Claude AI assistant**, enter the Worker's address and the access code, and click **Test connection**.

To change the API key or access code later, run the `secret put` command again. To turn the assistant off, delete the Worker in the Cloudflare dashboard.

### What is shared, and with whom

When you use a Claude feature, the data that feature needs goes from your browser, through your Worker, to Anthropic:
- **Ask and board summary:** a summary of your books plus recent transactions.
- **Categorizing:** the bank lines being reviewed.
- **Receipts:** the receipt you choose.

Nothing is sent until someone uses a Claude feature. The Worker address and access code are stored only in each person's browser and are left out of backups.

## ⚠️ Important: where your data lives

Your books are saved **inside the web browser on the computer you use**, using the browser's built-in storage. That means:

- If you open the app on a different computer or browser, you won't see your data there.
- If you clear your browser's history or site data, **your data will be erased**.

**So: go to Settings → "Download backup" regularly** (monthly is a good habit) and save that file somewhere safe, like Google Drive or email. You can restore it on any computer with "Restore from backup".

## Try it on your computer (no setup)

1. Download this project. On GitHub, click the green **Code** button, then **Download ZIP**, then unzip it.
2. Double-click `index.html`. It opens in your browser.
3. On the Dashboard, click **"Try it with sample data"** to explore.
4. When you're ready for real use, go to **Settings → Erase everything**, then enter your own information.

## Put it on the web for free (GitHub Pages)

This gives you a web address like `https://YOUR-USERNAME.github.io/webapps/` that works on any device.

1. Make sure the code is on your repository's **main** branch. If it's on another branch, open a Pull Request and merge it.
2. On GitHub, open your repository and click **Settings** (top menu).
3. In the left sidebar, click **Pages**.
4. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
5. Set **Branch** to `main` and the folder to `/ (root)`, then click **Save**.
6. Wait 1–2 minutes and refresh the page. Your site's address appears at the top of the Pages settings.

Every time new changes are merged into `main`, the site updates automatically within a couple of minutes.

> Note: each person's browser keeps its own copy of the data. If two people open the website, they will **not** see each other's entries. To share, one person downloads a backup and the other restores it. If you later need true multi-user access, the next step would be adding a small online database. Ask about it when you're ready.

## Files

| File | What it contains |
|---|---|
| `index.html` | The page structure (header, navigation, pop-up form) |
| `styles.css` | Colors, layout, dark mode, and print styles |
| `app.js` | All the logic: saving data, the pages, calculations, and reports. It's organized into labeled sections |
| `bankfeed.js` | The Bank Feed page: reading bank files, matching, and suggestions |
| `ai.js` | The Claude features and the Settings card that connects them |
| `worker/` | The small Cloudflare server that holds the Anthropic API key (`src/index.js`), its settings (`wrangler.toml`), and its tests (`npm test`) |

## Limitations to know about

- The statements are a **draft on the cash basis** and are marked "Draft, unaudited". Have your accountant review them before sharing them as final.
- It tracks **cash-basis** books: money in and out of bank accounts. Pledges, unpaid bills, and equipment aren't tracked. Your accountant can add those adjustments at year-end.
- Donor receipt wording is a general template. Have your accountant confirm it meets your needs, especially for gifts where the donor received something in return.
- This is a helpful tool, not a substitute for professional accounting advice.
