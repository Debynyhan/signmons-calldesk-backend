#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const summaryPath = path.resolve(
  process.env.COVERAGE_SUMMARY_PATH || "coverage/coverage-summary.json",
);

const toNumber = (value, fallback) => {
  const parsed = value !== undefined ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};

const thresholds = {
  statements: toNumber(process.env.COVERAGE_MIN_STATEMENTS, 0),
  branches: toNumber(process.env.COVERAGE_MIN_BRANCHES, 0),
  functions: toNumber(process.env.COVERAGE_MIN_FUNCTIONS, 0),
  lines: toNumber(process.env.COVERAGE_MIN_LINES, 0),
};

let data;
try {
  data = fs.readFileSync(summaryPath, "utf8");
} catch (err) {
  console.error(`Cannot read coverage file at ${summaryPath}: ${err.message}`);
  process.exit(1);
}

let summary;
try {
  const json = JSON.parse(data);
  summary = json.total;
  if (!summary) {
    throw new Error("Missing total coverage section");
  }
} catch (err) {
  console.error(`Invalid coverage JSON at ${summaryPath}: ${err.message}`);
  process.exit(1);
}

const checks = [
  { name: "statements", pct: summary.statements?.pct, min: thresholds.statements },
  { name: "branches", pct: summary.branches?.pct, min: thresholds.branches },
  { name: "functions", pct: summary.functions?.pct, min: thresholds.functions },
  { name: "lines", pct: summary.lines?.pct, min: thresholds.lines },
];

const failures = checks.filter((c) => !Number.isFinite(c.pct) || c.pct < c.min);

if (failures.length > 0) {
  console.error("Coverage check failed:");
  failures.forEach((c) => {
    console.error(`  ${c.name}: ${Number.isFinite(c.pct) ? c.pct : "n/a"}% < ${c.min}%`);
  });
  process.exit(1);
}

console.log("Coverage check passed:");
checks.forEach((c) => {
  console.log(`  ${c.name}: ${c.pct}% >= ${c.min}%`);
});

console.log(`Source: ${summaryPath}`);
