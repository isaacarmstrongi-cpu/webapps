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

## Limitations to know about

- The statements are a **draft on the cash basis** and are marked "Draft, unaudited". Have your accountant review them before sharing them as final.
- It tracks **cash-basis** books: money in and out of bank accounts. Pledges, unpaid bills, and equipment aren't tracked. Your accountant can add those adjustments at year-end.
- Donor receipt wording is a general template. Have your accountant confirm it meets your needs, especially for gifts where the donor received something in return.
- This is a helpful tool, not a substitute for professional accounting advice.
