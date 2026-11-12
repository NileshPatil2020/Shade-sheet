export type TransactionType = 'expense' | 'income' | 'investment' | 'transfer';

export interface Transaction {
  id: string;
  userId: string;
  title: string;
  amount: number;
  type: TransactionType;
  category: string;
  date: string; // YYYY-MM-DD
  account?: string;
  notes?: string;
  tags?: string[];
  isRecurring?: boolean;
  isStarred?: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface Budget {
  id: string;
  userId: string;
  category: string;
  monthlyLimit: number;
  monthYear: string; // YYYY-MM
  createdAt: string;
  updatedAt?: string;
}

export interface FinancialGoal {
  id: string;
  userId: string;
  title: string;
  targetAmount: number;
  currentAmount: number;
  targetDate?: string;
  category?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface MonthlyReport {
  id: string;
  userId: string;
  monthYear: string;
  monthName: string;
  totalIncome: number;
  totalExpense: number;
  totalInvestment?: number;
  netSavings: number;
  savingsRate?: number;
  transactionCount?: number;
  categoryBreakdown?: Array<{
    category: string;
    amount: number;
    percentage: number;
  }>;
  highestSpendDay?: {
    date: string;
    amount: number;
  };
  recurringExpensesCount?: number;
  recurringExpensesTotal?: number;
  aiThinkingAnalysis?: string;
  marketSearchContext?: string;
  citations?: Array<{
    title: string;
    uri: string;
  }>;
  generatedAt: string;
  status?: string;
}

export interface CategoryMeta {
  name: string;
  color: string;
  icon: string;
  description: string;
}
