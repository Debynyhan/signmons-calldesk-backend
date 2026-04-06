import { registerAs } from "@nestjs/config";

export interface CoverageConfig {
  summaryPath: string;
  minStatements: number;
  minBranches: number;
  minFunctions: number;
  minLines: number;
}

export default registerAs("coverage", (): CoverageConfig => {
  return {
    summaryPath:
      process.env.COVERAGE_SUMMARY_PATH ?? "coverage/coverage-summary.json",
    minStatements: Number(process.env.COVERAGE_MIN_STATEMENTS ?? 0),
    minBranches: Number(process.env.COVERAGE_MIN_BRANCHES ?? 0),
    minFunctions: Number(process.env.COVERAGE_MIN_FUNCTIONS ?? 0),
    minLines: Number(process.env.COVERAGE_MIN_LINES ?? 0),
  };
});
