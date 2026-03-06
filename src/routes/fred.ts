import { Router } from 'express';
import { isOneOf, toStringParam } from '../utils/validation';

type FredRange = '1Y' | '3Y' | '5Y' | '10Y';

type CatalogItem = {
  id: string;
  label: string;
  unit: string;
  category: string;
};

const RANGE_TO_MONTHS: Record<FredRange, number> = {
  '1Y': 12,
  '3Y': 36,
  '5Y': 60,
  '10Y': 120,
};

const CATALOG: Record<string, CatalogItem> = {
  UNRATE: { id: 'UNRATE', label: 'Unemployment Rate', unit: '%', category: 'Labor' },
  CPIAUCSL: { id: 'CPIAUCSL', label: 'Consumer Price Index', unit: 'Index', category: 'Inflation' },
  FEDFUNDS: { id: 'FEDFUNDS', label: 'Federal Funds Rate', unit: '%', category: 'Rates' },
  GDPC1: { id: 'GDPC1', label: 'Real GDP', unit: 'Billions $', category: 'Growth' },
  DGS10: { id: 'DGS10', label: '10Y Treasury Yield', unit: '%', category: 'Rates' },
  T10Y2Y: { id: 'T10Y2Y', label: '10Y-2Y Treasury Spread', unit: '%', category: 'Rates' },
  PCE: { id: 'PCE', label: 'Personal Consumption Expenditures', unit: 'Billions $', category: 'Spending' },
  M2SL: { id: 'M2SL', label: 'M2 Money Stock', unit: 'Billions $', category: 'Liquidity' },
};

const BASE_VALUES: Record<string, number> = {
  UNRATE: 4.2,
  CPIAUCSL: 309,
  FEDFUNDS: 4.75,
  GDPC1: 23000,
  DGS10: 4.0,
  T10Y2Y: -0.25,
  PCE: 19750,
  M2SL: 20900,
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const sanitizeSeriesId = (raw: string) => raw.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');

const buildCatalogItem = (id: string): CatalogItem => {
  if (CATALOG[id]) {
    return CATALOG[id];
  }

  return {
    id,
    label: id,
    unit: 'Index',
    category: 'Custom',
  };
};

const seriesDrift = (id: string) => {
  const hash = [...id].reduce((acc, ch, index) => acc + ch.charCodeAt(0) * (index + 1), 0);
  const drift = ((hash % 17) - 8) / 300;
  return clamp(drift, -0.06, 0.06);
};

const seriesVolatility = (id: string) => {
  const hash = [...id].reduce((acc, ch, index) => acc + ch.charCodeAt(0) * (index + 3), 0);
  return 0.004 + (hash % 9) * 0.001;
};

const formatMonth = (date: Date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

const generateSeriesPoints = (id: string, months: number) => {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  start.setUTCMonth(start.getUTCMonth() - (months - 1));

  const base = BASE_VALUES[id] ?? 100;
  const drift = seriesDrift(id);
  const volatility = seriesVolatility(id);

  const points: Array<{ date: string; value: number }> = [];
  for (let i = 0; i < months; i += 1) {
    const pointDate = new Date(start);
    pointDate.setUTCMonth(start.getUTCMonth() + i);

    const trend = 1 + drift * (i / Math.max(1, months - 1));
    const seasonal = Math.sin((i / 6) * Math.PI) * volatility;
    const value = base * (trend + seasonal);

    points.push({
      date: formatMonth(pointDate),
      value: Number(value.toFixed(3)),
    });
  }

  return points;
};

export function createFredRouter(): Router {
  const router = Router();

  router.get('/playground', (req, res) => {
    const rawIds = toStringParam(req.query.ids);
    const rawRange = toStringParam(req.query.range).toUpperCase();

    if (!rawIds || !rawRange) {
      return res.status(422).json({ error: 'INVALID_PAYLOAD', message: 'ids and range are required' });
    }

    if (!isOneOf(rawRange, ['1Y', '3Y', '5Y', '10Y'] as const)) {
      return res.status(422).json({ error: 'INVALID_PAYLOAD', message: 'range must be one of 1Y, 3Y, 5Y, 10Y' });
    }

    const ids = rawIds
      .split(',')
      .map(sanitizeSeriesId)
      .filter(Boolean)
      .slice(0, 5);

    if (!ids.length) {
      return res.status(422).json({ error: 'INVALID_PAYLOAD', message: 'at least one valid id is required' });
    }

    const months = RANGE_TO_MONTHS[rawRange as FredRange];
    const catalog = ids.map(buildCatalogItem);
    const series = ids.map((id) => {
      const meta = buildCatalogItem(id);
      return {
        id,
        label: meta.label,
        unit: meta.unit,
        points: generateSeriesPoints(id, months),
      };
    });

    return res.json({
      source: 'backend',
      catalog,
      series,
    });
  });

  return router;
}
