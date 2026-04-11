export const buildPhaseResultKey = (phase: string, phaseExecutionIndex: number): string => {
  const safeIndex = Number.isFinite(phaseExecutionIndex) && phaseExecutionIndex >= 0
    ? Math.floor(phaseExecutionIndex)
    : 0;
  return `${phase}-${safeIndex}`;
};