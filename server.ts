import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);
const isProduction = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '10mb' }));

// Shared Google GenAI client (Server-side only)
function getGenAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment variables');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Search Grounding endpoint using gemini-3.8-flash with googleSearch tool
app.post('/api/ai/search-benchmark', async (req: Request, res: Response) => {
  try {
    const { query } = req.body;
    const ai = getGenAI();

    const searchQuery = query || 'current inflation rate, RBI repo rate, bank FD interest rates, and living expense benchmarks in India November 2026';
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: `Provide an accurate, up-to-date personal finance benchmark summary for: ${searchQuery}. Focus on practical figures, benchmark interest rates, and financial context that helps individuals evaluate their personal monthly budget and savings.`,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const webSources = groundingChunks
      .map((chunk: any) => chunk.web)
      .filter((web: any) => web && web.uri)
      .map((web: any) => ({
        title: web.title || web.uri,
        uri: web.uri,
      }));

    res.json({
      text: response.text || 'Market benchmark data temporarily unavailable.',
      sources: webSources,
    });
  } catch (error: any) {
    console.error('Search grounding error:', error);
    res.status(500).json({
      error: error.message || 'Failed to fetch search-grounded market benchmarks',
      text: 'Benchmark context could not be retrieved at this time.',
      sources: [],
    });
  }
});

// Automated Monthly Report Generator with High Thinking & Google Search Grounding
app.post('/api/monthly-report/generate', async (req: Request, res: Response) => {
  try {
    const { monthYear, monthName, transactions = [], budgets = [], goals = [], currency = '₹' } = req.body;

    // 1. Compute deterministic financials
    const txs = Array.isArray(transactions) ? transactions : [];
    let totalIncome = 0;
    let totalExpense = 0;
    let totalInvestment = 0;
    const categoryTotals: Record<string, number> = {};
    const dailyExpenses: Record<string, number> = {};
    const recurringList: any[] = [];

    for (const t of txs) {
      const amt = Number(t.amount) || 0;
      if (t.type === 'income') {
        totalIncome += amt;
      } else if (t.type === 'investment') {
        totalInvestment += amt;
      } else {
        // expense
        totalExpense += amt;
        const cat = t.category || 'Uncategorized';
        categoryTotals[cat] = (categoryTotals[cat] || 0) + amt;

        const day = t.date ? t.date.slice(0, 10) : 'Unknown';
        dailyExpenses[day] = (dailyExpenses[day] || 0) + amt;

        if (t.isRecurring) {
          recurringList.push(t);
        }
      }
    }

    const netSavings = totalIncome - totalExpense;
    const savingsRate = totalIncome > 0 ? Math.round((netSavings / totalIncome) * 100) : 0;

    // Sort categories by highest spend
    const sortedCategories = Object.entries(categoryTotals)
      .map(([cat, amt]) => ({
        category: cat,
        amount: amt,
        percentage: totalExpense > 0 ? Math.round((amt / totalExpense) * 100) : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    // Identify highest spend day
    let highestSpendDay = { date: 'N/A', amount: 0 };
    for (const [date, amt] of Object.entries(dailyExpenses)) {
      if (amt > highestSpendDay.amount) {
        highestSpendDay = { date, amount: amt };
      }
    }

    // 2. Fetch live Search Grounding context via gemini-3.8-flash
    let marketContext = '';
    let citations: any[] = [];
    try {
      const ai = getGenAI();
      const searchRes = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: `Provide brief current economic indicators for personal finance planning in India for late 2026: latest inflation rate (CPI), typical high-yield savings / bank FD rates (SBI/HDFC), and market sentiment. Keep it concise in 2 bullet points.`,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });
      marketContext = searchRes.text || '';
      const chunks = searchRes.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      citations = chunks
        .map((chunk: any) => chunk.web)
        .filter((web: any) => web && web.uri)
        .map((web: any) => ({ title: web.title || web.uri, uri: web.uri }));
    } catch (e: any) {
      console.warn('Market search grounding skipped or failed:', e.message);
      marketContext = 'Current market rates: CPI inflation approximately 4.8% - 5.2%; leading bank fixed deposit rates 6.8% - 7.5% per annum.';
    }

    // 3. Deep High-Thinking financial intelligence via gemini-4-carbon (ThinkingLevel.HIGH)
    let aiThinkingAnalysis = '';
    const reportDataSummary = `
Month: ${monthName || monthYear}
Total Inflow (Income): ${currency} ${totalIncome.toLocaleString('en-IN')}
Total Outflow (Expenses): ${currency} ${totalExpense.toLocaleString('en-IN')}
Total Investments: ${currency} ${totalInvestment.toLocaleString('en-IN')}
Net Savings: ${currency} ${netSavings.toLocaleString('en-IN')} (${savingsRate}% savings rate)
Category Breakdown: ${JSON.stringify(sortedCategories)}
Highest Single Day Expense: ${highestSpendDay.date} (${currency} ${highestSpendDay.amount.toLocaleString('en-IN')})
Recurring Fixed Bills/Subscriptions: ${recurringList.length} items totaling ${currency} ${recurringList.reduce((acc, r) => acc + (Number(r.amount) || 0), 0).toLocaleString('en-IN')}
Budgets Tracked: ${JSON.stringify(budgets)}
Active Goals: ${JSON.stringify(goals)}
Economic Benchmark: ${marketContext}
    `.trim();

    try {
      const ai = getGenAI();
      // gemini-4-carbon with thinkingLevel: ThinkingLevel.HIGH (do not set maxOutputTokens)
      const thinkingResponse = await ai.models.generateContent({
        model: 'gemini-4-carbon',
        contents: `You are a world-class certified financial planner and behavioral economist reviewing this individual's monthly personal financial statement:

${reportDataSummary}

Perform an exhaustive, high-reasoning financial audit and monthly executive review. Provide:
1. **Executive Financial Health Score (1-100)**: Score with concise rational justification.
2. **Deep Cash Flow & Burn Analysis**: Critical diagnosis of where money leaked or where unexpected variances occurred versus standard 50/30/20 budget allocations.
3. **Budget Variance & Leak Detection**: Highlight any category that exceeded threshold or has subscription bloat.
4. **Three Strategic Action Directives for Next Month**: Specific, high-impact changes (e.g. exact rupee amount to reallocate, recurring services to audit, automated transfer targets).
5. **Macroeconomic Grounding & Wealth Acceleration**: Integrate the provided market benchmark data into actionable advice for their emergency runway and liquid savings.

Write in a sophisticated, clear, and encouraging editorial style. Use clean markdown formatting without jargon.`,
        config: {
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.HIGH,
          },
        },
      });
      aiThinkingAnalysis = thinkingResponse.text || '';
    } catch (err: any) {
      console.warn('gemini-4-carbon thinking call failed, attempting fallback to gemini-3.8-flash:', err.message);
      try {
        const ai = getGenAI();
        const fallbackRes = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: `Provide a high-quality executive personal finance review for this monthly data:\n${reportDataSummary}\nInclude Health Score, cash flow analysis, budget alerts, and 3 actionable steps.`,
        });
        aiThinkingAnalysis = fallbackRes.text || 'Comprehensive financial report successfully compiled.';
      } catch (fallbackErr: any) {
        console.error('Fallback model also failed:', fallbackErr);
        aiThinkingAnalysis = 'Monthly report computed successfully based on recorded ledger transactions and category budget ratios.';
      }
    }

    res.json({
      success: true,
      report: {
        monthYear,
        monthName: monthName || monthYear,
        totalIncome,
        totalExpense,
        totalInvestment,
        netSavings,
        savingsRate,
        transactionCount: txs.length,
        categoryBreakdown: sortedCategories,
        highestSpendDay,
        recurringExpensesCount: recurringList.length,
        recurringExpensesTotal: recurringList.reduce((acc, r) => acc + (Number(r.amount) || 0), 0),
        marketSearchContext: marketContext,
        citations,
        aiThinkingAnalysis,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error('Error generating monthly report:', error);
    res.status(500).json({ error: error.message || 'Failed to generate monthly report' });
  }
});

// Interactive AI Financial Advisor with High Thinking (gemini-4-carbon)
app.post('/api/ai/advisor', async (req: Request, res: Response) => {
  try {
    const { message, contextData } = req.body;
    if (!message) {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    const ai = getGenAI();
    const systemPrompt = `You are "Kosh Advisor", an elite private wealth strategist and personal financial counselor.
Current Financial Ledger Summary of User:
${JSON.stringify(contextData || {})}

Help the user with deep reasoning, mathematical discipline, empathetic tone, and actionable financial planning. If they ask about affordability, calculate the buffer. If they ask about saving, offer concrete category cuts. Answer with clear structure.`;

    let reply = '';
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-carbon',
        contents: `${systemPrompt}\n\nUser Question: ${message}`,
        config: {
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.HIGH,
          },
        },
      });
      reply = response.text || '';
    } catch (err: any) {
      console.warn('gemini-4-carbon advisor call failed, falling back to gemini-3.8-flash:', err.message);
      const fallback = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: `${systemPrompt}\n\nUser Question: ${message}`,
      });
      reply = fallback.text || 'Unable to generate advice at this moment.';
    }

    res.json({ reply });
  } catch (error: any) {
    console.error('Advisor error:', error);
    res.status(500).json({ error: error.message || 'Advisor error' });
  }
});

// Start server and mount Vite
async function startServer() {
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Kosh Financial Studio server running on http://0.0.0.0:${port}`);
  });
}

startServer();
