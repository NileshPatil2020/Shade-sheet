import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  auth,
  db,
  googleProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User,
  testFirestoreConnection,
  handleFirestoreError,
  OperationType,
} from './lib/firebase';
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
} from 'firebase/firestore';
import {
  Transaction,
  Budget,
  FinancialGoal,
  MonthlyReport,
} from './types/finance';
import {
  CATEGORIES,
  INITIAL_TRANSACTIONS,
  INITIAL_BUDGETS,
  INITIAL_GOALS,
} from './data/initialData';
import { formatCurrency, formatDate, downloadCsv } from './utils/formatters';
import confetti from 'canvas-confetti';

export default function App() {
  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // App navigation state
  const [activeView, setActiveView] = useState<'explore' | 'saved' | 'compare' | 'reports' | 'budgets'>('explore');

  // Ledger state
  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    try {
      const saved = localStorage.getItem('kosh-transactions');
      return saved ? JSON.parse(saved) : INITIAL_TRANSACTIONS;
    } catch {
      return INITIAL_TRANSACTIONS;
    }
  });

  const [budgets, setBudgets] = useState<Budget[]>(() => {
    try {
      const saved = localStorage.getItem('kosh-budgets');
      return saved ? JSON.parse(saved) : INITIAL_BUDGETS;
    } catch {
      return INITIAL_BUDGETS;
    }
  });

  const [goals, setGoals] = useState<FinancialGoal[]>(() => {
    try {
      const saved = localStorage.getItem('kosh-goals');
      return saved ? JSON.parse(saved) : INITIAL_GOALS;
    } catch {
      return INITIAL_GOALS;
    }
  });

  const [monthlyReports, setMonthlyReports] = useState<MonthlyReport[]>(() => {
    try {
      const saved = localStorage.getItem('kosh-monthly-reports');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Filter & Search states
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('All');
  const [selectedSort, setSelectedSort] = useState<string>('newest');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedMonth, setSelectedMonth] = useState<string>('All');

  // Selection & Modal states
  const [comparingIds, setComparingIds] = useState<Set<string>>(() => {
    try {
      const s = localStorage.getItem('kosh-compare');
      return new Set(s ? JSON.parse(s) : []);
    } catch {
      return new Set();
    }
  });

  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [isAdvisorOpen, setIsAdvisorOpen] = useState(false);

  // Automated Monthly Report generation state
  const [reportMonth, setReportMonth] = useState<string>('2026-11');
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [activeReport, setActiveReport] = useState<MonthlyReport | null>(null);

  // AI Advisor Chat state
  const [advisorInput, setAdvisorInput] = useState('');
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [advisorMessages, setAdvisorMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([
    {
      role: 'assistant',
      text: 'Hello. I am Kosh Advisor, powered by deep reasoning financial intelligence. Ask me about your spending leaks, budget limits, whether you can afford an upcoming purchase, or how to accelerate your savings.',
    },
  ]);

  // Toast state
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2600);
  };

  // Currency preference
  const currency = '₹';

  // 1. Boot connection check & Firebase Auth listener
  useEffect(() => {
    testFirestoreConnection();

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
      if (currentUser) {
        showToast(`Signed in as ${currentUser.displayName || currentUser.email}`);
      }
    });

    return () => unsubscribe();
  }, []);

  // 2. Firestore synchronization when signed in
  useEffect(() => {
    if (!user) return;

    // Transactions listener
    const txColPath = `users/${user.uid}/transactions`;
    const txQuery = query(collection(db, txColPath), orderBy('date', 'desc'));
    const unsubTx = onSnapshot(
      txQuery,
      (snapshot) => {
        if (!snapshot.empty) {
          const list: Transaction[] = [];
          snapshot.forEach((doc) => {
            list.push(doc.data() as Transaction);
          });
          setTransactions(list);
        } else {
          // If Firestore is empty for a new user, seed initial data to their account
          INITIAL_TRANSACTIONS.forEach(async (t) => {
            const userTx = { ...t, userId: user.uid };
            try {
              await setDoc(doc(db, txColPath, t.id), userTx);
            } catch (err) {
              handleFirestoreError(err, OperationType.WRITE, txColPath);
            }
          });
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, txColPath);
      }
    );

    // Monthly Reports listener
    const reportsPath = `users/${user.uid}/monthlyReports`;
    const unsubReports = onSnapshot(
      collection(db, reportsPath),
      (snapshot) => {
        const list: MonthlyReport[] = [];
        snapshot.forEach((doc) => {
          list.push(doc.data() as MonthlyReport);
        });
        if (list.length > 0) {
          setMonthlyReports(list);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, reportsPath);
      }
    );

    return () => {
      unsubTx();
      unsubReports();
    };
  }, [user]);

  // Sync to localStorage for fast local offline caching
  useEffect(() => {
    try {
      localStorage.setItem('kosh-transactions', JSON.stringify(transactions));
      localStorage.setItem('kosh-budgets', JSON.stringify(budgets));
      localStorage.setItem('kosh-goals', JSON.stringify(goals));
      localStorage.setItem('kosh-monthly-reports', JSON.stringify(monthlyReports));
      localStorage.setItem('kosh-compare', JSON.stringify([...comparingIds]));
    } catch (e) {
      console.warn('Storage sync issue:', e);
    }
  }, [transactions, budgets, goals, monthlyReports, comparingIds]);

  // Auth actions
  const handleGoogleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.error('Sign in failed:', err);
      showToast('Sign-in cancelled or unavailable.');
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      showToast('Signed out of Kosh.');
    } catch (err) {
      console.error('Sign out error:', err);
    }
  };

  // Keyboard shortcut: '/' to search, 'Esc' to close modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsDetailModalOpen(false);
        setIsAddModalOpen(false);
        setIsAdvisorOpen(false);
      }
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        const searchInput = document.getElementById('search') as HTMLInputElement | null;
        searchInput?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Filtered transactions
  const filteredTransactions = useMemo(() => {
    return transactions
      .filter((t) => {
        // Search query
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchTitle = t.title.toLowerCase().includes(q);
          const matchCat = t.category.toLowerCase().includes(q);
          const matchAcc = (t.account || '').toLowerCase().includes(q);
          const matchNotes = (t.notes || '').toLowerCase().includes(q);
          const matchTags = (t.tags || []).some((tag) => tag.toLowerCase().includes(q));
          const matchAmt = String(t.amount).includes(q);
          if (!matchTitle && !matchCat && !matchAcc && !matchNotes && !matchTags && !matchAmt) {
            return false;
          }
        }

        // Type filter
        if (selectedType === 'expense' && t.type !== 'expense') return false;
        if (selectedType === 'income' && t.type !== 'income') return false;
        if (selectedType === 'investment' && t.type !== 'investment') return false;
        if (selectedType === 'recurring' && !t.isRecurring) return false;

        // Category filter
        if (selectedCategory !== 'All' && t.category !== selectedCategory) return false;

        // Month filter
        if (selectedMonth !== 'All' && !t.date.startsWith(selectedMonth)) return false;

        return true;
      })
      .sort((a, b) => {
        if (selectedSort === 'newest') return b.date.localeCompare(a.date);
        if (selectedSort === 'oldest') return a.date.localeCompare(b.date);
        if (selectedSort === 'amount-desc') return b.amount - a.amount;
        if (selectedSort === 'amount-asc') return a.amount - b.amount;
        if (selectedSort === 'category') return a.category.localeCompare(b.category);
        return 0;
      });
  }, [transactions, searchQuery, selectedType, selectedSort, selectedCategory, selectedMonth]);

  // Overall calculations for Explore view
  const metrics = useMemo(() => {
    let income = 0;
    let expense = 0;
    let investment = 0;

    for (const t of filteredTransactions) {
      if (t.type === 'income') income += t.amount;
      else if (t.type === 'investment') investment += t.amount;
      else expense += t.amount;
    }

    const net = income - expense;
    const savingsRate = income > 0 ? Math.round((net / income) * 100) : 0;
    return { income, expense, investment, net, savingsRate };
  }, [filteredTransactions]);

  // Toggle starred transaction
  const toggleStar = async (tx: Transaction, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const updated = { ...tx, isStarred: !tx.isStarred, updatedAt: new Date().toISOString() };
    const nextList = transactions.map((t) => (t.id === tx.id ? updated : t));
    setTransactions(nextList);

    if (user) {
      try {
        await setDoc(doc(db, `users/${user.uid}/transactions`, tx.id), updated, { merge: true });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}/transactions/${tx.id}`);
      }
    }
    showToast(updated.isStarred ? 'Saved to starred ledger' : 'Removed from starred');
  };

  // Toggle compare selection
  const toggleCompare = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const next = new Set(comparingIds);
    if (next.has(id)) {
      next.delete(id);
      showToast('Removed from comparison');
    } else {
      if (next.size >= 4) {
        showToast('You can compare up to four items');
        return;
      }
      next.add(id);
      showToast('Added to comparison');
    }
    setComparingIds(next);
  };

  // Add / Edit Transaction
  const handleSaveTransaction = async (txData: Partial<Transaction>) => {
    const isEdit = !!editingTransaction;
    const now = new Date().toISOString();
    const id = isEdit ? editingTransaction.id : `tx-${Date.now()}`;
    const newTx: Transaction = {
      id,
      userId: user?.uid || 'default',
      title: txData.title || 'Untitled Transaction',
      amount: Number(txData.amount) || 0,
      type: txData.type || 'expense',
      category: txData.category || 'Food & Dining',
      date: txData.date || new Date().toISOString().slice(0, 10),
      account: txData.account || 'HDFC Bank',
      notes: txData.notes || '',
      tags: txData.tags || [],
      isRecurring: !!txData.isRecurring,
      isStarred: !!txData.isStarred,
      createdAt: isEdit ? editingTransaction.createdAt : now,
      updatedAt: now,
    };

    let next: Transaction[];
    if (isEdit) {
      next = transactions.map((t) => (t.id === id ? newTx : t));
    } else {
      next = [newTx, ...transactions];
    }
    setTransactions(next);

    if (user) {
      const path = `users/${user.uid}/transactions/${id}`;
      try {
        await setDoc(doc(db, `users/${user.uid}/transactions`, id), newTx);
      } catch (err) {
        handleFirestoreError(err, isEdit ? OperationType.UPDATE : OperationType.CREATE, path);
      }
    }

    setIsAddModalOpen(false);
    setEditingTransaction(null);
    showToast(isEdit ? 'Transaction updated' : 'Transaction recorded in ledger');
  };

  // Delete Transaction
  const handleDeleteTransaction = async (id: string) => {
    const next = transactions.filter((t) => t.id !== id);
    setTransactions(next);
    if (comparingIds.has(id)) {
      const nextComp = new Set(comparingIds);
      nextComp.delete(id);
      setComparingIds(nextComp);
    }
    if (user) {
      const path = `users/${user.uid}/transactions/${id}`;
      try {
        await deleteDoc(doc(db, `users/${user.uid}/transactions`, id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      }
    }
    setIsDetailModalOpen(false);
    showToast('Transaction removed');
  };

  // Automated Monthly Report Generator Handler
  const handleGenerateReport = async (targetMonth = reportMonth) => {
    setIsGeneratingReport(true);
    showToast(`Analyzing ${targetMonth} ledger with Gemini High Thinking & Search Grounding...`);

    try {
      const monthTx = transactions.filter((t) => t.date.startsWith(targetMonth));
      const monthBudgets = budgets.filter((b) => b.monthYear === targetMonth);

      const d = new Date(`${targetMonth}-01`);
      const monthName = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

      const res = await fetch('/api/monthly-report/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          monthYear: targetMonth,
          monthName,
          transactions: monthTx,
          budgets: monthBudgets,
          goals,
          currency,
        }),
      });

      if (!res.ok) {
        throw new Error(`Report generation failed with status ${res.status}`);
      }

      const data = await res.json();
      if (data.report) {
        const reportWithId: MonthlyReport = {
          ...data.report,
          id: `report-${targetMonth}-${Date.now()}`,
          userId: user?.uid || 'default',
        };

        setActiveReport(reportWithId);
        setMonthlyReports((prev) => [reportWithId, ...prev.filter((r) => r.monthYear !== targetMonth)]);

        if (user) {
          try {
            await setDoc(doc(db, `users/${user.uid}/monthlyReports`, reportWithId.id), reportWithId);
          } catch (err) {
            handleFirestoreError(err, OperationType.CREATE, `users/${user.uid}/monthlyReports/${reportWithId.id}`);
          }
        }

        setActiveView('reports');
        showToast('Automated Monthly Report compiled successfully!');
        confetti({ particleCount: 45, spread: 60, origin: { y: 0.6 } });
      }
    } catch (err: any) {
      console.error('Report error:', err);
      showToast('Could not compile report: ' + (err.message || 'Error occurred'));
    } finally {
      setIsGeneratingReport(false);
    }
  };

  // AI Advisor Chat submit handler
  const handleSendAdvisorQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!advisorInput.trim() || advisorLoading) return;

    const userText = advisorInput.trim();
    setAdvisorInput('');
    setAdvisorMessages((prev) => [...prev, { role: 'user', text: userText }]);
    setAdvisorLoading(true);

    try {
      const res = await fetch('/api/ai/advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userText,
          contextData: {
            metrics,
            transactionCount: transactions.length,
            recentTransactions: transactions.slice(0, 15),
            budgets,
            goals,
            month: reportMonth,
          },
        }),
      });

      const data = await res.json();
      if (data.reply) {
        setAdvisorMessages((prev) => [...prev, { role: 'assistant', text: data.reply }]);
      } else {
        setAdvisorMessages((prev) => [...prev, { role: 'assistant', text: 'Advice generated based on standard budget principles.' }]);
      }
    } catch (err: any) {
      console.error('Advisor error:', err);
      setAdvisorMessages((prev) => [
        ...prev,
        { role: 'assistant', text: 'I encountered an error analyzing that query. Please try asking again.' },
      ]);
    } finally {
      setAdvisorLoading(false);
    }
  };

  // Export CSV of transactions
  const handleExportCsv = () => {
    const headers = ['ID', 'Title', 'Amount', 'Type', 'Category', 'Date', 'Account', 'Notes', 'Recurring', 'Starred'];
    const rows = filteredTransactions.map((t) => [
      t.id,
      t.title,
      t.amount,
      t.type,
      t.category,
      t.date,
      t.account || '',
      t.notes || '',
      t.isRecurring ? 'Yes' : 'No',
      t.isStarred ? 'Yes' : 'No',
    ]);
    downloadCsv(`kosh-ledger-${selectedMonth}.csv`, headers, rows);
    showToast('Ledger CSV downloaded');
  };

  // Reset filters
  const resetFilters = () => {
    setSearchQuery('');
    setSelectedType('All');
    setSelectedSort('newest');
    setSelectedCategory('All');
    setSelectedMonth('All');
    showToast('Filters reset');
  };

  // Scroll to workspace
  const scrollToWorkspace = () => {
    const el = document.getElementById('workspace');
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="app">
      {/* Topbar */}
      <header className="topbar">
        <a href="#top" className="brandmark" aria-label="Kosh home">
          <div className="logo">
            <span>K</span>
          </div>
          <div>
            <div className="brandname">KOSH</div>
            <div className="tagline">PERSONAL FINANCE & AUTOMATED REPORTS</div>
          </div>
        </a>

        <div className="top-actions">
          {user ? (
            <div className="user-pill" title={user.email || ''}>
              {user.photoURL ? (
                <img src={user.photoURL} alt="Avatar" className="user-avatar" />
              ) : (
                <div className="user-avatar">{(user.displayName || user.email || 'U')[0].toUpperCase()}</div>
              )}
              <span className="hidden sm:inline">{user.displayName || user.email?.split('@')[0]}</span>
              <button
                type="button"
                onClick={handleSignOut}
                className="text-xs text-neutral-500 hover:text-neutral-900 ml-1 font-semibold"
                title="Sign out"
              >
                Sign out
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleGoogleSignIn}
              className="top-link"
              disabled={authLoading}
            >
              <span>G</span> Sign in with Google
            </button>
          )}

          <button
            type="button"
            className="top-link"
            onClick={() => {
              setActiveView('reports');
              scrollToWorkspace();
            }}
          >
            Monthly reports <span aria-hidden="true">↗</span>
          </button>

          <button
            type="button"
            className="top-cta"
            onClick={() => {
              setEditingTransaction(null);
              setIsAddModalOpen(true);
            }}
          >
            Add transaction <span aria-hidden="true">+</span>
          </button>
        </div>
      </header>

      <main id="top">
        {/* Editorial Hero Section */}
        <section className="hero" aria-labelledby="heroTitle">
          <div className="hero-copy">
            <div className="eyebrow">A more mindful way to master wealth</div>
            <h1 id="heroTitle">
              Every rupee has <em>a story.</em>
            </h1>
            <p>
              Track your cash flow across bank accounts, categorize expenses with discipline, and generate
              automated end-of-month financial reports powered by deep reasoning and real-time market grounding.
            </p>
            <div className="hero-actions">
              <button
                type="button"
                className="hero-primary"
                onClick={() => {
                  setActiveView('explore');
                  scrollToWorkspace();
                }}
              >
                Explore the ledger <span aria-hidden="true">↘</span>
              </button>
              <button
                type="button"
                className="hero-secondary"
                onClick={() => {
                  setActiveView('reports');
                  scrollToWorkspace();
                }}
              >
                Automated monthly report <span aria-hidden="true">↗</span>
              </button>
              <button
                type="button"
                className="hero-secondary"
                onClick={() => setIsAdvisorOpen(true)}
              >
                Ask AI Advisor ✦
              </button>
            </div>
          </div>

          <div className="hero-art" aria-label="Live financial dashboard visual card">
            <div className="palette-board">
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-[10px] tracking-widest uppercase font-bold text-neutral-300">
                    NOVEMBER 2026 STATEMENT
                  </div>
                  <div className="text-2xl font-black text-white mt-1">
                    {formatCurrency(metrics.income - metrics.expense, currency)}
                  </div>
                  <div className="text-[11px] text-emerald-300 font-semibold mt-0.5">
                    Net Monthly Surplus · {metrics.savingsRate}% Savings Rate
                  </div>
                </div>
                <span className="text-[9px] bg-white/10 px-2 py-1 rounded text-white font-mono">
                  LIVE SYNC
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 my-2 text-xs">
                <div className="bg-white/10 p-2 rounded-lg">
                  <div className="text-[9px] text-neutral-300 uppercase tracking-wider">Inflow</div>
                  <div className="font-bold text-white text-sm">{formatCurrency(metrics.income, currency)}</div>
                </div>
                <div className="bg-white/10 p-2 rounded-lg">
                  <div className="text-[9px] text-neutral-300 uppercase tracking-wider">Outflow</div>
                  <div className="font-bold text-rose-200 text-sm">{formatCurrency(metrics.expense, currency)}</div>
                </div>
              </div>

              <div className="flex items-center justify-between text-[10px] text-neutral-300 pt-2 border-t border-white/10">
                <span>{filteredTransactions.length} Transactions</span>
                <span className="text-amber-200">Gemini Thinking Mode Ready</span>
              </div>
            </div>
            <div className="art-label">WEALTH INTELLIGENCE · VOL. 01</div>
            <div className="art-caption">COLLECT DATA. PRESERVE CAPITAL.</div>
          </div>
        </section>

        {/* Trust Row */}
        <div className="trust-row" aria-label="App features">
          <div className="trust-item">
            <div className="trust-icon">⌕</div>
            <div>
              <strong>Intelligent Ledger</strong>
              <small>Filter by tags, merchant & category</small>
            </div>
          </div>
          <div className="trust-item">
            <div className="trust-icon">♡</div>
            <div>
              <strong>Starred & Audited</strong>
              <small>Flag key receipts & subscriptions</small>
            </div>
          </div>
          <div className="trust-item">
            <div className="trust-icon">◫</div>
            <div>
              <strong>Automated Reports</strong>
              <small>AI thinking audit & search grounding</small>
            </div>
          </div>
        </div>

        {/* Workspace Container */}
        <section className="workspace" id="workspace" aria-label="Personal finance studio">
          <div className="workspace-head">
            <div>
              <div className="section-kicker">The financial ledger</div>
              <h2>
                {activeView === 'explore' && 'Personal Cash Flow & Expenses'}
                {activeView === 'saved' && 'Starred & Audited Records'}
                {activeView === 'compare' && 'Multi-Month Comparison'}
                {activeView === 'reports' && 'Automated Monthly Report Studio'}
                {activeView === 'budgets' && 'Budgets & Financial Milestones'}
              </h2>
              <p>
                Manage your day-to-day accounts, track recurring subscriptions, and generate automated executive
                monthly statements grounded in current economic data.
              </p>
            </div>
            <div className="head-note" id="headNote">
              {user ? `Cloud synced (${user.email})` : 'Local ledger mode'}
            </div>
          </div>

          {/* Coverage & Summary Strip */}
          <div className="coverage-strip" id="coverageStrip">
            <div className="coverage-copy">
              <strong id="coverageHeadline">
                {formatCurrency(metrics.income, currency)} Inflow · {formatCurrency(metrics.expense, currency)} Outflow
                ({metrics.savingsRate}% Saved)
              </strong>
              <span id="coverageSub">
                {filteredTransactions.length} transactions recorded. Use Automated Reports to generate executive
                financial reviews with Gemini 4 Carbon thinking mode and real-time search benchmarks.
              </span>
            </div>
            <div className="coverage-actions">
              <button
                type="button"
                className="coverage-action secondary"
                onClick={handleExportCsv}
              >
                Download CSV ↓
              </button>
              <button
                type="button"
                className="coverage-action"
                onClick={() => handleGenerateReport(reportMonth)}
                disabled={isGeneratingReport}
              >
                {isGeneratingReport ? 'Analyzing...' : 'Generate Monthly Report ↗'}
              </button>
            </div>
          </div>

          {/* Search & Filter Row */}
          <div className="search-row">
            <label className="searchbox" htmlFor="search">
              <span className="search-icon" aria-hidden="true">⌕</span>
              <input
                id="search"
                type="search"
                autoComplete="off"
                placeholder="Search merchant, notes, account or tag (press '/' to focus)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  id="searchClear"
                  className="search-clear"
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setSearchQuery('')}
                >
                  ×
                </button>
              )}
            </label>

            <div className="select-wrap">
              <select
                id="typeFilter"
                aria-label="Filter by transaction type"
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
              >
                <option value="All">All types</option>
                <option value="expense">Expenses only</option>
                <option value="income">Income only</option>
                <option value="investment">Investments only</option>
                <option value="recurring">Recurring bills</option>
              </select>
            </div>

            <div className="select-wrap">
              <select
                id="sort"
                aria-label="Sort transactions"
                value={selectedSort}
                onChange={(e) => setSelectedSort(e.target.value)}
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="amount-desc">Amount (High–Low)</option>
                <option value="amount-asc">Amount (Low–High)</option>
                <option value="category">Category A–Z</option>
              </select>
            </div>
          </div>

          {/* Category Chips Filter Block */}
          <div className="filter-block">
            <div className="brand-chips" aria-label="Filter by category">
              <button
                type="button"
                className={`chip ${selectedCategory === 'All' ? 'active' : ''}`}
                onClick={() => setSelectedCategory('All')}
              >
                All categories
              </button>
              {Object.keys(CATEGORIES).map((catName) => (
                <button
                  type="button"
                  key={catName}
                  className={`chip ${selectedCategory === catName ? 'active' : ''}`}
                  onClick={() => setSelectedCategory(catName)}
                >
                  <span className="mr-1">{CATEGORIES[catName].icon}</span>
                  {catName}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="clear-btn"
              onClick={resetFilters}
            >
              Reset filters ↺
            </button>
          </div>

          {/* Month selector row */}
          <div className="family-row">
            <span className="family-label">Month range</span>
            <div className="family-pills">
              {['All', '2026-11', '2026-10', '2026-09'].map((m) => (
                <button
                  type="button"
                  key={m}
                  className={`family-pill ${selectedMonth === m ? 'active' : ''}`}
                  onClick={() => setSelectedMonth(m)}
                >
                  {m === 'All' ? (
                    'All time'
                  ) : (
                    <>
                      <span
                        className="family-dot"
                        style={{ background: m === '2026-11' ? '#bf493f' : '#6387a5' }}
                      />
                      {new Date(`${m}-01`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                    </>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* VIEW 1: EXPLORE / LEDGER VIEW */}
          <section className={`view-panel ${activeView === 'explore' ? 'active' : ''}`} id="exploreView">
            <div className="section-head">
              <div>
                <h2>
                  {selectedCategory === 'All' ? 'Recorded transactions' : `${selectedCategory} transactions`}
                </h2>
                <p>
                  {selectedMonth === 'All'
                    ? 'Showing all verified personal financial data'
                    : `Showing ledger items for ${new Date(`${selectedMonth}-01`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}`}
                </p>
              </div>
              <div className="result-count" aria-live="polite">
                {filteredTransactions.length} entries · {transactions.length} total
              </div>
            </div>

            {filteredTransactions.length > 0 ? (
              <div className="shade-grid">
                {filteredTransactions.map((tx, idx) => {
                  const cat = CATEGORIES[tx.category] || CATEGORIES['Other / Misc'];
                  const isCompared = comparingIds.has(tx.id);
                  const isExpense = tx.type === 'expense';
                  const isIncome = tx.type === 'income';

                  return (
                    <article key={tx.id} className="shade-card">
                      <div
                        className="shade-swatch"
                        style={{
                          background: `linear-gradient(135deg, ${cat.color}e6, ${cat.color}99)`,
                        }}
                      >
                        <span className="swatch-index">
                          {String(idx + 1).padStart(2, '0')} / {tx.category.toUpperCase()}
                        </span>
                        <button
                          className={`fav ${tx.isStarred ? 'saved' : ''}`}
                          type="button"
                          onClick={(e) => toggleStar(tx, e)}
                          aria-label={tx.isStarred ? 'Remove from starred' : 'Star transaction'}
                        >
                          {tx.isStarred ? '♥' : '♡'}
                        </button>
                      </div>

                      <div className="shade-info">
                        <div className="shade-name" title={tx.title}>
                          {tx.title}
                        </div>

                        <div className="shade-meta">
                          <span className="brand-label">
                            {cat.icon} {tx.account || 'Primary account'}
                          </span>
                          <span
                            className={`code font-bold ${
                              isIncome ? 'text-emerald-700 bg-emerald-50' : isExpense ? 'text-neutral-900' : 'text-blue-700 bg-blue-50'
                            }`}
                          >
                            {isIncome ? '+' : isExpense ? '-' : '•'}
                            {formatCurrency(tx.amount, currency)}
                          </span>
                        </div>

                        <div className="flex items-center justify-between mt-2 text-[10px] text-neutral-500">
                          <span>{formatDate(tx.date)}</span>
                          {tx.isRecurring && <span className="range-tag">Recurring</span>}
                        </div>

                        <div className="card-actions">
                          <button
                            className="mini-btn"
                            type="button"
                            onClick={() => {
                              setSelectedTransaction(tx);
                              setIsDetailModalOpen(true);
                            }}
                          >
                            View details
                          </button>
                          <button
                            className={`mini-btn ${isCompared ? 'primary' : ''}`}
                            type="button"
                            onClick={(e) => toggleCompare(tx.id, e)}
                          >
                            {isCompared ? '✓ Added' : '+ Compare'}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="empty">
                <div className="empty-icon">⌕</div>
                <strong>No matching transactions found</strong>
                <p>Try clearing your search query, or select another category or month.</p>
                <div className="mt-4">
                  <button
                    type="button"
                    className="coverage-action"
                    onClick={resetFilters}
                  >
                    Reset all filters
                  </button>
                </div>
              </div>
            )}

            <div className="note">
              <span aria-hidden="true">ⓘ</span>
              <div>
                <strong>About data persistence & security:</strong> All records are stored with full user isolation in
                Firebase Firestore. Google Sign-In with Firebase Auth validates requests against strict ABAC rules.
                Transactions can be exported, audited, and synthesized into automated monthly statements at any time.
              </div>
            </div>
          </section>

          {/* VIEW 2: SAVED & STARRED */}
          <section className={`view-panel ${activeView === 'saved' ? 'active' : ''}`} id="savedView">
            <div className="view-toolbar">
              <div>
                <h2>Starred & Audited Ledger</h2>
                <p>Transactions you flagged for tax deduction, warranty, or scrutiny.</p>
              </div>
              <div className="result-count">
                {transactions.filter((t) => t.isStarred).length} starred
              </div>
            </div>

            {transactions.filter((t) => t.isStarred).length > 0 ? (
              <div className="shade-grid">
                {transactions
                  .filter((t) => t.isStarred)
                  .map((tx, idx) => {
                    const cat = CATEGORIES[tx.category] || CATEGORIES['Other / Misc'];
                    return (
                      <article key={tx.id} className="shade-card">
                        <div
                          className="shade-swatch"
                          style={{
                            background: `linear-gradient(135deg, ${cat.color}e6, ${cat.color}99)`,
                          }}
                        >
                          <span className="swatch-index">
                            {String(idx + 1).padStart(2, '0')} / {tx.category.toUpperCase()}
                          </span>
                          <button
                            className="fav saved"
                            type="button"
                            onClick={(e) => toggleStar(tx, e)}
                          >
                            ♥
                          </button>
                        </div>
                        <div className="shade-info">
                          <div className="shade-name" title={tx.title}>
                            {tx.title}
                          </div>
                          <div className="shade-meta">
                            <span className="brand-label">{tx.account || 'Account'}</span>
                            <span className="code">{formatCurrency(tx.amount, currency)}</span>
                          </div>
                          <div className="flex items-center justify-between mt-2 text-[10px] text-neutral-500">
                            <span>{formatDate(tx.date)}</span>
                            {tx.tags && tx.tags.length > 0 && (
                              <span className="range-tag">#{tx.tags[0]}</span>
                            )}
                          </div>
                          <div className="card-actions">
                            <button
                              className="mini-btn"
                              type="button"
                              onClick={() => {
                                setSelectedTransaction(tx);
                                setIsDetailModalOpen(true);
                              }}
                            >
                              View details
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
              </div>
            ) : (
              <div className="empty">
                <div className="empty-icon">♡</div>
                <strong>Your starred ledger is empty</strong>
                <p>Tap the heart icon on any transaction to pin it here for tax or audit review.</p>
              </div>
            )}
          </section>

          {/* VIEW 3: COMPARE VIEW */}
          <section className={`view-panel ${activeView === 'compare' ? 'active' : ''}`} id="compareView">
            <div className="view-toolbar">
              <div>
                <h2>Compare Transactions & Periods</h2>
                <p>Evaluate multiple records side-by-side or compare monthly savings velocity.</p>
              </div>
              <button
                type="button"
                className="quiet-btn"
                onClick={() => {
                  setComparingIds(new Set());
                  showToast('Comparison cleared');
                }}
              >
                Clear all
              </button>
            </div>

            {comparingIds.size > 0 ? (
              <div className="compare-grid">
                {transactions
                  .filter((t) => comparingIds.has(t.id))
                  .map((tx) => {
                    const cat = CATEGORIES[tx.category] || CATEGORIES['Other / Misc'];
                    return (
                      <article key={tx.id} className="compare-card">
                        <div
                          className="compare-color flex items-center justify-center text-white font-bold text-lg"
                          style={{
                            background: `linear-gradient(135deg, ${cat.color}, ${cat.color}cc)`,
                          }}
                        >
                          {cat.icon} {formatCurrency(tx.amount, currency)}
                        </div>
                        <div className="compare-content">
                          <strong>{tx.title}</strong>
                          <small>
                            {tx.category} · {tx.account || 'Bank'}
                          </small>
                          <div className="text-[11px] text-neutral-500 mt-2">
                            Date: {formatDate(tx.date)} {tx.isRecurring ? '· Recurring' : ''}
                          </div>
                          {tx.notes && (
                            <p className="text-[10px] text-neutral-600 bg-neutral-50 p-2 rounded mt-2 border border-neutral-200">
                              {tx.notes}
                            </p>
                          )}
                          <div className="compare-meta">
                            <code>{tx.type.toUpperCase()}</code>
                            <button
                              type="button"
                              className="remove-link"
                              onClick={() => toggleCompare(tx.id)}
                            >
                              Remove ×
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
              </div>
            ) : (
              <div className="empty">
                <div className="empty-icon">◫</div>
                <strong>Nothing to compare yet</strong>
                <p>Click "+ Compare" on any transaction in the ledger to pin up to four records side by side.</p>
              </div>
            )}

            {/* Quick 3-Month Macro Comparison Table */}
            <div className="mt-8 border border-neutral-200 rounded-2xl p-6 bg-white">
              <h3 className="text-lg font-bold tracking-tight mb-2">Quarterly Velocity Overview (Q3–Q4 2026)</h3>
              <p className="text-xs text-neutral-500 mb-4">
                Comparison of calculated totals across recent calendar months.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { m: '2026-11', label: 'November 2026 (Current)' },
                  { m: '2026-10', label: 'October 2026' },
                  { m: '2026-09', label: 'September 2026' },
                ].map((item) => {
                  const mTx = transactions.filter((t) => t.date.startsWith(item.m));
                  const mIn = mTx.filter((t) => t.type === 'income').reduce((a, b) => a + b.amount, 0);
                  const mEx = mTx.filter((t) => t.type === 'expense').reduce((a, b) => a + b.amount, 0);
                  const mNet = mIn - mEx;
                  const mRate = mIn > 0 ? Math.round((mNet / mIn) * 100) : 0;

                  return (
                    <div key={item.m} className="border border-neutral-200 p-4 rounded-xl bg-neutral-50">
                      <div className="text-xs font-bold text-neutral-900">{item.label}</div>
                      <div className="mt-3 space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-neutral-500">Inflow:</span>
                          <span className="font-semibold">{formatCurrency(mIn, currency)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-neutral-500">Outflow:</span>
                          <span className="font-semibold text-rose-700">{formatCurrency(mEx, currency)}</span>
                        </div>
                        <div className="flex justify-between border-t border-neutral-200 pt-1 font-bold">
                          <span>Net Savings:</span>
                          <span className="text-emerald-700">{formatCurrency(mNet, currency)}</span>
                        </div>
                        <div className="text-[10px] text-neutral-500 text-right mt-1">
                          Savings Rate: <strong className="text-neutral-900">{mRate}%</strong>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="w-full mt-3 py-2 text-xs font-bold rounded-lg bg-neutral-900 text-white hover:bg-neutral-800 transition"
                        onClick={() => {
                          setReportMonth(item.m);
                          handleGenerateReport(item.m);
                        }}
                      >
                        Generate Statement ↗
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* VIEW 4: AUTOMATED MONTHLY REPORTS */}
          <section className={`view-panel ${activeView === 'reports' ? 'active' : ''}`} id="reportsView">
            <div className="catalogue-intro">
              <div>
                <h2>Automated Monthly Financial Statements</h2>
                <p>
                  Compile institutional-grade monthly reports synthesizing cash flow, budget anomalies,
                  macroeconomic market benchmarks (via Google Search Grounding), and AI reasoning audits (via Gemini
                  4 Carbon High Thinking).
                </p>
              </div>
              <div className="catalogue-symbol" aria-hidden="true">📊</div>
            </div>

            {/* Controls Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-[#f8f5ee] border border-neutral-200 rounded-xl mb-6">
              <div className="flex items-center gap-3">
                <label htmlFor="reportMonthSelect" className="text-xs font-bold text-neutral-700">
                  Select Statement Month:
                </label>
                <select
                  id="reportMonthSelect"
                  className="h-10 px-3 bg-white border border-neutral-300 rounded-lg text-xs font-semibold"
                  value={reportMonth}
                  onChange={(e) => setReportMonth(e.target.value)}
                >
                  <option value="2026-11">November 2026</option>
                  <option value="2026-10">October 2026</option>
                  <option value="2026-09">September 2026</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="px-4 py-2.5 text-xs font-extrabold rounded-lg bg-neutral-900 text-white hover:bg-neutral-800 transition flex items-center gap-2"
                  onClick={() => handleGenerateReport(reportMonth)}
                  disabled={isGeneratingReport}
                >
                  {isGeneratingReport ? (
                    <>
                      <span className="animate-spin inline-block">◌</span> Generating Deep Reasoning Report...
                    </>
                  ) : (
                    <>
                      <span>✦</span> Run Automated AI Monthly Report
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Rendered Monthly Report */}
            {activeReport ? (
              <div className="monthly-statement bg-white border border-neutral-300 rounded-2xl p-6 sm:p-8 shadow-sm">
                {/* Statement Header */}
                <div className="border-b border-neutral-200 pb-6 flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-[10px] tracking-widest uppercase font-black text-rose-600">
                      OFFICIAL MONTHLY STATEMENT & INTELLIGENCE REPORT
                    </div>
                    <h3 className="text-2xl sm:text-3xl font-black tracking-tight text-neutral-900 mt-1">
                      {activeReport.monthName} Financial Review
                    </h3>
                    <div className="text-xs text-neutral-500 mt-1">
                      Statement Ref: <span className="font-mono">{activeReport.id}</span> · Generated{' '}
                      {formatDate(activeReport.generatedAt)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 print:hidden">
                    <button
                      type="button"
                      className="px-3 py-2 text-xs font-bold bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-lg transition"
                      onClick={() => window.print()}
                    >
                      Print / PDF ⎙
                    </button>
                    <button
                      type="button"
                      className="px-3 py-2 text-xs font-bold bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg transition"
                      onClick={() => {
                        const headers = ['Category', 'Amount', 'Percentage'];
                        const rows = (activeReport.categoryBreakdown || []).map((c) => [c.category, c.amount, `${c.percentage}%`]);
                        downloadCsv(`kosh-monthly-report-${activeReport.monthYear}.csv`, headers, rows);
                        showToast('Statement CSV exported');
                      }}
                    >
                      Export CSV ↓
                    </button>
                  </div>
                </div>

                {/* KPI Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 my-6">
                  <div className="bg-[#fcfbf9] border border-neutral-200 p-4 rounded-xl">
                    <div className="text-[10px] text-neutral-500 uppercase tracking-wider font-bold">Total Inflow</div>
                    <div className="text-xl sm:text-2xl font-black text-neutral-900 mt-1">
                      {formatCurrency(activeReport.totalIncome, currency)}
                    </div>
                  </div>

                  <div className="bg-[#fcfbf9] border border-neutral-200 p-4 rounded-xl">
                    <div className="text-[10px] text-neutral-500 uppercase tracking-wider font-bold">Total Outflow</div>
                    <div className="text-xl sm:text-2xl font-black text-rose-600 mt-1">
                      {formatCurrency(activeReport.totalExpense, currency)}
                    </div>
                  </div>

                  <div className="bg-[#fcfbf9] border border-neutral-200 p-4 rounded-xl">
                    <div className="text-[10px] text-neutral-500 uppercase tracking-wider font-bold">Net Surplus</div>
                    <div className="text-xl sm:text-2xl font-black text-emerald-700 mt-1">
                      {formatCurrency(activeReport.netSavings, currency)}
                    </div>
                  </div>

                  <div className="bg-[#fcfbf9] border border-neutral-200 p-4 rounded-xl">
                    <div className="text-[10px] text-neutral-500 uppercase tracking-wider font-bold">Savings Rate</div>
                    <div className="text-xl sm:text-2xl font-black text-neutral-900 mt-1">
                      {activeReport.savingsRate}%
                    </div>
                  </div>
                </div>

                {/* Category Outflow Distribution */}
                <div className="my-6">
                  <h4 className="text-sm font-bold uppercase tracking-wider text-neutral-700 mb-3">
                    Category Spending Breakdown
                  </h4>
                  <div className="space-y-3">
                    {(activeReport.categoryBreakdown || []).map((cat) => {
                      const meta = CATEGORIES[cat.category] || CATEGORIES['Other / Misc'];
                      return (
                        <div key={cat.category} className="space-y-1">
                          <div className="flex justify-between text-xs font-semibold">
                            <span className="flex items-center gap-1.5">
                              <span>{meta.icon}</span> {cat.category}
                            </span>
                            <span className="font-mono">
                              {formatCurrency(cat.amount, currency)} ({cat.percentage}%)
                            </span>
                          </div>
                          <div className="h-2 w-full bg-neutral-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{ width: `${cat.percentage}%`, background: meta.color }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Deep High-Thinking Reasoning Audit */}
                {activeReport.aiThinkingAnalysis && (
                  <div className="my-6 p-6 rounded-2xl bg-[#242722] text-white border border-neutral-800">
                    <div className="flex items-center gap-2 text-rose-300 text-[10px] uppercase font-mono tracking-widest mb-3">
                      <span>✦</span> GEMINI 4 CARBON · HIGH THINKING REASONING AUDIT
                    </div>
                    <div className="text-xs sm:text-sm leading-relaxed space-y-3 text-neutral-200 whitespace-pre-line font-sans">
                      {activeReport.aiThinkingAnalysis}
                    </div>
                  </div>
                )}

                {/* Real-Time Google Search Grounded Benchmark Context */}
                {activeReport.marketSearchContext && (
                  <div className="my-6 p-5 rounded-xl bg-amber-50/70 border border-amber-200 text-neutral-800">
                    <div className="flex items-center gap-2 text-amber-900 text-[10px] font-bold uppercase tracking-widest mb-2">
                      <span>🌐</span> GOOGLE SEARCH GROUNDED MACROECONOMIC BENCHMARKS
                    </div>
                    <p className="text-xs text-neutral-700 leading-relaxed">
                      {activeReport.marketSearchContext}
                    </p>

                    {activeReport.citations && activeReport.citations.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-amber-200/60">
                        <span className="text-[10px] font-bold text-neutral-500 uppercase mr-2">
                          Grounding Citations:
                        </span>
                        <div className="inline-flex flex-wrap gap-2 mt-1">
                          {activeReport.citations.map((cite, i) => (
                            <a
                              key={i}
                              href={cite.uri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-amber-800 underline hover:text-amber-950 font-medium"
                            >
                              {cite.title || `Source [${i + 1}]`} ↗
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Footnote */}
                <div className="text-[10px] text-neutral-400 border-t border-neutral-200 pt-4 flex justify-between">
                  <span>Kosh Personal Finance Engine · Version 2026.11</span>
                  <span>End of Statement</span>
                </div>
              </div>
            ) : (
              <div className="border border-dashed border-neutral-300 rounded-2xl p-12 text-center bg-white">
                <div className="text-3xl mb-3">📄</div>
                <h3 className="text-base font-bold text-neutral-900">No report generated for this month yet</h3>
                <p className="text-xs text-neutral-500 max-w-md mx-auto mt-2">
                  Click "Run Automated AI Monthly Report" above to trigger Gemini 4 Carbon's thinking mode evaluation
                  and real-time Google search grounding for {reportMonth}.
                </p>
                <button
                  type="button"
                  className="mt-5 px-5 py-2.5 bg-neutral-900 text-white rounded-xl text-xs font-bold hover:bg-neutral-800 transition"
                  onClick={() => handleGenerateReport(reportMonth)}
                >
                  Generate {reportMonth} Report Now ↗
                </button>
              </div>
            )}
          </section>

          {/* VIEW 5: BUDGETS & GOALS */}
          <section className={`view-panel ${activeView === 'budgets' ? 'active' : ''}`} id="budgetsView">
            <div className="view-toolbar">
              <div>
                <h2>Category Budgets & Savings Goals</h2>
                <p>Enforce monthly spending thresholds and monitor financial milestones.</p>
              </div>
            </div>

            {/* Budgets Progress List */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
              {budgets.map((b) => {
                const catMeta = CATEGORIES[b.category] || CATEGORIES['Other / Misc'];
                const spent = transactions
                  .filter((t) => t.category === b.category && t.type === 'expense' && t.date.startsWith(b.monthYear))
                  .reduce((acc, t) => acc + t.amount, 0);
                const percent = Math.min(Math.round((spent / b.monthlyLimit) * 100), 100);
                const isOver = spent > b.monthlyLimit;

                return (
                  <div key={b.id} className="border border-neutral-200 bg-white p-5 rounded-2xl shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{catMeta.icon}</span>
                        <div>
                          <h4 className="text-xs font-bold text-neutral-900">{b.category}</h4>
                          <span className="text-[10px] text-neutral-400">Monthly cap for {b.monthYear}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-xs font-bold ${isOver ? 'text-rose-600' : 'text-neutral-900'}`}>
                          {formatCurrency(spent, currency)} / {formatCurrency(b.monthlyLimit, currency)}
                        </div>
                        <span className={`text-[10px] font-semibold ${isOver ? 'text-rose-600' : 'text-neutral-500'}`}>
                          {percent}% consumed
                        </span>
                      </div>
                    </div>

                    <div className="w-full bg-neutral-100 h-2.5 rounded-full overflow-hidden mt-3">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          isOver ? 'bg-rose-500' : percent > 80 ? 'bg-amber-500' : 'bg-emerald-600'
                        }`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>

                    <div className="flex justify-between items-center text-[10px] text-neutral-400 mt-2">
                      <span>{isOver ? 'Over budget by ' + formatCurrency(spent - b.monthlyLimit, currency) : 'Remaining: ' + formatCurrency(b.monthlyLimit - spent, currency)}</span>
                      <span>Target: {b.monthYear}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Financial Goals / Milestones */}
            <div className="border-t border-neutral-200 pt-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold tracking-tight">Active Financial Milestones</h3>
                  <p className="text-xs text-neutral-500">Track target capital funds and celebrate completed milestones.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {goals.map((goal) => {
                  const progress = Math.min(Math.round((goal.currentAmount / goal.targetAmount) * 100), 100);
                  const isDone = goal.currentAmount >= goal.targetAmount;

                  return (
                    <div
                      key={goal.id}
                      className="border border-neutral-200 bg-white p-5 rounded-2xl flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex justify-between items-start">
                          <span className="text-xs uppercase font-bold text-neutral-400 tracking-wider">
                            {goal.category || 'Goal'}
                          </span>
                          {isDone && (
                            <span className="bg-emerald-100 text-emerald-800 text-[9px] px-2 py-0.5 rounded-full font-bold">
                              ✓ Completed
                            </span>
                          )}
                        </div>
                        <h4 className="text-sm font-bold text-neutral-900 mt-1">{goal.title}</h4>
                        <div className="text-lg font-black text-neutral-900 mt-3">
                          {formatCurrency(goal.currentAmount, currency)}{' '}
                          <span className="text-xs text-neutral-400 font-normal">
                            of {formatCurrency(goal.targetAmount, currency)}
                          </span>
                        </div>
                      </div>

                      <div className="mt-4">
                        <div className="w-full bg-neutral-100 h-2 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-neutral-900 rounded-full"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[10px] text-neutral-400 mt-1">
                          <span>{progress}% funded</span>
                          {goal.targetDate && <span>Due {goal.targetDate}</span>}
                        </div>
                        {isDone && (
                          <button
                            type="button"
                            className="w-full mt-3 py-1.5 text-[10px] font-bold rounded bg-emerald-50 text-emerald-800 hover:bg-emerald-100 transition"
                            onClick={() => {
                              confetti({ particleCount: 70, spread: 80, origin: { y: 0.7 } });
                              showToast(`Milestone achieved: ${goal.title}!`);
                            }}
                          >
                            Celebrate Milestone 🎉
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        </section>
      </main>

      {/* Floating Bottom Navigation Pill */}
      <nav className="bottom-nav" aria-label="Main navigation">
        <button
          type="button"
          className={`nav-btn ${activeView === 'explore' ? 'active' : ''}`}
          onClick={() => {
            setActiveView('explore');
            scrollToWorkspace();
          }}
        >
          <span className="nav-icon">▦</span> Ledger
        </button>

        <button
          type="button"
          className={`nav-btn ${activeView === 'saved' ? 'active' : ''}`}
          onClick={() => {
            setActiveView('saved');
            scrollToWorkspace();
          }}
        >
          <span className="nav-icon">♡</span> Starred{' '}
          {transactions.filter((t) => t.isStarred).length > 0 && (
            <span className="nav-count">({transactions.filter((t) => t.isStarred).length})</span>
          )}
        </button>

        <button
          type="button"
          className={`nav-btn ${activeView === 'compare' ? 'active' : ''}`}
          onClick={() => {
            setActiveView('compare');
            scrollToWorkspace();
          }}
        >
          <span className="nav-icon">◫</span> Compare{' '}
          {comparingIds.size > 0 && <span className="nav-count">({comparingIds.size})</span>}
        </button>

        <button
          type="button"
          className={`nav-btn ${activeView === 'reports' ? 'active' : ''}`}
          onClick={() => {
            setActiveView('reports');
            scrollToWorkspace();
          }}
        >
          <span className="nav-icon">📊</span> Reports
        </button>

        <button
          type="button"
          className={`nav-btn ${activeView === 'budgets' ? 'active' : ''}`}
          onClick={() => {
            setActiveView('budgets');
            scrollToWorkspace();
          }}
        >
          <span className="nav-icon">🎯</span> Budgets
        </button>
      </nav>

      {/* Floating Compare Drawer trigger if items selected */}
      {comparingIds.size > 0 && activeView === 'explore' && (
        <button
          type="button"
          className="compare-float"
          onClick={() => {
            setActiveView('compare');
            scrollToWorkspace();
          }}
        >
          Compare selected · {comparingIds.size}
        </button>
      )}

      {/* Transaction Details Modal */}
      {isDetailModalOpen && selectedTransaction && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsDetailModalOpen(false);
          }}
        >
          <div className="modal">
            <div
              className="modal-visual"
              style={{
                background: `linear-gradient(135deg, ${(CATEGORIES[selectedTransaction.category] || CATEGORIES['Other / Misc']).color}, #20221f)`,
              }}
            >
              <button
                type="button"
                className="modal-close"
                onClick={() => setIsDetailModalOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
              <div className="z-10 text-white">
                <span className="text-[10px] tracking-widest uppercase font-mono bg-white/20 px-2 py-0.5 rounded">
                  {selectedTransaction.type.toUpperCase()}
                </span>
                <div className="text-3xl font-black mt-2">
                  {formatCurrency(selectedTransaction.amount, currency)}
                </div>
              </div>
            </div>

            <div className="modal-body">
              <div className="modal-kicker">Transaction details</div>
              <h3>{selectedTransaction.title}</h3>
              <div className="modal-sub">
                {selectedTransaction.category} · {formatDate(selectedTransaction.date)}
              </div>

              <div className="detail-grid">
                <div className="detail-cell">
                  <small>ACCOUNT</small>
                  <strong>{selectedTransaction.account || 'HDFC Primary'}</strong>
                </div>
                <div className="detail-cell">
                  <small>CATEGORY</small>
                  <strong>{selectedTransaction.category}</strong>
                </div>
                <div className="detail-cell">
                  <small>DATE</small>
                  <strong>{selectedTransaction.date}</strong>
                </div>
                <div className="detail-cell">
                  <small>RECURRING</small>
                  <strong>{selectedTransaction.isRecurring ? 'Yes · Monthly' : 'One-time'}</strong>
                </div>
              </div>

              {selectedTransaction.notes && (
                <div className="p-3 bg-neutral-50 rounded-xl text-xs text-neutral-700 mb-4 border border-neutral-200">
                  <strong className="block text-[10px] text-neutral-400 uppercase mb-1">Notes</strong>
                  {selectedTransaction.notes}
                </div>
              )}

              {selectedTransaction.tags && selectedTransaction.tags.length > 0 && (
                <div className="flex gap-1.5 flex-wrap mb-4">
                  {selectedTransaction.tags.map((t) => (
                    <span key={t} className="text-[10px] bg-neutral-100 text-neutral-700 px-2.5 py-1 rounded-full font-medium">
                      #{t}
                    </span>
                  ))}
                </div>
              )}

              <div className="modal-actions">
                <button
                  type="button"
                  className="action-btn"
                  onClick={() => {
                    toggleCompare(selectedTransaction.id);
                  }}
                >
                  {comparingIds.has(selectedTransaction.id) ? 'Remove compare' : 'Add to compare'}
                </button>
                <button
                  type="button"
                  className="action-btn accent"
                  onClick={() => toggleStar(selectedTransaction)}
                >
                  {selectedTransaction.isStarred ? '♥ Starred' : '♡ Star transaction'}
                </button>
                <button
                  type="button"
                  className="action-btn"
                  onClick={() => {
                    setEditingTransaction(selectedTransaction);
                    setIsDetailModalOpen(false);
                    setIsAddModalOpen(true);
                  }}
                >
                  Edit transaction
                </button>
                <button
                  type="button"
                  className="action-btn text-rose-600 hover:bg-rose-50"
                  onClick={() => handleDeleteTransaction(selectedTransaction.id)}
                >
                  Delete
                </button>
              </div>

              <p className="modal-footnote">
                Securely recorded with zero-trust Firestore integrity. Changes sync in real-time across devices.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Transaction Modal */}
      {isAddModalOpen && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsAddModalOpen(false);
          }}
        >
          <div className="modal max-w-lg">
            <div className="p-6 border-b border-neutral-200 flex justify-between items-center">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-rose-600">
                  {editingTransaction ? 'Edit ledger record' : 'New entry'}
                </span>
                <h3 className="text-xl font-black text-neutral-900 mt-0.5">
                  {editingTransaction ? 'Update Transaction' : 'Record Transaction'}
                </h3>
              </div>
              <button
                type="button"
                className="modal-close static"
                onClick={() => setIsAddModalOpen(false)}
              >
                ×
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const title = (form.elements.namedItem('title') as HTMLInputElement).value;
                const amount = parseFloat((form.elements.namedItem('amount') as HTMLInputElement).value);
                const type = (form.elements.namedItem('type') as HTMLSelectElement).value as any;
                const category = (form.elements.namedItem('category') as HTMLSelectElement).value;
                const date = (form.elements.namedItem('date') as HTMLInputElement).value;
                const account = (form.elements.namedItem('account') as HTMLInputElement).value;
                const notes = (form.elements.namedItem('notes') as HTMLTextAreaElement).value;
                const isRecurring = (form.elements.namedItem('isRecurring') as HTMLInputElement).checked;

                handleSaveTransaction({ title, amount, type, category, date, account, notes, isRecurring });
              }}
              className="p-6 space-y-4"
            >
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  Title / Merchant *
                </label>
                <input
                  name="title"
                  required
                  defaultValue={editingTransaction?.title || ''}
                  placeholder="e.g. Blinkit Groceries, Monthly Rent, Freelance Client"
                  className="w-full h-11 px-3 text-xs border border-neutral-300 rounded-xl focus:border-neutral-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    Amount ({currency}) *
                  </label>
                  <input
                    name="amount"
                    type="number"
                    step="0.01"
                    required
                    defaultValue={editingTransaction?.amount || ''}
                    placeholder="0.00"
                    className="w-full h-11 px-3 text-xs border border-neutral-300 rounded-xl focus:border-neutral-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    Type *
                  </label>
                  <select
                    name="type"
                    defaultValue={editingTransaction?.type || 'expense'}
                    className="w-full h-11 px-3 text-xs border border-neutral-300 rounded-xl focus:border-neutral-900 bg-white"
                  >
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                    <option value="investment">Investment</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    Category *
                  </label>
                  <select
                    name="category"
                    defaultValue={editingTransaction?.category || 'Food & Dining'}
                    className="w-full h-11 px-3 text-xs border border-neutral-300 rounded-xl focus:border-neutral-900 bg-white"
                  >
                    {Object.keys(CATEGORIES).map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    Date *
                  </label>
                  <input
                    name="date"
                    type="date"
                    required
                    defaultValue={editingTransaction?.date || new Date().toISOString().slice(0, 10)}
                    className="w-full h-11 px-3 text-xs border border-neutral-300 rounded-xl focus:border-neutral-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  Account / Payment Method
                </label>
                <input
                  name="account"
                  defaultValue={editingTransaction?.account || 'HDFC Salary Account'}
                  placeholder="e.g. HDFC Salary Account, ICICI Card, UPI, Cash"
                  className="w-full h-11 px-3 text-xs border border-neutral-300 rounded-xl focus:border-neutral-900"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  Notes & Details
                </label>
                <textarea
                  name="notes"
                  rows={2}
                  defaultValue={editingTransaction?.notes || ''}
                  placeholder="Optional details, invoice number, or breakdown"
                  className="w-full p-3 text-xs border border-neutral-300 rounded-xl focus:border-neutral-900"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="isRecurring"
                  name="isRecurring"
                  defaultChecked={editingTransaction?.isRecurring}
                  className="h-4 w-4 rounded text-neutral-900"
                />
                <label htmlFor="isRecurring" className="text-xs text-neutral-700">
                  This is a recurring monthly bill or subscription
                </label>
              </div>

              <div className="flex gap-2 pt-4 border-t border-neutral-200">
                <button
                  type="button"
                  className="flex-1 py-3 text-xs font-bold border border-neutral-300 rounded-xl hover:bg-neutral-50"
                  onClick={() => setIsAddModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 text-xs font-bold bg-neutral-900 text-white rounded-xl hover:bg-neutral-800 transition"
                >
                  {editingTransaction ? 'Save Changes' : 'Save Transaction'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AI Financial Advisor Drawer */}
      {isAdvisorOpen && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsAdvisorOpen(false);
          }}
        >
          <div className="modal max-w-xl flex flex-col h-[680px]">
            <div className="p-5 border-b border-neutral-200 flex justify-between items-center bg-[#242722] text-white rounded-t-2xl">
              <div>
                <div className="text-[9px] font-mono tracking-widest text-rose-300 uppercase">
                  HIGH THINKING FINANCIAL INTELLIGENCE
                </div>
                <h3 className="text-xl font-bold mt-0.5">Kosh Financial Advisor</h3>
              </div>
              <button
                type="button"
                className="modal-close static"
                onClick={() => setIsAdvisorOpen(false)}
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-neutral-50/50">
              {advisorMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] p-3.5 rounded-2xl text-xs leading-relaxed whitespace-pre-line ${
                      msg.role === 'user'
                        ? 'bg-neutral-900 text-white rounded-tr-none'
                        : 'bg-white border border-neutral-200 text-neutral-800 shadow-sm rounded-tl-none'
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
              {advisorLoading && (
                <div className="flex justify-start">
                  <div className="p-3 bg-white border border-neutral-200 text-xs text-neutral-500 rounded-2xl rounded-tl-none flex items-center gap-2">
                    <span className="animate-spin inline-block">◌</span> Thinking deeply with Gemini 4 Carbon...
                  </div>
                </div>
              )}
            </div>

            {/* Quick Prompt Suggestions */}
            <div className="px-4 py-2 border-t border-neutral-200 bg-white flex gap-2 overflow-x-auto">
              {[
                'Can I afford a ₹65,000 laptop?',
                'How to save ₹15,000 more next month?',
                'Audit my recurring subscriptions',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="text-[10px] bg-neutral-100 hover:bg-neutral-200 px-2.5 py-1 rounded-full text-neutral-700 whitespace-nowrap font-medium"
                  onClick={() => setAdvisorInput(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>

            <form onSubmit={handleSendAdvisorQuery} className="p-4 bg-white border-t border-neutral-200 flex gap-2">
              <input
                value={advisorInput}
                onChange={(e) => setAdvisorInput(e.target.value)}
                placeholder="Ask about affordability, tax tips, emergency fund..."
                className="flex-1 h-11 px-3 text-xs border border-neutral-300 rounded-xl focus:border-neutral-900"
              />
              <button
                type="submit"
                disabled={advisorLoading || !advisorInput.trim()}
                className="px-4 h-11 bg-neutral-900 text-white rounded-xl text-xs font-bold hover:bg-neutral-800 disabled:opacity-50"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      <div className={`toast ${toastMessage ? 'show' : ''}`} role="status" aria-live="polite">
        {toastMessage}
      </div>
    </div>
  );
}
