/**
 * Label expressions: `wontfix OR (duplicate AND NOT keep-open)`.
 *
 * Grammar (precedence NOT > AND > OR, keywords are case-insensitive):
 *   or      := and ( "OR" and )*
 *   and     := not ( "AND" not )*
 *   not     := "NOT" not | primary
 *   primary := label | "(" or ")"
 *   label   := bare word | "quoted label" | 'quoted label'
 */

export type Node =
  | { type: "label"; name: string }
  | { type: "not"; operand: Node }
  | { type: "and"; left: Node; right: Node }
  | { type: "or"; left: Node; right: Node };

export class ExpressionError extends Error {
  constructor(
    message: string,
    readonly source: string,
    readonly position: number,
  ) {
    super(`${message}\n  ${source}\n  ${" ".repeat(position)}^`);
    this.name = "ExpressionError";
  }
}

type Token =
  | { kind: "label"; name: string; pos: number }
  | { kind: "and" | "or" | "not" | "lparen" | "rparen"; pos: number };

const KEYWORDS: Record<string, "and" | "or" | "not"> = { and: "and", or: "or", not: "not" };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === "(") {
      tokens.push({ kind: "lparen", pos: i++ });
    } else if (ch === ")") {
      tokens.push({ kind: "rparen", pos: i++ });
    } else if (ch === '"' || ch === "'") {
      const end = source.indexOf(ch, i + 1);
      if (end === -1) throw new ExpressionError("Unterminated quoted label", source, i);
      const name = source.slice(i + 1, end).trim();
      if (!name) throw new ExpressionError("Empty quoted label", source, i);
      tokens.push({ kind: "label", name, pos: i });
      i = end + 1;
    } else {
      const start = i;
      while (i < source.length && !/[\s()"']/.test(source[i]!)) i++;
      const word = source.slice(start, i);
      const keyword = KEYWORDS[word.toLowerCase()];
      tokens.push(keyword ? { kind: keyword, pos: start } : { kind: "label", name: word, pos: start });
    }
  }
  return tokens;
}

export function parse(source: string): Node {
  const tokens = tokenize(source);
  let index = 0;

  const peek = (): Token | undefined => tokens[index];
  const fail = (message: string, token: Token | undefined): never => {
    throw new ExpressionError(message, source, token ? token.pos : source.length);
  };

  function parseOr(): Node {
    let left = parseAnd();
    while (peek()?.kind === "or") {
      index++;
      left = { type: "or", left, right: parseAnd() };
    }
    return left;
  }

  function parseAnd(): Node {
    let left = parseNot();
    while (peek()?.kind === "and") {
      index++;
      left = { type: "and", left, right: parseNot() };
    }
    return left;
  }

  function parseNot(): Node {
    if (peek()?.kind === "not") {
      index++;
      return { type: "not", operand: parseNot() };
    }
    return parsePrimary();
  }

  function parsePrimary(): Node {
    const token = peek();
    if (!token) return fail("Expected a label but the expression ended", token);
    if (token.kind === "label") {
      index++;
      return { type: "label", name: token.name };
    }
    if (token.kind === "lparen") {
      index++;
      const inner = parseOr();
      const close = peek();
      if (close?.kind !== "rparen") return fail("Missing closing parenthesis", close);
      index++;
      return inner;
    }
    return fail(`Expected a label but found ${describe(token)}`, token);
  }

  if (tokens.length === 0) throw new ExpressionError("Expression is empty", source, 0);
  const tree = parseOr();
  const leftover = peek();
  if (leftover) {
    fail(
      leftover.kind === "label"
        ? `Expected AND or OR before "${leftover.name}" (quote labels that contain spaces)`
        : `Unexpected ${describe(leftover)}`,
      leftover,
    );
  }
  return tree;
}

function describe(token: Token): string {
  switch (token.kind) {
    case "label":
      return `"${token.name}"`;
    case "lparen":
      return '"("';
    case "rparen":
      return '")"';
    default:
      return token.kind.toUpperCase();
  }
}

/** Builds `a OR b OR c` / `a AND b AND c` from a plain list. */
export function fromList(labels: string[], operator: "and" | "or"): Node {
  const [first, ...rest] = labels.map((name): Node => ({ type: "label", name }));
  if (!first) throw new Error("At least one label is required");
  return rest.reduce((left, right): Node => ({ type: operator, left, right }), first);
}

/** GitHub label names are case-insensitive. */
const normalize = (label: string): string => label.trim().toLowerCase();

export function evaluate(node: Node, labels: string[]): boolean {
  const present = new Set(labels.map(normalize));
  const walk = (n: Node): boolean => {
    switch (n.type) {
      case "label":
        return present.has(normalize(n.name));
      case "not":
        return !walk(n.operand);
      case "and":
        return walk(n.left) && walk(n.right);
      case "or":
        return walk(n.left) || walk(n.right);
    }
  };
  return walk(node);
}

/**
 * Labels on the item that the expression asks for (not the ones under NOT).
 * Returned with the casing used on the item.
 */
export function matchedLabels(node: Node, labels: string[]): string[] {
  const wanted = new Set<string>();
  const walk = (n: Node, positive: boolean): void => {
    switch (n.type) {
      case "label":
        if (positive) wanted.add(normalize(n.name));
        return;
      case "not":
        return walk(n.operand, !positive);
      default:
        walk(n.left, positive);
        walk(n.right, positive);
    }
  };
  walk(node, true);
  return [...new Set(labels.filter((label) => wanted.has(normalize(label))))];
}
