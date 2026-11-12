export interface MinimalTransaction {
  amount: number | string;
  type: 'income' | 'expense' | 'investment';
  category?: string;
  date?: string;
  isRecurring?: boolean;
}

export interface BudgetRule {
  category: string;
  allocatedAmount: number;
}

export interface FinancialSummary {
  totalIncome: number;
  totalExpense: number;
  totalInvestment: number;
  netSavings: number;
  savingsRate: number;
  categoryBreakdown: { category: string; amount: number; percentage: number }[];
  highestSpendDay: { date: string; amount: number };
  recurringExpensesCount: number;
  recurringExpensesTotal: number;
}

export function computeFinancialSummary(transactions: MinimalTransaction[]): FinancialSummary {
  let totalIncome = 0;
  let totalExpense = 0;
  let totalInvestment = 0;
  const categoryTotals: Record<string, number> = {};
  const dailyExpenses: Record<string, number> = {};
  let recurringExpensesCount = 0;
  let recurringExpensesTotal = 0;

  for (const t of transactions) {
    const amt = Number(t.amount) || 0;
    if (t.type === 'income') {
      totalIncome += amt;
    } else if (t.type === 'investment') {
      totalInvestment += amt;
    } else {
      totalExpense += amt;
      const cat = t.category || 'Uncategorized';
      categoryTotals[cat] = (categoryTotals[cat] || 0) + amt;

      const day = t.date ? t.date.slice(0, 10) : 'Unknown';
      dailyExpenses[day] = (dailyExpenses[day] || 0) + amt;

      if (t.isRecurring) {
        recurringExpensesCount += 1;
        recurringExpensesTotal += amt;
      }
    }
  }

  const netSavings = totalIncome - totalExpense;
  const savingsRate = totalIncome > 0 ? Math.round((netSavings / totalIncome) * 100) : 0;

  const categoryBreakdown = Object.entries(categoryTotals)
    .map(([cat, amt]) => ({
      category: cat,
      amount: amt,
      percentage: totalExpense > 0 ? Math.round((amt / totalExpense) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  let highestSpendDay = { date: 'N/A', amount: 0 };
  for (const [date, amt] of Object.entries(dailyExpenses)) {
    if (amt > highestSpendDay.amount) {
      highestSpendDay = { date, amount: amt };
    }
  }

  return {
    totalIncome,
    totalExpense,
    totalInvestment,
    netSavings,
    savingsRate,
    categoryBreakdown,
    highestSpendDay,
    recurringExpensesCount,
    recurringExpensesTotal,
  };
}

export function checkBudgetStatus(spent: number, allocated: number): 'safe' | 'warning' | 'exceeded' {
  if (allocated <= 0) return 'safe';
  const ratio = spent / allocated;
  if (ratio >= 1.0) return 'exceeded';
  if (ratio >= 0.8) return 'warning';
  return 'safe';
}
