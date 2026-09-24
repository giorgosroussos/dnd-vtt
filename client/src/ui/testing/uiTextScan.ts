import ts from 'typescript';

// Finds UI text written outside the message catalogue (specs/08-ux-journeys.md §6,
// D-073). Used by messages.test.ts over every client source file; never bundled.
//
// UI text is a string literal in a place where it becomes something the user
// reads: JSX text, a literal child expression, a text-bearing attribute or prop,
// an assignment to a DOM text property, or a browser dialog. Whitespace-only
// literals are layout, not text. Keys passed to `t()` are not in these places.

export interface Finding {
  file: string;
  line: number;
  text: string;
  where: string;
}

// Attributes and props whose value is read or announced to the user. `label` and
// `error` are props of the base components (TextField, SkipLink). Rendered
// attributes; the runtime check of messages.test.tsx reads these from the DOM.
export const TEXT_ATTRIBUTES = new Set([
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
  'aria-placeholder',
  'alt',
  'title',
  'placeholder',
  'label',
  'error',
]);
// `children` is text when written as a prop, in JSX or to createElement.
const TEXT_PROPS = new Set([...TEXT_ATTRIBUTES, 'children']);
// An input of these types shows its `value` as its label.
const LABELLED_BY_VALUE = new Set(['submit', 'button', 'reset']);
const ELEMENT_FACTORIES = new Set(['createElement', 'jsx', 'jsxs', 'jsxDEV']);
const TEXT_PROPERTIES = new Set(['title', 'textContent', 'innerText', 'innerHTML', 'outerHTML']);
const DIALOGS = new Set(['alert', 'confirm', 'prompt']);

function isText(value: string): boolean {
  return value.trim() !== '';
}

// Literal text reachable as the value of `expression`: the literal itself, either
// branch of a conditional, either side of `&&`, `||`, `??` or `+`, array items.
function literalTexts(expression: ts.Expression): string[] {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return isText(expression.text) ? [expression.text] : [];
  }
  if (ts.isTemplateExpression(expression)) {
    const parts = [expression.head.text, ...expression.templateSpans.map((span) => span.literal.text)];
    const nested = expression.templateSpans.flatMap((span) => literalTexts(span.expression));
    return [...(parts.some(isText) ? [parts.join('…')] : []), ...nested];
  }
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)) {
    return literalTexts(expression.expression);
  }
  if (ts.isConditionalExpression(expression)) {
    return [...literalTexts(expression.whenTrue), ...literalTexts(expression.whenFalse)];
  }
  if (ts.isBinaryExpression(expression)) {
    const op = expression.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return literalTexts(expression.right);
    if (
      op === ts.SyntaxKind.BarBarToken ||
      op === ts.SyntaxKind.QuestionQuestionToken ||
      op === ts.SyntaxKind.PlusToken
    ) {
      return [...literalTexts(expression.left), ...literalTexts(expression.right)];
    }
  }
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.flatMap((element) => (ts.isExpression(element) ? literalTexts(element) : []));
  }
  return [];
}

function attributeName(name: ts.JsxAttributeName): string {
  return ts.isIdentifier(name) ? name.text : `${name.namespace.text}:${name.name.text}`;
}

function propertyName(name: ts.PropertyName): string {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : '';
}

function literalAttribute(element: ts.JsxAttributes, name: string): string | undefined {
  for (const attribute of element.properties) {
    if (ts.isJsxAttribute(attribute) && attributeName(attribute.name) === name) {
      const value = attribute.initializer;
      return value && ts.isStringLiteral(value) ? value.text : undefined;
    }
  }
  return undefined;
}

// A literal `<input type="submit" value="…">`: the value is the button's label.
function isLabelledByValue(attribute: ts.JsxAttribute): boolean {
  if (attributeName(attribute.name) !== 'value') return false;
  const element = attribute.parent.parent;
  if (!ts.isJsxOpeningElement(element) && !ts.isJsxSelfClosingElement(element)) return false;
  if (element.tagName.getText() !== 'input') return false;
  return LABELLED_BY_VALUE.has(literalAttribute(attribute.parent, 'type') ?? '');
}

/** Every piece of UI text written as a literal in `source`. */
export function scanSource(file: string, source: string): Finding[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const findings: Finding[] = [];
  const report = (node: ts.Node, texts: string[], where: string) => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    for (const text of texts) findings.push({ file, line, text: text.trim(), where });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node) && isText(node.text)) {
      report(node, [node.text], 'JSX text');
    } else if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      report(node, literalTexts(node.expression), 'JSX child');
    } else if (
      ts.isJsxAttribute(node) &&
      (TEXT_PROPS.has(attributeName(node.name)) || isLabelledByValue(node)) &&
      node.initializer
    ) {
      const where = `attribute ${attributeName(node.name)}`;
      if (ts.isStringLiteral(node.initializer)) {
        report(node, isText(node.initializer.text) ? [node.initializer.text] : [], where);
      } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        report(node, literalTexts(node.initializer.expression), where);
      }
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      TEXT_PROPERTIES.has(node.left.name.text)
    ) {
      report(node, literalTexts(node.right), `assignment to ${node.left.name.text}`);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : '';
      if (DIALOGS.has(name)) report(node, node.arguments.flatMap(literalTexts), `${name}()`);
      if (ELEMENT_FACTORIES.has(name)) {
        // createElement(type, props, ...children): text props and literal children.
        const [, props, ...children] = node.arguments;
        if (props && ts.isObjectLiteralExpression(props)) {
          for (const property of props.properties) {
            if (ts.isPropertyAssignment(property) && TEXT_PROPS.has(propertyName(property.name))) {
              report(property, literalTexts(property.initializer), `${name}() prop ${propertyName(property.name)}`);
            }
          }
        }
        report(node, children.flatMap(literalTexts), `${name}() child`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

/**
 * UI text written into the HTML page itself. The page's title and language must
 * be the placeholders the catalogue plugin fills (client/vite.config.ts), and
 * the body carries no text: the views render it.
 */
export function scanIndexHtml(file: string, html: string): Finding[] {
  const findings: Finding[] = [];
  const title = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  if (title !== '%EG_TITLE%') findings.push({ file, line: 0, text: title ?? '(no title)', where: '<title>' });
  const lang = /<html[^>]*\blang="([^"]*)"/i.exec(html)?.[1];
  if (lang !== '%EG_LANG%') findings.push({ file, line: 0, text: lang ?? '(no lang)', where: '<html lang>' });
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? '';
  const text = body
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]*>/g, '')
    .trim();
  if (text) findings.push({ file, line: 0, text, where: '<body>' });
  return findings;
}
