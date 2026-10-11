import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { describe, it } from 'vitest';

import { systemRoot } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';

/**
 * На паузе не действуют: всё, что меняет бой, останавливается во входе
 * действия и объясняет почему.
 *
 * Приложение на паузе не пропускает урон, эффекты и шаблон области, но без
 * своей проверки действие доходило бы до этого отказа уже начатым — с открытым
 * окном или потраченным зарядом. Проверка `refuseWhilePaused` стоит второй
 * инструкцией входа, сразу за проверкой правки листа.
 */

const require = createRequire(join(systemRoot, 'package.json'));
const typescript = require('typescript');

const COMPOSABLES_DIR = 'src/client/composables';
const LOCK_PATH = `${COMPOSABLES_DIR}/pauseLock.ts`;

/** Имя проверки паузы */
const PAUSE_CHECK = 'refuseWhilePaused';

/** Имя проверки правки листа: проверка паузы идёт сразу за ней */
const SHEET_CHECK = 'refuseWhileSheetEditing';

/** Заголовок уведомления об отказе */
const PAUSE_TOAST_TITLE = 'Игра на паузе';

/** Входы действий, которые меняют бой, — их пауза останавливает */
const PAUSED_ENTRIES = [
  { path: `${COMPOSABLES_DIR}/spellCastFlow.ts`, name: 'startSpellCast' },
  {
    path: `${COMPOSABLES_DIR}/creatureSpellCast.ts`,
    name: 'startCreatureSpellCast',
  },
  {
    path: `${COMPOSABLES_DIR}/creatureActionRoll.ts`,
    name: 'startCreatureAction',
  },
  { path: `${COMPOSABLES_DIR}/weaponAttackRoll.ts`, name: 'startWeaponAttack' },
  {
    path: `${COMPOSABLES_DIR}/effectActivationUse.ts`,
    name: 'applyEffectSource',
  },
  {
    path: `${COMPOSABLES_DIR}/effectActivationUse.ts`,
    name: 'applyEntityEffectUse',
  },
  {
    path: `${COMPOSABLES_DIR}/effectActivationUse.ts`,
    name: 'applyEntityItemUse',
  },
  {
    path: `${COMPOSABLES_DIR}/effectActiveAction.ts`,
    name: 'runEntityEffectAction',
  },
  { path: `${COMPOSABLES_DIR}/effectEscapeAction.ts`, name: 'runEffectEscape' },
  { path: `${COMPOSABLES_DIR}/effectEscapeAction.ts`, name: 'runEscapeAs' },
];

/**
 * Объявление функции верхнего уровня по имени.
 *
 * @param {string} path - путь от корня системы
 * @param {string} name - имя функции
 * @returns {object | undefined} узел объявления
 */
function findFunction(path, name) {
  const sourceFile = typescript.createSourceFile(
    path,
    readFileSync(join(systemRoot, path), 'utf8'),
    typescript.ScriptTarget.Latest,
    true,
  );

  return sourceFile.statements.find(
    (statement) =>
      typescript.isFunctionDeclaration(statement)
      && statement.name?.text === name,
  );
}

/**
 * Зовёт ли условие инструкции `if` названную проверку.
 *
 * @param {object | undefined} statement - инструкция
 * @param {string} checkName - имя проверки
 * @returns {boolean} `true`, если это `if` с вызовом проверки в условии
 */
function isCheckStatement(statement, checkName) {
  return Boolean(
    statement
    && typescript.isIfStatement(statement)
    && statement.expression.getText().includes(`${checkName}(`),
  );
}

/**
 * Проверка паузы с подставленным окружением.
 *
 * @param {boolean} canPerformActions - свободен ли пользователь от паузы
 * @returns {Promise<{ refuse: () => boolean, toasts: object[] }>} проверка и
 *   показанные уведомления
 */
async function loadPauseLock(canPerformActions) {
  const toasts = [];

  const refuse = await loadHandler(LOCK_PATH, PAUSE_CHECK, {
    useWorldStore: () => ({ canPerformActions }),
    useSystemToastStore: () => ({ add: (toast) => toasts.push(toast) }),
    PAUSE_LOCK_LABELS: { title: PAUSE_TOAST_TITLE, description: 'почему' },
  });

  return { refuse, toasts };
}

describe('пауза останавливает действия', () => {
  it('на паузе действие отклоняется с сообщением', async () => {
    const lock = await loadPauseLock(false);

    assert.equal(lock.refuse(), true);

    assert.deepEqual(
      lock.toasts.map((toast) => toast.title),
      [PAUSE_TOAST_TITLE],
    );
  });

  it('без паузы — и у того, кто от неё свободен, — действие идёт молча', async () => {
    const lock = await loadPauseLock(true);

    assert.equal(lock.refuse(), false);
    assert.deepEqual(lock.toasts, []);
  });

  for (const entry of PAUSED_ENTRIES) {
    it(`${entry.name}: проверка паузы — сразу за проверкой правки листа`, () => {
      const declaration = findFunction(entry.path, entry.name);

      assert.ok(declaration?.body, `Не найден вход ${entry.name}`);

      const [first, second] = declaration.body.statements;

      assert.ok(
        isCheckStatement(first, SHEET_CHECK),
        'первой идёт проверка правки листа',
      );

      assert.ok(
        isCheckStatement(second, PAUSE_CHECK),
        'второй идёт проверка паузы — до чтения мира, окон и трат',
      );
    });
  }
});
