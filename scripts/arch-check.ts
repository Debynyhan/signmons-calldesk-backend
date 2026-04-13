/**
 * Architecture guardrail checks — runs in CI after build, before deploy.
 *
 * Gates enforced:
 *   1. Line count     — no non-spec .ts source file may exceed 900 lines
 *   2. Constructor    — *Service / *Controller classes may not exceed 8 params
 *                       (DI-bag aggregators and listed exceptions are excluded)
 *   3. Shim patterns  — zero occurrences of `as Partial<.*Service` or `hasLegacy[A-Z]`
 *   4. Manual new     — no `this.<field> = new SomeClass(...)` in *.service.ts constructors
 *
 * Run: ts-node --transpile-only scripts/arch-check.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";
import { sync as glob } from "glob";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "..");
const SRC_GLOB = "src/**/*.ts";
const SPEC_PATTERN = /\.spec\.ts$|\.e2e\.spec\.ts$/;

const LINE_LIMIT = 900;

/** Classes whose entire purpose is dep aggregation — exempt from param limit */
const CONSTRUCTOR_PARAM_EXCEPTIONS = new Set<string>([
  "VoiceTurnDependencies",   // 21 params — DI-bag by design
  "VoiceStreamDependencies", // 10 params — DI-bag, further reduction in TODO-3
  "PaymentsService",         // 10 params — pending future refactor
]);
const CONSTRUCTOR_PARAM_LIMIT = 8;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Violation {
  file: string;
  message: string;
}

function relPath(abs: string): string {
  return path.relative(ROOT, abs);
}

function collectSourceFiles(pattern: string, excludeSpec = true): string[] {
  const files = glob(pattern, { cwd: ROOT, absolute: true });
  return excludeSpec ? files.filter((f) => !SPEC_PATTERN.test(f)) : files;
}

function parseSourceFile(filePath: string): ts.SourceFile {
  const src = fs.readFileSync(filePath, "utf8");
  return ts.createSourceFile(filePath, src, ts.ScriptTarget.Latest, true);
}

// ---------------------------------------------------------------------------
// Gate 1 — Line count
// ---------------------------------------------------------------------------

function checkLineCounts(files: string[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n").length;
    if (lines > LINE_LIMIT) {
      violations.push({
        file: relPath(file),
        message: `${lines} lines (limit ${LINE_LIMIT})`,
      });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Gate 2 — Constructor param count (AST)
// ---------------------------------------------------------------------------

function getClassName(node: ts.ClassDeclaration): string | undefined {
  return node.name?.text;
}

function isServiceOrController(name: string): boolean {
  return /Service$|Controller$/.test(name);
}

function checkConstructorParams(files: string[]): Violation[] {
  const violations: Violation[] = [];

  for (const file of files) {
    const sf = parseSourceFile(file);

    ts.forEachChild(sf, function visit(node) {
      if (!ts.isClassDeclaration(node)) {
        ts.forEachChild(node, visit);
        return;
      }

      const className = getClassName(node);
      if (!className) return;
      if (!isServiceOrController(className)) return;
      if (CONSTRUCTOR_PARAM_EXCEPTIONS.has(className)) return;

      for (const member of node.members) {
        if (!ts.isConstructorDeclaration(member)) continue;
        const paramCount = member.parameters.length;
        if (paramCount > CONSTRUCTOR_PARAM_LIMIT) {
          violations.push({
            file: relPath(file),
            message: `${className} constructor has ${paramCount} params (limit ${CONSTRUCTOR_PARAM_LIMIT}) — add to CONSTRUCTOR_PARAM_EXCEPTIONS if intentional`,
          });
        }
      }
    });
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Gate 3 — Shim patterns (text scan)
// ---------------------------------------------------------------------------

const SHIM_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  {
    pattern: /as Partial<[A-Za-z]*Service/,
    description: "`as Partial<*Service` cast (shim anti-pattern)",
  },
  {
    pattern: /hasLegacy[A-Z]/,
    description: "`hasLegacy*` function declaration (legacy bridge anti-pattern)",
  },
];

function checkShimPatterns(files: string[]): Violation[] {
  const violations: Violation[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n");

    for (const { pattern, description } of SHIM_PATTERNS) {
      lines.forEach((line, idx) => {
        if (pattern.test(line)) {
          violations.push({
            file: `${relPath(file)}:${idx + 1}`,
            message: description,
          });
        }
      });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Gate 4 — Manual new in service constructors (AST)
// ---------------------------------------------------------------------------

function isThisPropertyAssignmentOfNew(stmt: ts.Statement): boolean {
  // Match: this.<field> = new SomeClass(...)
  if (!ts.isExpressionStatement(stmt)) return false;
  const expr = stmt.expression;
  if (!ts.isBinaryExpression(expr)) return false;
  if (expr.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;

  const lhs = expr.left;
  if (!ts.isPropertyAccessExpression(lhs)) return false;
  if (!ts.isThisTypeNode(lhs.expression) && lhs.expression.kind !== ts.SyntaxKind.ThisKeyword) return false;

  const rhs = expr.right;
  return ts.isNewExpression(rhs);
}

function checkManualNew(files: string[]): Violation[] {
  const violations: Violation[] = [];

  // Only apply to *.service.ts files (not specs)
  const serviceFiles = files.filter((f) => /\.service\.ts$/.test(f));

  for (const file of serviceFiles) {
    const sf = parseSourceFile(file);

    ts.forEachChild(sf, function visit(node) {
      if (!ts.isClassDeclaration(node)) {
        ts.forEachChild(node, visit);
        return;
      }

      for (const member of node.members) {
        if (!ts.isConstructorDeclaration(member)) continue;
        if (!member.body) continue;

        for (const stmt of member.body.statements) {
          if (isThisPropertyAssignmentOfNew(stmt)) {
            const { line } = sf.getLineAndCharacterOfPosition(stmt.getStart());
            const className = getClassName(node) ?? "<anonymous>";
            violations.push({
              file: `${relPath(file)}:${line + 1}`,
              message: `${className} constructor manually instantiates via \`new\` — inject the dependency instead`,
            });
          }
        }
      }
    });
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

interface GateResult {
  name: string;
  violations: Violation[];
}

function printGate(result: GateResult): boolean {
  if (result.violations.length === 0) {
    console.log(`  ✓  ${result.name}`);
    return true;
  }
  console.error(`  ✗  ${result.name} — ${result.violations.length} violation(s):`);
  for (const v of result.violations) {
    console.error(`       ${v.file}: ${v.message}`);
  }
  return false;
}

function main(): void {
  const allSourceFiles = collectSourceFiles(SRC_GLOB, true);

  console.log(`\nArchitecture check — ${allSourceFiles.length} source files\n`);

  const gates: GateResult[] = [
    { name: `Gate 1 — Line count (≤${LINE_LIMIT})`, violations: checkLineCounts(allSourceFiles) },
    { name: `Gate 2 — Constructor params (≤${CONSTRUCTOR_PARAM_LIMIT}, excluding DI-bags)`, violations: checkConstructorParams(allSourceFiles) },
    { name: "Gate 3 — No shim patterns", violations: checkShimPatterns(allSourceFiles) },
    { name: "Gate 4 — No manual `new` in service constructors", violations: checkManualNew(allSourceFiles) },
  ];

  const passed = gates.map(printGate);
  const allPassed = passed.every(Boolean);

  console.log();
  if (allPassed) {
    console.log("All architecture gates passed.\n");
    process.exit(0);
  } else {
    const failCount = passed.filter((p) => !p).length;
    console.error(`${failCount} gate(s) failed. Fix violations before merging.\n`);
    process.exit(1);
  }
}

main();
