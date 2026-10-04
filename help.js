/*
 * Page instructions — the "How to use this page" panel at the top of each page.
 *
 * Each entry has numbered steps (what to do, in order) and tips (things worth
 * knowing). The panel starts open the first time someone visits a page; after
 * they fold it away it stays folded. That choice is remembered in this browser
 * only and is never part of the books or backups.
 *
 * Loaded before app.js. app.js calls addHelp() after drawing each page.
 */
'use strict';

const HELP_STORAGE_KEY = 'nonprofit-books-help';

const HELP = {
  dashboard: {
    title: 'How to use the Dashboard',
    steps: [
      'Check <b>Cash on hand</b> and the year-to-date totals at the top. They update as soon as you record anything.',
      'Record money as it comes in or goes out with <b>+ Income</b> and <b>+ Expense</b>.',
      'Work through the <b>Bookkeeping checklist</b>. Each "To do" item has a button that takes you straight to the fix.',
      'Hover over a month in the chart to see that month’s revenue, expenses, and net.',
    ],
    tips: [
      '“Where the money went” shows the share spent on programs. Many funders look for 65% or more.',
      'Click any line under Recent activity to open and edit it.',
      'New here? Start in <a href="#settings">Settings</a> with your organization’s details and bank starting balances.',
    ],
  },
  transactions: {
    title: 'How to record and find transactions',
    steps: [
      'Click <b>+ Income</b> for money received, <b>+ Expense</b> for money paid out, or <b>Transfer</b> when moving money between your own accounts (for example, checking to savings).',
      'Fill in the date, amount, and category. Choose the <b>fund</b>: use a restricted fund only when a donor said the money is for a specific purpose.',
      'For income, type the donor’s name so it counts toward their giving receipt. For expenses, choose the <b>function</b>: program, management & general, or fundraising.',
      'Tick <b>Receipt or invoice on file</b> once you’ve saved the paperwork. Your accountant will ask for it.',
      'To find something later, use Search and the filters. Click any row to edit or delete it.',
    ],
    tips: [
      '<b>Scan a receipt</b> lets Claude read a receipt photo or PDF and fill in the expense form for you to check. It needs the Claude assistant set up in Settings.',
      'Transactions marked “Reconciled” or “Closed period” are locked against accidental changes. The edit window explains why.',
      '<b>Export CSV</b> downloads exactly what the filters show, ready for Excel.',
    ],
  },
  bankfeed: {
    title: 'How to bring in transactions from your bank',
    steps: [
      'In your bank’s website, download the account activity. Choose <b>QBO</b>, <b>QFX</b>, or <b>OFX</b> if offered, otherwise <b>CSV</b>.',
      'Here, pick the <b>Bank account</b> it belongs to and click <b>Choose a bank file</b>. For CSV files, check the preview shows money in as positive and spending as negative, then click Import.',
      'Go down the <b>To review</b> list. Click <b>Match</b> when the app found the same entry already in your books. Otherwise check the category and click <b>Add</b>. Click <b>Exclude</b> for anything that doesn’t belong.',
      'Click <b>Accept suggested</b> to handle every match and every suggestion in one go, then deal with whatever is left.',
    ],
    tips: [
      'It’s safe to import overlapping dates: transactions already imported are skipped.',
      '<b>Make a rule</b> teaches the app, for example “descriptions containing AMAZON are Office Supplies.” It also learns from how you recorded similar entries before.',
      '<b>Ask Claude to categorize</b> suggests categories for lines no rule covers. Low-confidence guesses are filled in for you to check but are left out of Accept suggested.',
      'Made a mistake? Click <b>Undo</b> under Recently processed to send a line back for review.',
    ],
  },
  bankfeedStage: {
    title: 'How to check a bank file before importing',
    steps: [
      'Make sure <b>Import into</b> shows the right bank account.',
      'For CSV files, check each column choice. The preview below updates as you change them.',
      'Look at the preview amounts: deposits should be positive and spending negative. If they’re reversed, tick <b>My bank shows spending as positive numbers</b>.',
      'Click <b>Import</b>. The transactions go into the review list. Nothing reaches your books until you Match or Add each one.',
    ],
    tips: ['If dates look wrong (for example, March instead of the 3rd), switch the <b>Date format</b>.'],
  },
  reconcile: {
    title: 'How to reconcile a bank account (monthly)',
    steps: [
      'Get your bank statement for the month (paper or PDF).',
      'Choose the <b>Account</b>, enter the statement’s <b>ending date</b> and <b>ending balance</b>, and click <b>Start reconciling</b>.',
      'On the next screen, tick every transaction that appears on the statement.',
      'When the <b>Difference</b> reaches $0.00, click <b>Finish reconciliation</b>. A report is saved for your accountant under Completed reconciliations.',
    ],
    tips: [
      'Do this every month, soon after the statement arrives. It’s the best way to catch missing or mistyped entries.',
      'Items brought in through the Bank Feed are ticked for you already.',
      'If you need to fix something after finishing, click <b>Undo</b> on the most recent reconciliation for that account.',
    ],
  },
  reconcileWork: {
    title: 'How to finish this reconciliation',
    steps: [
      'Tick each transaction that appears on your bank statement. Leave unticked anything that hasn’t cleared the bank yet, such as a check not yet cashed.',
      'Watch the <b>Difference</b> box. It must reach exactly $0.00.',
      'Click <b>Finish reconciliation</b>.',
    ],
    tips: [
      'Won’t reach zero? Look for a bank fee, interest, or a deposit you haven’t recorded. Add it on the Transactions page, then come back.',
      'Compare amounts carefully: a transposed number (like $54 vs. $45) is a common cause.',
      '<b>Save & finish later</b> keeps your ticks. Start again with the same statement date to continue.',
    ],
  },
  donors: {
    title: 'How to track donors and send receipts',
    steps: [
      'Donors are added automatically when you record income and type a donor name. You can also click <b>+ Donor</b>.',
      'Click a donor’s name to add their email and mailing address. The address appears on their receipt letter.',
      'Click <b>Receipt</b> to open their year-end giving letter. Pick the year, then print it or save it as a PDF to email.',
    ],
    tips: [
      'US donors need a written acknowledgment for any single gift of $250 or more. Send receipts every January.',
      'Before your first receipts, add your EIN, address, and the signer’s name in <a href="#settings">Settings</a>.',
    ],
  },
  donorReceipt: {
    title: 'How to send this receipt',
    steps: [
      'Check the year and the list of gifts.',
      'Click <b>Print / Save PDF</b>. To email it, choose “Save as PDF” as the printer.',
    ],
    tips: ['Have your accountant review the wording once, especially for gifts where the donor received something in return, like a dinner ticket.'],
  },
  budget: {
    title: 'How to set and track a budget',
    steps: [
      'Choose the <b>Fiscal year</b>.',
      'Type the annual amount you expect for each category in the <b>Budget</b> column. It saves as soon as you leave the box.',
      'Check the <b>Variance</b> column through the year. Green is good news (more income or less spending than planned); red needs a look.',
    ],
    tips: [
      'Next year, click <b>Copy from prior year</b> and adjust instead of starting from scratch.',
      'Most boards approve the budget before the year starts and review budget vs. actual at each meeting.',
    ],
  },
  reports: {
    title: 'How to produce reports',
    steps: [
      'Pick a report. <b>Financial statements</b> are for your board and funders; <b>Working papers</b> are what your accountant or tax preparer asks for.',
      'Choose the <b>Period</b>. Tick <b>Compare to prior year</b> to show last year alongside.',
      'Click <b>Print / Save PDF</b> to share it, or <b>Export to Excel (CSV)</b> to work with the numbers.',
    ],
    tips: [
      'For a board packet, include the Statement of Activities, Statement of Financial Position, and budget vs. actual. <b>Write board summary with Claude</b> drafts the accompanying narrative.',
      'At year end, give your accountant the Trial Balance, General Ledger, Form 990 Worksheet, and your reconciliation reports.',
      'The Trial Balance should say “In balance.” If not, check that the starting balances in Settings add up.',
      'These are drafts on the cash basis. Have your accountant review them before calling them final.',
    ],
  },
  ask: {
    title: 'How to ask Claude about your books',
    steps: [
      'Click a suggested question, or type your own in plain English and press <b>Ask</b> (or Enter).',
      'Ask follow-up questions in the same conversation. Claude remembers what was said earlier in it.',
      'Click <b>New conversation</b> to change topic.',
    ],
    tips: [
      'Good questions: “Why were expenses higher in July?”, “How much is left in the youth grant?”, “Which donors haven’t given this year?”',
      'Claude can read your books but can’t change them. It will tell you where in the app to make a change.',
      'Claude can make mistakes. Check important figures against Reports before relying on them.',
      'Each question costs a few cents on your organization’s Anthropic account.',
    ],
  },
  settings: {
    title: 'How to set up the app',
    steps: [
      'Fill in <b>Organization</b>: name, EIN, address, fiscal year start, mission, and who signs donor receipts. Click Save.',
      'Under <b>Bank & cash accounts</b>, click each account and enter its balance on the day you start using the app.',
      'Under <b>Funds</b>, enter the same starting total split between unrestricted money and any donor-restricted money. The two totals must match.',
      'Review the <b>categories</b>. Rename, add, or remove them to match how your organization thinks about money.',
      'Click <b>Download backup</b> regularly, at least monthly, and keep the file somewhere safe.',
    ],
    tips: [
      '<b>Close the books</b> after each month or year is reconciled and reviewed, so past numbers can’t change by accident.',
      'To use the Claude features, enter your assistant server address and access code under <b>Claude AI assistant</b>. The README explains the one-time setup.',
      '<b>Change history</b> lists every add, edit, and delete. Accountants call this an audit trail.',
    ],
  },
};

function helpPrefs() {
  try { return JSON.parse(localStorage.getItem(HELP_STORAGE_KEY)) || {}; } catch (e) { return {}; }
}
function helpRemember(key, open) {
  const prefs = helpPrefs();
  prefs[key] = open;
  try { localStorage.setItem(HELP_STORAGE_KEY, JSON.stringify(prefs)); } catch (e) { /* not saved; fine */ }
}

/* Put the instructions panel for `key` under the page heading. */
function addHelp(key, root = $('#view')) {
  const h = HELP[key];
  const head = root && root.querySelector('.page-head');
  if (!h || !head) return;
  const open = helpPrefs()[key] !== false;
  head.insertAdjacentHTML('afterend', `
    <details class="howto no-print" data-help="${key}"${open ? ' open' : ''}>
      <summary><span class="howto-icon" aria-hidden="true">?</span>${h.title}<span class="howto-hint">${open ? 'Hide' : 'Show'}</span></summary>
      <div class="howto-body">
        <ol>${h.steps.map(s => `<li>${s}</li>`).join('')}</ol>
        ${h.tips?.length ? `<div class="howto-tips"><div class="howto-tips-label">Good to know</div><ul>${h.tips.map(t => `<li>${t}</li>`).join('')}</ul></div>` : ''}
      </div>
    </details>`);
  const panel = head.nextElementSibling;
  panel.addEventListener('toggle', () => {
    helpRemember(key, panel.open);
    panel.querySelector('.howto-hint').textContent = panel.open ? 'Hide' : 'Show';
  });
}
