export type StockQuote = {
  symbol: string;
  price: string;
  high: string;
  low: string;
  open: string;
  prevClose: string;
};

const ALPHA_VANTAGE_BASE = 'https://www.alphavantage.co/query';

const getAlphaVantageKey = (): string => (process.env.ALPHA_VANTAGE_KEY || '').trim();

const buildUrl = (params: Record<string, string>) => {
  const u = new URL(ALPHA_VANTAGE_BASE);
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, v);
  }
  return u.toString();
};

export const isStockFeatureEnabled = (): boolean => Boolean(getAlphaVantageKey());

export async function fetchStockQuote(symbol: string): Promise<StockQuote | null> {
  const key = getAlphaVantageKey();
  if (!key) {
    return null;
  }

  const url = buildUrl({ function: 'GLOBAL_QUOTE', symbol, apikey: key });
  const res = await fetch(url);
  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as Record<string, any>;
  const q = (data['Global Quote'] || {}) as Record<string, string>;
  if (!q['05. price']) {
    return null;
  }

  return {
    symbol,
    price: q['05. price'] || '-',
    high: q['03. high'] || '-',
    low: q['04. low'] || '-',
    open: q['02. open'] || '-',
    prevClose: q['08. previous close'] || '-',
  };
}

export async function fetchStockChartImageUrl(symbol: string): Promise<string | null> {
  const key = getAlphaVantageKey();
  if (!key) {
    return null;
  }

  const url = buildUrl({ function: 'TIME_SERIES_DAILY', symbol, apikey: key });
  const res = await fetch(url);
  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as Record<string, any>;
  const series = (data['Time Series (Daily)'] || {}) as Record<string, Record<string, string>>;
  const dates = Object.keys(series).sort();
  if (dates.length === 0) {
    return null;
  }

  const last = dates.slice(-30);
  const labels = last;
  const values = last.map((d) => Number(series[d]?.['4. close'] || Number.NaN));
  if (values.some((v) => !Number.isFinite(v))) {
    return null;
  }

  const chartConfig = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: `${symbol} close`,
          data: values,
          borderColor: '#2ecc71',
          backgroundColor: 'rgba(46,204,113,0.2)',
          fill: true,
          tension: 0.2,
        },
      ],
    },
    options: {
      plugins: { legend: { display: true } },
      scales: { x: { display: true }, y: { display: true } },
    },
  };

  const quickChart = new URL('https://quickchart.io/chart');
  quickChart.searchParams.set('c', JSON.stringify(chartConfig));
  quickChart.searchParams.set('width', '900');
  quickChart.searchParams.set('height', '420');
  quickChart.searchParams.set('format', 'png');
  return quickChart.toString();
}
