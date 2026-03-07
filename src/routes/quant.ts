import { Router } from 'express';

type QuantMetricId = 'position' | 'winRate' | 'cvd';
type QuantTrend = 'up' | 'down' | 'flat';

type QuantPanelMetric = {
  id: QuantMetricId;
  label: string;
  value: number;
  unit: string;
  change: number;
  trend: QuantTrend;
  updatedAt: string;
};

const buildMetric = (
  id: QuantMetricId,
  label: string,
  unit: string,
  baseValue: number,
  driftSeed: number,
): QuantPanelMetric => {
  const minuteBucket = Math.floor(Date.now() / 60000);
  const wave = Math.sin((minuteBucket + driftSeed) / 7);
  const drift = Number((wave * 2.4).toFixed(2));
  const value = Number((baseValue + drift).toFixed(2));

  return {
    id,
    label,
    value,
    unit,
    change: Number((drift / 3).toFixed(2)),
    trend: drift > 0.2 ? 'up' : drift < -0.2 ? 'down' : 'flat',
    updatedAt: new Date().toISOString(),
  };
};

const buildQuantSnapshot = () => {
  return {
    source: 'backend' as const,
    metrics: [
      buildMetric('position', 'Current Exposure', '%', 34, 2),
      buildMetric('winRate', 'Execution Quality', '%', 57, 5),
      buildMetric('cvd', 'Order Flow Delta', 'pts', 12, 9),
    ],
  };
};

export function createQuantRouter(): Router {
  const router = Router();

  router.get('/panel', (_req, res) => {
    return res.json(buildQuantSnapshot());
  });

  return router;
}

export default createQuantRouter;
