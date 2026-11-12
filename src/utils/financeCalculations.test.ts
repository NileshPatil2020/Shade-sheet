import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFinancialSummary, checkBudgetStatus } from './financeCalculations.ts';
import { formatCurrency, formatDate } from './formatters.ts';

test('computeFinancialSummary correctly aggregates income, expense, and savings rate', () => {
  const sampleTransactions = [
    { amount: 100000, type: 'income' as const, category: 'Salary', date: '2026-11-01' },
    { amount: 20000, type: 'expense' as const, category: 'Housing & Rent', date: '2026-11-02', isRecurring: true },
    { amount: 10000, type: 'expense' as const, category: 'Groceries & Dining', date: '2026-11-05' },
    { amount: 5000, type: 'expense' as const, category: 'Groceries & Dining', date: '2026-11-05' },
    { amount: 15000, type: 'investment' as const, category: 'Mutual Funds', date: '2026-11-10' },
  ];

  const summary = computeFinancialSummary(sampleTransactions);

  assert.equal(summary.totalIncome, 100000);
  assert.equal(summary.totalExpense, 35000);
  assert.equal(summary.totalInvestment, 15000);
  assert.equal(summary.netSavings, 65000);
  assert.equal(summary.savingsRate, 65);
  assert.equal(summary.recurringExpensesCount, 1);
  assert.equal(summary.recurringExpensesTotal, 20000);
  assert.equal(summary.highestSpendDay.date, '2026-11-02');
  assert.equal(summary.highestSpendDay.amount, 20000);

  // Category breakdown
  assert.equal(summary.categoryBreakdown.length, 2);
  assert.equal(summary.categoryBreakdown[0].category, 'Housing & Rent');
  assert.equal(summary.categoryBreakdown[0].amount, 20000);
  assert.equal(summary.categoryBreakdown[1].category, 'Groceries & Dining');
  assert.equal(summary.categoryBreakdown[1].amount, 15000);
});

test('checkBudgetStatus correctly identifies safe, warning, and exceeded limits', () => {
  assert.equal(checkBudgetStatus(5000, 10000), 'safe');
  assert.equal(checkBudgetStatus(8000, 10000), 'warning');
  assert.equal(checkBudgetStatus(9500, 10000), 'warning');
  assert.equal(checkBudgetStatus(10000, 10000), 'exceeded');
  assert.equal(checkBudgetStatus(12000, 10000), 'exceeded');
  assert.equal(checkBudgetStatus(100, 0), 'safe');
});

test('formatCurrency and formatDate format accurately', () => {
  assert.equal(formatCurrency(125000), '₹1,25,000');
  assert.equal(formatCurrency(-500), '-₹500');
  assert.equal(formatCurrency(0), '₹0');
  assert.ok(formatDate('2026-11-15').includes('2026'));
});
