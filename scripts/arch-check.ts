/**
 * Architecture guardrail checks — runs in CI after build, before deploy.
 *
 * Gates enforced:
 *   1. Line count      — no non-spec .ts source file may exceed 900 lines
 *   2. Constructor     — *Service / *Controller classes may not exceed 8 params
 *                        (DI-bag aggregators and listed exceptions are excluded)
 *   3. Shim patterns   — zero occurrences of `as Partial<.*Service` or `hasLegacy[A-Z]`
 *   4. Manual new      — no `this.<field> = new SomeClass(...)` in *.service.ts constructors
 *   5. Module boundary — cross-module imports in services/controllers must use
 *                        interface/constants seams or approved allowlist entries
 *
 * Run: ts-node --transpile-only scripts/arch-check.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";
import { sync as glob } from "glob";
import { execSync } from "child_process";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "..");
const SRC_ROOT = path.join(ROOT, "src");
const SRC_GLOB = "src/**/*.ts";
const MODULE_GLOB = "src/**/*.module.ts";
const SPEC_PATTERN = /\.spec\.ts$|\.e2e\.spec\.ts$/;

const LINE_LIMIT = 900;

/** Classes whose entire purpose is dep aggregation — exempt from param limit */
const CONSTRUCTOR_PARAM_EXCEPTIONS = new Set<string>([
  "VoiceTurnDependencies", // 21 params — DI-bag by design
  "VoiceStreamDependencies", // 10 params — DI-bag, further reduction in TODO-3
  "PaymentsService", // 10 params — pending future refactor
]);
const CONSTRUCTOR_PARAM_LIMIT = 8;

/**
 * TODO-9 approved cross-boundary seams.
 * Keep this list explicit and small. Add with rationale only when a seam is intentional.
 */
const MODULE_BOUNDARY_ALLOWED_TARGET_PREFIXES: ReadonlyArray<{
  prefix: string;
  reason: string;
}> = [
  { prefix: "src/config/", reason: "Shared application config factories" },
  { prefix: "src/common/", reason: "Cross-cutting request context and guards" },
  {
    prefix: "src/logging/",
    reason: "Shared observability interfaces/services",
  },
  { prefix: "src/sanitization/", reason: "Shared sanitization utilities" },
  { prefix: "src/prisma/", reason: "Shared data access infrastructure" },
  { prefix: "src/auth/", reason: "Shared auth guards/services" },
];

const MODULE_BOUNDARY_ALLOWED_TARGET_FILES: ReadonlyArray<{
  file: string;
  reason: string;
}> = [
  {
    file: "src/google/google-tts.service.ts",
    reason: "Voice audio composition depends on Google TTS adapter",
  },
  {
    file: "src/conversations/conversations.service.ts",
    reason: "Approved interim seam pending full interface-only boundary",
  },
  {
    file: "src/conversations/conversations.repository.ts",
    reason: "Approved interim persistence seam for voice state service",
  },
  {
    file: "src/conversations/voice-conversation-state.codec.ts",
    reason: "Shared voice-state codec type surface",
  },
  {
    file: "src/ai/routing/ai-route-state.ts",
    reason: "Shared AI route-state model used by conversation persistence",
  },
  {
    file: "src/sms/sms.service.ts",
    reason: "Payments-to-SMS outbound delivery seam",
  },
  {
    file: "src/jobs/jobs.service.ts",
    reason: "Payments-to-jobs dispatch seam",
  },
  {
    file: "src/tenants/fee-policy.ts",
    reason: "Shared tenant fee-policy helper",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Violation {
  file: string;
  message: string;
}

interface ModuleMetadata {
  absFile: string;
  file: string;
  domain: string;
  providers: Set<string>;
  exports: Set<string>;
  importMap: Map<string, string>;
}

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

function relPath(abs: string): string {
  return toPosix(path.relative(ROOT, abs));
}

function collectSourceFiles(pattern: string, excludeSpec = true): string[] {
  const files = glob(pattern, { cwd: ROOT, absolute: true });
  return excludeSpec ? files.filter((f) => !SPEC_PATTERN.test(f)) : files;
}

function parseSourceFile(filePath: string): ts.SourceFile {
  const src = fs.readFileSync(filePath, "utf8");
  return ts.createSourceFile(filePath, src, ts.ScriptTarget.Latest, true);
}

function getSourceDomain(absPath: string): string {
  const relFromSrc = toPosix(path.relative(SRC_ROOT, absPath));
  if (relFromSrc.startsWith("..")) {
    return "__external__";
  }
  const segments = relFromSrc.split("/");
  return segments.length > 1 ? segments[0] : "__root__";
}

function resolveInternalImport(
  importerFile: string,
  specifier: string,
): string | null {
  let basePath: string;

  if (specifier.startsWith(".")) {
    basePath = path.resolve(path.dirname(importerFile), specifier);
  } else if (specifier.startsWith("src/")) {
    basePath = path.join(ROOT, specifier);
  } else {
    return null;
  }

  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, "index.ts"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.resolve(candidate);
    }
  }

  return null;
}

function isServiceOrController(name: string): boolean {
  return /Service$|Controller$/.test(name);
}

function isInterfaceOrConstantsFile(fileRelPath: string): boolean {
  const base = path.basename(fileRelPath);
  return base.endsWith(".interface.ts") || base.endsWith("constants.ts");
}

function isApprovedCrossBoundarySeam(targetRelPath: string): boolean {
  if (
    MODULE_BOUNDARY_ALLOWED_TARGET_PREFIXES.some(({ prefix }) =>
      targetRelPath.startsWith(prefix),
    )
  ) {
    return true;
  }

  return MODULE_BOUNDARY_ALLOWED_TARGET_FILES.some(
    ({ file }) => targetRelPath === file,
  );
}

function buildImportMap(
  sf: ts.SourceFile,
  absFile: string,
): Map<string, string> {
  const map = new Map<string, string>();

  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!stmt.importClause) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;

    const resolved = resolveInternalImport(absFile, stmt.moduleSpecifier.text);
    if (!resolved) continue;

    const clause = stmt.importClause;
    if (clause.name) {
      map.set(clause.name.text, resolved);
    }

    const bindings = clause.namedBindings;
    if (!bindings) continue;

    if (ts.isNamespaceImport(bindings)) {
      map.set(bindings.name.text, resolved);
      continue;
    }

    if (!ts.isNamedImports(bindings)) continue;

    for (const element of bindings.elements) {
      map.set(element.name.text, resolved);
    }
  }

  return map;
}

function getClassName(node: ts.ClassDeclaration): string | undefined {
  return node.name?.text;
}

function getModuleDecoratorCall(
  node: ts.ClassDeclaration,
): ts.CallExpression | null {
  const decorators = ts.canHaveDecorators(node)
    ? ts.getDecorators(node)
    : undefined;
  if (!decorators?.length) {
    return null;
  }

  for (const decorator of decorators) {
    const expr = decorator.expression;
    if (!ts.isCallExpression(expr)) continue;
    if (!ts.isIdentifier(expr.expression)) continue;
    if (expr.expression.text !== "Module") continue;
    return expr;
  }

  return null;
}

function extractIdentifiersFromModuleArrayElement(
  element: ts.Expression,
): string[] {
  if (ts.isIdentifier(element)) {
    return [element.text];
  }

  if (ts.isObjectLiteralExpression(element)) {
    const names: string[] = [];
    for (const prop of element.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      if (!ts.isIdentifier(prop.name)) continue;

      const key = prop.name.text;
      if (key !== "provide" && key !== "useClass" && key !== "useExisting") {
        continue;
      }

      if (ts.isIdentifier(prop.initializer)) {
        names.push(prop.initializer.text);
      }
    }
    return names;
  }

  return [];
}

function collectModuleMetadata(moduleFiles: string[]): ModuleMetadata[] {
  const metadata: ModuleMetadata[] = [];

  for (const moduleFile of moduleFiles) {
    const sf = parseSourceFile(moduleFile);
    const providers = new Set<string>();
    const exportsSet = new Set<string>();
    const importMap = buildImportMap(sf, moduleFile);

    ts.forEachChild(sf, (node) => {
      if (!ts.isClassDeclaration(node)) return;

      const moduleDecoratorCall = getModuleDecoratorCall(node);
      if (!moduleDecoratorCall) return;

      const firstArg = moduleDecoratorCall.arguments[0];
      if (!firstArg || !ts.isObjectLiteralExpression(firstArg)) return;

      for (const prop of firstArg.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        if (!ts.isIdentifier(prop.name)) continue;
        if (!ts.isArrayLiteralExpression(prop.initializer)) continue;

        if (prop.name.text === "providers") {
          for (const element of prop.initializer.elements) {
            for (const id of extractIdentifiersFromModuleArrayElement(
              element,
            )) {
              providers.add(id);
            }
          }
        }

        if (prop.name.text === "exports") {
          for (const element of prop.initializer.elements) {
            for (const id of extractIdentifiersFromModuleArrayElement(
              element,
            )) {
              exportsSet.add(id);
            }
          }
        }
      }
    });

    metadata.push({
      absFile: moduleFile,
      file: relPath(moduleFile),
      domain: getSourceDomain(moduleFile),
      providers,
      exports: exportsSet,
      importMap,
    });
  }

  return metadata;
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
    description:
      "`hasLegacy*` function declaration (legacy bridge anti-pattern)",
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
  if (
    !ts.isThisTypeNode(lhs.expression) &&
    lhs.expression.kind !== ts.SyntaxKind.ThisKeyword
  ) {
    return false;
  }

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
// Gate 5 — Module boundary
// ---------------------------------------------------------------------------

function checkCrossModuleServiceControllerImports(
  files: string[],
  moduleDomains: Set<string>,
): Violation[] {
  const violations: Violation[] = [];

  const candidateFiles = files.filter(
    (f) => /\.(service|controller)\.ts$/.test(f) && !SPEC_PATTERN.test(f),
  );

  for (const file of candidateFiles) {
    const sourceDomain = getSourceDomain(file);
    if (!moduleDomains.has(sourceDomain)) continue;

    const sourceRel = relPath(file);
    const sf = parseSourceFile(file);

    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt)) continue;
      if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;

      const specifier = stmt.moduleSpecifier.text;
      const targetAbs = resolveInternalImport(file, specifier);
      if (!targetAbs) continue;

      const targetRel = relPath(targetAbs);
      if (!targetRel.startsWith("src/")) continue;

      const targetDomain = getSourceDomain(targetAbs);
      if (targetDomain === sourceDomain) continue;
      if (isInterfaceOrConstantsFile(targetRel)) continue;
      if (isApprovedCrossBoundarySeam(targetRel)) continue;

      const { line } = sf.getLineAndCharacterOfPosition(stmt.getStart());
      violations.push({
        file: `${sourceRel}:${line + 1}`,
        message: `cross-module import '${specifier}' resolves to '${targetRel}' — use '*.interface.ts' or '*constants.ts' seam (or add explicit allowlist rationale)`,
      });
    }
  }

  return violations;
}

function checkCrossModuleProviderRegistrations(
  moduleMetadata: ModuleMetadata[],
): Violation[] {
  const violations: Violation[] = [];

  for (const meta of moduleMetadata) {
    for (const provider of meta.providers) {
      const targetAbs = meta.importMap.get(provider);
      if (!targetAbs) continue;

      const targetRel = relPath(targetAbs);
      if (!targetRel.startsWith("src/")) continue;
      if (isInterfaceOrConstantsFile(targetRel)) continue;
      if (isApprovedCrossBoundarySeam(targetRel)) continue;

      const targetDomain = getSourceDomain(targetAbs);
      if (targetDomain === meta.domain) continue;

      const targetModuleExportsProvider = moduleMetadata.some(
        (m) => m.domain === targetDomain && m.exports.has(provider),
      );

      if (targetModuleExportsProvider) {
        continue;
      }

      violations.push({
        file: meta.file,
        message: `provider '${provider}' imported from '${targetRel}' crosses module boundary and is not exported by target module domain '${targetDomain}'`,
      });
    }
  }

  return violations;
}

function checkModuleBoundaries(allSourceFiles: string[]): Violation[] {
  const moduleFiles = collectSourceFiles(MODULE_GLOB, true);
  const metadata = collectModuleMetadata(moduleFiles);
  const moduleDomains = new Set(metadata.map((m) => m.domain));

  const importViolations = checkCrossModuleServiceControllerImports(
    allSourceFiles,
    moduleDomains,
  );
  const providerViolations = checkCrossModuleProviderRegistrations(metadata);

  return [...importViolations, ...providerViolations];
}

// ---------------------------------------------------------------------------
// Gate 6 — npm audit (no critical severity prod dependencies)
// ---------------------------------------------------------------------------

function checkNpmAudit(): Violation[] {
  let stdout: string;
  try {
    stdout = execSync("npm audit --omit=dev --json", {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err: unknown) {
    // npm audit exits non-zero when vulnerabilities exist; capture stdout from the error
    const execError = err as { stdout?: string };
    stdout = execError.stdout ?? "";
  }

  if (!stdout) {
    return [{ file: "package.json", message: "npm audit produced no output — cannot verify prod dependencies" }];
  }

  let report: { vulnerabilities?: Record<string, { severity: string; name: string }> };
  try {
    report = JSON.parse(stdout) as typeof report;
  } catch {
    return [{ file: "package.json", message: "npm audit output could not be parsed" }];
  }

  const violations: Violation[] = [];
  for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
    if (vuln.severity === "critical") {
      violations.push({
        file: "package.json",
        message: `prod dependency '${name}' has a CRITICAL severity vulnerability — update or override before merging`,
      });
    }
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
  console.error(
    `  ✗  ${result.name} — ${result.violations.length} violation(s):`,
  );
  for (const v of result.violations) {
    console.error(`       ${v.file}: ${v.message}`);
  }
  return false;
}

function main(): void {
  const allSourceFiles = collectSourceFiles(SRC_GLOB, true);

  console.log(`\nArchitecture check — ${allSourceFiles.length} source files\n`);

  const gates: GateResult[] = [
    {
      name: `Gate 1 — Line count (≤${LINE_LIMIT})`,
      violations: checkLineCounts(allSourceFiles),
    },
    {
      name: `Gate 2 — Constructor params (≤${CONSTRUCTOR_PARAM_LIMIT}, excluding DI-bags)`,
      violations: checkConstructorParams(allSourceFiles),
    },
    {
      name: "Gate 3 — No shim patterns",
      violations: checkShimPatterns(allSourceFiles),
    },
    {
      name: "Gate 4 — No manual `new` in service constructors",
      violations: checkManualNew(allSourceFiles),
    },
    {
      name: "Gate 5 — Module boundary (imports/providers)",
      violations: checkModuleBoundaries(allSourceFiles),
    },
    {
      name: "Gate 6 — No critical severity prod dependencies (npm audit)",
      violations: checkNpmAudit(),
    },
  ];

  const passed = gates.map(printGate);
  const allPassed = passed.every(Boolean);

  console.log();
  if (allPassed) {
    console.log("All architecture gates passed.\n");
    process.exit(0);
  }

  const failCount = passed.filter((p) => !p).length;
  console.error(
    `${failCount} gate(s) failed. Fix violations before merging.\n`,
  );
  process.exit(1);
}

main();
