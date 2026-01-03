import { registerAs } from "@nestjs/config";

export interface CoverageConfig {
  summaryPath: string;
  minStatements: number;
  minBranches: number;
  minFunctions: number;
  minLines: number;
}

const DEFAULT_SUMMARY = "coverage/coverage-summary.json";

export default registerAs("coverage", (): CoverageConfig => {
  const asNumber = (value: string | undefined, fallback: number) => {
    const parsed = value !== undefined ? Number(value) : NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return {
    summaryPath: process.env.COVERAGE_SUMMARY_PATH || DEFAULT_SUMMARY,
    minStatements: asNumber(process.env.COVERAGE_MIN_STATEMENTS, 0),
    minBranches: asNumber(process.env.COVERAGE_MIN_BRANCHES, 0),
    minFunctions: asNumber(process.env.COVERAGE_MIN_FUNCTIONS, 0),
    minLines: asNumber(process.env.COVERAGE_MIN_LINES, 0),
  };
});
