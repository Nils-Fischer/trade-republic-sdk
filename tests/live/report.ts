import { type } from "arktype";
import { TRHttpError, TRTopicError, TRValidationError } from "../../src/index.ts";

interface SafeSchemaIssue {
  accessor: string;
  path?: string;
  code: string;
  expected?: string;
  actualType?: string;
  actualFields?: SafeFieldType[];
  actualLiteral?: string;
}

interface SafeFieldType {
  path: string;
  type: string;
}

interface SafeFailure {
  accessor: string;
  code: string;
  status?: number;
}

export interface AccessorCounts {
  readonly pages?: number;
  readonly items?: number;
}

export interface LiveReport {
  capture(accessor: string, warning: TRValidationError): void;
  accessor(accessor: string, counts?: AccessorCounts): void;
  failure(accessor: string, error: Error): void;
  skipped(accessor: string, reason: string): void;
  finish(): boolean;
}

export function createLiveReport(write: (line: string) => void): LiveReport {
  const issues = new Map<string, Map<string, SafeSchemaIssue>>();
  let failedReads = 0;

  const capture = (accessor: string, warning: TRValidationError): void => {
    const accessorIssues = issues.get(accessor) ?? new Map<string, SafeSchemaIssue>();
    issues.set(accessor, accessorIssues);

    for (const issue of validationIssues(warning)) {
      const safe = safeSchemaIssue(accessor, issue);
      const key = JSON.stringify(safe);
      accessorIssues.set(key, safe);
    }
  };

  const accessor = (name: string, counts: AccessorCounts = {}): void => {
    const accessorIssues = issues.get(name);
    const status = accessorIssues?.size ? "schema-drift" : "pass";
    write(`${name}: ${status}${formatCounts(counts)}`);
    writeIssues(accessorIssues, write);
  };

  const failure = (accessorName: string, error: Error): void => {
    failedReads += 1;
    write(`${accessorName}: fail`);
    write(JSON.stringify(safeFailure(accessorName, error)));
    writeIssues(issues.get(accessorName), write);
  };

  const skipped = (accessorName: string, reason: string): void => {
    write(`${accessorName}: skip`);
    write(JSON.stringify({ accessor: accessorName, code: reason }));
  };

  const finish = (): boolean => {
    const issueAccessors = [...issues.entries()].filter(([, current]) => current.size > 0);
    const issueCount = issueAccessors.reduce((sum, [, current]) => sum + current.size, 0);
    const issueDetails = `${issueCount} ${plural(issueCount, "issue")}: ${issueAccessors
      .map(([accessorName]) => accessorName)
      .join(", ")}`;
    if (failedReads > 0) {
      const issueSummary = issueCount > 0 ? `, ${issueDetails}` : "";
      write(`liveAudit: fail (${failedReads} ${plural(failedReads, "read")}${issueSummary})`);
      return false;
    }
    if (issueCount > 0) {
      write(`liveAudit: schema-drift (${issueDetails})`);
      return false;
    }
    write("liveAudit: pass");
    return true;
  };

  return { capture, accessor, failure, skipped, finish };
}

function writeIssues(
  issues: ReadonlyMap<string, SafeSchemaIssue> | undefined,
  write: (line: string) => void,
): void {
  issues?.forEach((issue) => write(JSON.stringify(issue)));
}

function validationIssues(warning: TRValidationError): readonly type.errors[number][] {
  const cause = warning.cause;
  return cause instanceof type.errors ? cause : [];
}

function safeSchemaIssue(accessor: string, issue: type.errors[number]): SafeSchemaIssue {
  const path = schemaPath(issue.path);
  const safe: SafeSchemaIssue = { accessor, path, code: issue.code };
  if (issue.expected) safe.expected = issue.expected;
  safe.actualType = valueType(issue.data);
  const fields = actualFields(issue.data);
  if (fields.length > 0) safe.actualFields = fields;
  const literal = safeDiscriminator(issue.path, issue.code, issue.data);
  if (literal) safe.actualLiteral = literal;
  return safe;
}

function schemaPath(path: readonly PropertyKey[]): string | undefined {
  const segments = path.flatMap((segment) => {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- ArkType paths contain typed property keys; number marks an array index.
    if (typeof segment === "number") return "*";
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Symbols must not enter the printed schema path.
    if (typeof segment === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(segment)) return segment;
    return [];
  });
  return segments.length > 0 ? segments.join(".") : undefined;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the output-sanitizing boundary for ArkType's untrusted actual value.
function valueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Only the primitive category is emitted; the value is discarded.
  return typeof value;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This boundary converts a rejected value to property paths and types only.
function actualFields(value: unknown): SafeFieldType[] {
  const fields: SafeFieldType[] = [];
  appendFields(value, "", 0, fields);
  return fields;
}

function appendFields(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Recursive values remain untrusted and are reduced before output.
  value: unknown,
  parent: string,
  depth: number,
  fields: SafeFieldType[],
): void {
  if (depth >= 3 || fields.length >= 32) return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 3)) {
      const path = parent ? `${parent}.*` : "*";
      appendField(path, item, depth, fields);
    }
    return;
  }
  if (!(value instanceof Object)) return;

  const entries = Object.entries(value)
    .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 32 - fields.length);
  for (const [key, child] of entries) {
    const path = parent ? `${parent}.${key}` : key;
    appendField(path, child, depth, fields);
  }
}

function appendField(
  path: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The value is reduced to its primitive category before storage.
  value: unknown,
  depth: number,
  fields: SafeFieldType[],
): void {
  const entry = { path, type: valueType(value) };
  if (!fields.some((current) => current.path === entry.path && current.type === entry.type)) {
    fields.push(entry);
  }
  appendFields(value, path, depth + 1, fields);
}

function safeDiscriminator(
  path: readonly PropertyKey[],
  code: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Only schema discriminator fields with identifier-like values may pass.
  value: unknown,
): string | undefined {
  if (code !== "unit" || path.at(-1) !== "type") return undefined;
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This gate prevents non-string response data from entering output.
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) return undefined;
  return value;
}

function safeFailure(accessor: string, error: Error) {
  const result: SafeFailure = {
    accessor,
    code: error instanceof TRTopicError ? error.errorCode : error.name,
  };
  if (error instanceof TRHttpError) result.status = error.status;
  return result;
}

function formatCounts(counts: AccessorCounts): string {
  const parts: string[] = [];
  if (counts.pages !== undefined) parts.push(`${counts.pages} ${plural(counts.pages, "page")}`);
  if (counts.items !== undefined) parts.push(`${counts.items} ${plural(counts.items, "item")}`);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}
