import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const systemRoot = fileURLToPath(new URL('../../', import.meta.url));

const require = createRequire(join(systemRoot, 'package.json'));
const { runInNewContext } = require('node:vm');

const { parse } = require('@vue/compiler-sfc');
const typescript = require('typescript');

/** Компилирует настоящий обработчик исходного файла с явно заданными портами окружения. */
export async function loadHandler(relativePath, name, ports, macro = false) {
  const content = await readFile(join(systemRoot, relativePath), 'utf8');

  const script = relativePath.endsWith('.vue')
    ? parse(content).descriptor.scriptSetup.content
    : content;

  const sourceFile = typescript.createSourceFile(
    relativePath,
    script,
    typescript.ScriptTarget.Latest,
    true,
  );

  let handler;
  let expression = macro;

  /** Ищет объявление функции либо зарегистрированный обработчик макроса. */
  function visit(node) {
    if (
      !macro
      && typescript.isFunctionDeclaration(node)
      && node.name?.text === name
    ) {
      handler = node;
    }

    if (
      !macro
      && typescript.isVariableDeclaration(node)
      && node.name.getText(sourceFile) === name
      && node.initializer
    ) {
      handler = node.initializer;
      expression = true;
    }

    if (
      macro
      && typescript.isCallExpression(node)
      && node.expression.getText(sourceFile) === 'registerMacro'
      && node.arguments[0]?.text === name
    ) {
      handler = node.arguments[1];
    }

    typescript.forEachChild(node, visit);
  }

  visit(sourceFile);
  assert.ok(handler, `Не найден обработчик ${name}`);

  // Экспорт модуля не нужен при запуске отдельной настоящей функции в VM.
  if (typescript.isFunctionDeclaration(handler)) {
    handler = typescript.factory.updateFunctionDeclaration(
      handler,
      handler.modifiers?.filter(
        (modifier) =>
          modifier.kind !== typescript.SyntaxKind.ExportKeyword
          && modifier.kind !== typescript.SyntaxKind.DefaultKeyword,
      ),
      handler.asteriskToken,
      handler.name,
      handler.typeParameters,
      handler.parameters,
      handler.type,
      handler.body,
    );
  }

  const handlerSource = typescript
    .createPrinter()
    .printNode(typescript.EmitHint.Unspecified, handler, sourceFile);

  const moduleSource = expression
    ? `const execute = ${handlerSource};`
    : handlerSource;

  const compiled = typescript.transpileModule(moduleSource, {
    compilerOptions: { target: typescript.ScriptTarget.ES2022 },
  });

  return runInNewContext(
    `${compiled.outputText}\n${expression ? 'execute' : name}`,
    ports,
  );
}
