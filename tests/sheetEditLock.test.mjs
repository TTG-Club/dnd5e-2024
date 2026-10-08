import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { describe, it } from 'vitest';

import { listClientSources, toSystemPath } from './helpers/clientSources.mjs';
import { loadEntityWrites } from './helpers/combatWrite.mjs';
import { systemRoot } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';
import {
  createActor,
  createCreature,
  createEffect,
  engine,
  withHp,
} from './scenarios/_fixtures.mjs';

/**
 * Лист в режиме правки не действует, а его «Сохранить» не возвращает то, что
 * мир изменил за время правки.
 *
 * Каст и удар с листа пишут в мир, а черновик правки мир не подтягивает:
 * «Сохранить» слало черновик целиком и возвращало ячейку и стрелу. Правило
 * одно на все входы: пока лист сущности в правке, её действия не выполняются
 * (`refuseWhileSheetEditing` — первой инструкцией входа действия, до чтения
 * сущности из мира), а сохранение сливает черновик с миром
 * (`mergeEntityDraft`).
 */

const require = createRequire(join(systemRoot, 'package.json'));
const { parse: parseVue } = require('@vue/compiler-sfc');
const typescript = require('typescript');

const COMPOSABLES_DIR = 'src/client/composables';
const LOCK_PATH = `${COMPOSABLES_DIR}/sheetEditLock.ts`;
const ACTOR_SHEET_PATH = 'src/client/ui/actor/Dnd5eActorSheet.vue';
const CREATURE_SHEET_PATH = 'src/client/ui/creature/CreatureSheet.vue';
const LEFT_PANEL_PATH = 'src/client/ui/actor/ActorLeftPanel.vue';

/** Имя проверки правки: с неё начинается каждый вход действия */
const LOCK_CHECK = 'refuseWhileSheetEditing';

/** Заголовок уведомления об отказе */
const LOCK_TOAST_TITLE = 'Лист в режиме правки';

/** Помощники записи в мир: кто их зовёт, тот пишет */
const WRITE_MODULES = ['entitySheetWrite', 'entityCombatWrite'];

/**
 * Полный перечень входов действий в общих модулях и чем их позвать так, чтобы
 * до проверки листа дошло только чтение своих аргументов. Любой другой вызов
 * упал бы на неизвестном имени: в окружении нет ничего, кроме проверки.
 */
const GUARDED_ENTRIES = [
  {
    path: `${COMPOSABLES_DIR}/spellCastFlow.ts`,
    name: 'startSpellCast',
    call: (entry) => entry({ id: 'spell' }, { casterId: 'hero' }),
  },
  {
    path: `${COMPOSABLES_DIR}/creatureSpellCast.ts`,
    name: 'startCreatureSpellCast',
    call: (entry) => entry({ id: 'spell' }, undefined, { creatureId: 'hero' }),
  },
  {
    path: `${COMPOSABLES_DIR}/creatureActionRoll.ts`,
    name: 'startCreatureAction',
    call: (entry) => entry({ name: 'Укус' }, { creatureId: 'hero' }),
  },
  {
    path: `${COMPOSABLES_DIR}/weaponAttackRoll.ts`,
    name: 'startWeaponAttack',
    call: (entry) => entry({ name: 'Лук' }, { attackerId: 'hero' }),
  },
  {
    path: `${COMPOSABLES_DIR}/effectActivationUse.ts`,
    name: 'applyEffectSource',
    call: (entry) => entry({ name: 'Зелье' }, { id: 'hero' }, 0, () => {}),
  },
  {
    path: `${COMPOSABLES_DIR}/effectActivationUse.ts`,
    name: 'applyEntityEffectUse',
    call: (entry) => entry('hero', 'effect'),
  },
  {
    path: `${COMPOSABLES_DIR}/effectActivationUse.ts`,
    name: 'applyEntityItemUse',
    call: (entry) => entry('hero', 'item'),
  },
  {
    path: `${COMPOSABLES_DIR}/effectToggle.ts`,
    name: 'toggleEntityEffect',
    call: (entry) => entry('hero', 'effect'),
  },
  {
    path: `${COMPOSABLES_DIR}/itemEffectToggle.ts`,
    name: 'toggleEntityItemEffect',
    call: (entry) => entry('hero', 'item', 'effect'),
  },
  {
    path: `${COMPOSABLES_DIR}/effectActiveAction.ts`,
    name: 'runEntityEffectAction',
    call: (entry) => entry('hero', 'effect'),
  },
  {
    path: `${COMPOSABLES_DIR}/effectEscapeAction.ts`,
    name: 'runEffectEscape',
    call: (entry) => entry('hero', 'effect'),
  },
  {
    path: `${COMPOSABLES_DIR}/effectEscapeAction.ts`,
    name: 'runEscapeAs',
    call: (entry) =>
      entry(
        { id: 'hero' },
        { escape: {} },
        { role: 'carrier', entity: { id: 'hero' } },
      ),
  },
  {
    path: `${COMPOSABLES_DIR}/spellCasts.ts`,
    name: 'endEntityConcentration',
    call: (entry) =>
      entry('hero', {
        concentration: true,
        castId: 'cast',
        sourceActorId: 'hero',
      }),
  },
];

/**
 * Входы действий, которые живут в самих листах: отдых, спасбросок от смерти.
 * Их проверяет разбор исходника — компонент целиком здесь не поднять.
 */
const SHEET_ENTRIES = [
  { path: ACTOR_SHEET_PATH, name: 'handleRest' },
  { path: ACTOR_SHEET_PATH, name: 'handleLongRestApply' },
  { path: ACTOR_SHEET_PATH, name: 'handleShortRestApply' },
  { path: CREATURE_SHEET_PATH, name: 'handleRest' },
  { path: LEFT_PANEL_PATH, name: 'rollDeathSave' },
];

/**
 * Функции листов, которые зовут проверку правки не первой инструкцией, — с
 * причиной. Новая функция интерфейса с проверкой обязана быть либо входом
 * ({@link SHEET_ENTRIES}), либо строкой здесь.
 */
const SHEET_LATE_CHECKS = {
  [`${ACTOR_SHEET_PATH}:handleItemTransferDrop`]:
    'сначала узнаёт, что бросили именно передачу предмета: иная нагрузка идёт дальше по цепочке',
  [`${CREATURE_SHEET_PATH}:handleItemTransferDrop`]:
    'сначала узнаёт, что бросили именно передачу предмета: иная нагрузка идёт дальше по цепочке',
};

/**
 * Функции пишущих модулей, которые зовёт интерфейс, но проверки листа в них
 * нет — с причиной. Новая функция без проверки и без строки здесь роняет тест.
 */
const UNGUARDED_REASONS = {
  createSpellCasterPort: 'фабрика порта: пишет только охраняемый разбор каста',
  createCreatureSpellCasterPort:
    'фабрика порта: пишет только охраняемый разбор каста',
  createWeaponAttackPort: 'фабрика порта: пишет только охраняемый удар',
  hasActionSelfEffects: 'ничего не пишет',
  isItemTransferDrop: 'ничего не пишет: только читает нагрузку события',
  listEscapeHelpOffers: 'ничего не пишет',
  formatEscapeTitle: 'ничего не пишет',
  listSelfEscapeEffects: 'ничего не пишет',
  readEntityCounters: 'ничего не пишет',
  runRestWithTriggers:
    'отдых останавливают входы листа (handleRest и «Применить» окна отдыха); тест ниже',
  dispatchAttackRollTriggers:
    'бросок окна, открытого охраняемым входом; цель в правке не действует',
  reportAttackRoll:
    'бросок окна, открытого охраняемым входом; цель в правке не действует',
  removeEntityCondition:
    'плитка состояния: в мир пишет только лист в просмотре, в правке меняется черновик (тест ниже)',
  useEntityActiveEffects:
    'правка эффектов владельцем: пишет в черновик листа, в мир уходит с «Сохранить»',
  useItemTransfer:
    'лист в режиме правки жест передачи не принимает и говорит почему (тест ниже)',
};

/**
 * Прямые записи в мир из интерфейса мимо общих модулей: где они есть и почему
 * это не действие листа. Новая запись из компонента без строки здесь роняет
 * тест — действие обязано идти через вход с проверкой правки.
 */
const DIRECT_WORLD_WRITES = {
  [ACTOR_SHEET_PATH]: 'сам лист: «Сохранить» и запись вне режима правки',
  [CREATURE_SHEET_PATH]: 'сам лист: «Сохранить» и запись вне режима правки',
  'src/client/ui/actor/ActorSettingsModal.vue':
    'окно настроек: своя запись поверх сущности мира, не черновика',
  'src/client/ui/creature/CreatureSettingsModal.vue':
    'окно настроек: своя запись поверх сущности мира, не черновика',
  'src/client/ui/actor/ActorDeleteConfirmModal.vue':
    'удаление персонажа с подтверждением',
  'src/client/ui/creature/CreatureDeleteConfirmModal.vue':
    'удаление существа с подтверждением',
  'src/client/ui/actor/QuickEquipmentModal.vue':
    'быстрая панель: правка полей сущности мира, действия — общими входами',
  'src/client/ui/actor/QuickSpellsModal.vue':
    'быстрая панель: правка полей сущности мира, действия — общими входами',
  'src/client/ui/creature/QuickCreatureActionsModal.vue':
    'быстрая панель: правка полей сущности мира, действия — общими входами',
  'src/client/ui/compendium/CompendiumDataModal.vue':
    'создание существа мира из записи компендиума',
};

/** Чем интерфейс мог бы писать в мир сам, мимо входа действия */
const DIRECT_WORLD_WRITE_PATTERN =
  /\b(?:changeEntitySheet|changeEntityCombatState|sendComputedCombatState|sendTriggerUsageSpend|requestEndCasts|emitSystemClientEvent|emitEntityUpdate)\(|'(?:actor|creature):(?:updated|created|deleted)'/u;

/**
 * Исходник от корня системы.
 *
 * @param {string} path - путь от корня
 * @returns {string} текст
 */
function readSource(path) {
  return readFileSync(join(systemRoot, path), 'utf8');
}

/**
 * Модули composables, которые сами или через соседей зовут помощники записи.
 *
 * @returns {string[]} имена модулей без расширения
 */
function listWritingModules() {
  const modules = readdirSync(join(systemRoot, COMPOSABLES_DIR))
    .filter((file) => file.endsWith('.ts'))
    .map((file) => file.slice(0, -'.ts'.length));

  const importsOf = new Map(
    modules.map((name) => [
      name,
      [
        ...readSource(`${COMPOSABLES_DIR}/${name}.ts`).matchAll(
          /^import (?!type)[^;]*?from '\.\/(\w+)'/gmu,
        ),
      ].map((match) => match[1]),
    ]),
  );

  const writing = new Set(WRITE_MODULES);

  for (let grew = true; grew;) {
    grew = false;

    for (const [name, imports] of importsOf) {
      if (!writing.has(name) && imports.some((dep) => writing.has(dep))) {
        writing.add(name);
        grew = true;
      }
    }
  }

  return [...writing].filter((name) => !WRITE_MODULES.includes(name));
}

/**
 * Объявления функций исходника по именам: у компонента — из `script setup`.
 *
 * @param {string} path - путь от корня системы
 * @returns {Map<string, object>} узлы объявлений функций верхнего уровня
 */
function readFunctionDeclarations(path) {
  const content = readSource(path);

  const script = path.endsWith('.vue')
    ? parseVue(content).descriptor.scriptSetup.content
    : content;

  const sourceFile = typescript.createSourceFile(
    path,
    script,
    typescript.ScriptTarget.Latest,
    true,
  );

  return new Map(
    sourceFile.statements
      .filter(
        (statement) =>
          typescript.isFunctionDeclaration(statement) && statement.name,
      )
      .map((statement) => [statement.name.text, statement]),
  );
}

/**
 * Есть ли в узле вызов функции — сам узел или вложенный.
 *
 * @param {object} node - узел разбора
 * @param {(call: object) => boolean} matches - какой вызов искать
 * @returns {boolean} `true`, если такой вызов есть
 */
function hasCall(node, matches) {
  if (typescript.isCallExpression(node) && matches(node)) {
    return true;
  }

  return Boolean(
    typescript.forEachChild(node, (child) => hasCall(child, matches)),
  );
}

/**
 * Вызов ли это проверки правки.
 *
 * @param {object} node - узел разбора
 * @returns {boolean} `true` у вызова `refuseWhileSheetEditing(…)`
 */
function isLockCall(node) {
  return (
    typescript.isCallExpression(node)
    && typescript.isIdentifier(node.expression)
    && node.expression.text === LOCK_CHECK
  );
}

/**
 * Начинается ли функция с проверки правки: первая инструкция — `if` из одних
 * вызовов проверки (через «или» — когда действуют двое), а её аргументы
 * ничего не вызывают. Вызов в аргументе — это чтение мира до проверки: так
 * удар с несохранённого листа и выходил молча.
 *
 * @param {object | undefined} declaration - объявление функции
 * @returns {boolean} `true`, если проверка стоит первой
 */
function startsWithLockCheck(declaration) {
  const first = declaration?.body?.statements[0];

  if (!first || !typescript.isIfStatement(first)) {
    return false;
  }

  /**
   * Вызовы условия, разобранного по «или».
   *
   * @param {object} expression - условие или его часть
   * @returns {object[]} операнды
   */
  const operandsOf = (expression) =>
    typescript.isBinaryExpression(expression)
    && expression.operatorToken.kind === typescript.SyntaxKind.BarBarToken
      ? [...operandsOf(expression.left), ...operandsOf(expression.right)]
      : [expression];

  return operandsOf(first.expression).every(
    (operand) =>
      isLockCall(operand)
      && operand.arguments.every((argument) => !hasCall(argument, () => true)),
  );
}

/**
 * Зовёт ли функция проверку правки где-либо в теле.
 *
 * @param {object} declaration - объявление функции
 * @returns {boolean} `true`, если проверка в теле есть
 */
function callsLockCheck(declaration) {
  return Boolean(declaration.body && hasCall(declaration.body, isLockCall));
}

/**
 * Настоящие функции отметки с общим состоянием и поддельным уведомлением.
 *
 * @returns {Promise<object>} функции отметки и журнал уведомлений
 */
async function loadLock() {
  const toasts = [];

  const ports = {
    editingSheetCounts: new Map(),
    useSystemToastStore: () => ({ add: (toast) => toasts.push(toast) }),
    SHEET_EDIT_LOCK_LABELS: {
      title: LOCK_TOAST_TITLE,
      description: '…',
    },
  };

  for (const name of [
    'holdSheetEdit',
    'releaseSheetEdit',
    'isSheetEditing',
    'refuseWhileSheetEditing',
  ]) {
    ports[name] = await loadHandler(LOCK_PATH, name, ports);
  }

  return { ...ports, toasts };
}

describe('отметка «лист в правке»', () => {
  it('действие сущности с листом в правке отклоняется с сообщением; чужой лист не мешает', async () => {
    const lock = await loadLock();

    assert.equal(lock.refuseWhileSheetEditing('hero'), false);

    lock.holdSheetEdit('hero');

    assert.equal(lock.refuseWhileSheetEditing('hero'), true);
    assert.equal(lock.refuseWhileSheetEditing('wolf'), false);
    assert.equal(lock.refuseWhileSheetEditing(undefined), false);

    assert.deepEqual(
      lock.toasts.map((toast) => toast.title),
      [LOCK_TOAST_TITLE],
    );

    // Два открытых листа одной сущности: отметку снимает последний
    lock.holdSheetEdit('hero');
    lock.releaseSheetEdit('hero');
    assert.equal(lock.isSheetEditing('hero'), true);

    lock.releaseSheetEdit('hero');
    assert.equal(lock.isSheetEditing('hero'), false);
  });

  it('лист держит отметку, пока он в правке, и снимает её при закрытии', async () => {
    const lock = await loadLock();
    const watchers = [];
    const disposers = [];

    const useSheetEditLock = await loadHandler(LOCK_PATH, 'useSheetEditLock', {
      ...lock,
      watch: (source, handler, options) => {
        assert.equal(options.flush, 'sync', 'отметка ставится сразу');
        watchers.push(() => handler(source()));
        handler(source());
      },
      onScopeDispose: (dispose) => disposers.push(dispose),
    });

    const sheet = { entityId: 'hero', editing: false };

    useSheetEditLock(
      () => sheet.entityId,
      () => sheet.editing,
    );

    assert.equal(lock.isSheetEditing('hero'), false);

    sheet.editing = true;
    watchers[0]();
    assert.equal(lock.isSheetEditing('hero'), true);

    sheet.editing = false;
    watchers[0]();
    assert.equal(lock.isSheetEditing('hero'), false);

    // Лист закрыли посреди правки
    sheet.editing = true;
    watchers[0]();
    disposers[0]();
    assert.equal(lock.isSheetEditing('hero'), false);

    // Лист без сущности (черновик ещё не собран) отметку не держит
    sheet.entityId = undefined;
    watchers[0]();
    assert.equal(lock.editingSheetCounts.size, 0);
  });
});

describe('входы действий проверяют лист первым делом', () => {
  for (const entry of GUARDED_ENTRIES) {
    it(`${entry.name}: лист в правке — ничего не читает, не тратит и не пишет`, async () => {
      const asked = [];

      const handler = await loadHandler(entry.path, entry.name, {
        ...entry.ports,
        refuseWhileSheetEditing: (entityId) => {
          asked.push(entityId);

          return true;
        },
      });

      // Всё, что вход сделал бы дальше, в окружение не дано: дойди он до
      // чтения мира, окна или записи — упал бы на неизвестном имени
      entry.call(handler);

      assert.deepEqual(asked, ['hero']);
    });
  }

  it('каждая функция пишущего модуля, которую зовёт интерфейс, проверяет лист либо названа с причиной', () => {
    const interfaceSources = listClientSources()
      .filter((path) => !toSystemPath(path).startsWith(COMPOSABLES_DIR))
      .map((path) => readFileSync(path, 'utf8'));

    const called = listWritingModules().flatMap((moduleName) => {
      const path = `${COMPOSABLES_DIR}/${moduleName}.ts`;
      const source = readSource(path);
      const declarations = readFunctionDeclarations(path);

      return [...source.matchAll(/^export (?:async )?function (\w+)/gmu)]
        .map((match) => match[1])
        .filter((name) =>
          interfaceSources.some((text) =>
            new RegExp(`\\b${name}\\(`, 'u').test(text),
          ),
        )
        .map((name) => ({
          path,
          name,
          guarded: startsWithLockCheck(declarations.get(name)),
        }));
    });

    assert.deepEqual(
      called
        .filter((entry) => !entry.guarded)
        .map((entry) => entry.name)
        .sort(),
      Object.keys(UNGUARDED_REASONS).sort(),
    );

    // Перечень входов полон: каждая функция с проверкой, которую зовёт
    // интерфейс, проходит тест вызова выше
    const listed = new Set(
      GUARDED_ENTRIES.map((entry) => `${entry.path}:${entry.name}`),
    );

    assert.deepEqual(
      called
        .filter((entry) => entry.guarded)
        .map((entry) => `${entry.path}:${entry.name}`)
        .filter((key) => !listed.has(key)),
      [],
    );
  });

  it('проверка стоит первой инструкцией каждого входа, и её аргументы не читают мир', () => {
    // Общие модули: проверка где-то в теле — мало. Удар оружием проверял лист
    // по сущности, прочитанной из мира, и на несохранённом листе до проверки
    // не доходил
    const late = readdirSync(join(systemRoot, COMPOSABLES_DIR))
      .filter((file) => file.endsWith('.ts'))
      .map((file) => `${COMPOSABLES_DIR}/${file}`)
      .filter((path) => path !== LOCK_PATH)
      .flatMap((path) =>
        [...readFunctionDeclarations(path)]
          .filter(
            ([, declaration]) =>
              callsLockCheck(declaration) && !startsWithLockCheck(declaration),
          )
          .map(([name]) => `${path}:${name}`),
      );

    assert.deepEqual(late, []);

    for (const entry of [...GUARDED_ENTRIES, ...SHEET_ENTRIES]) {
      assert.ok(
        startsWithLockCheck(
          readFunctionDeclarations(entry.path).get(entry.name),
        ),
        `${entry.path}: ${entry.name} не начинается с проверки правки`,
      );
    }
  });

  it('в интерфейсе проверку зовут только входы листа из перечня', () => {
    const sheetEntries = new Set(
      SHEET_ENTRIES.map((entry) => `${entry.path}:${entry.name}`),
    );

    const checking = listClientSources()
      .map(toSystemPath)
      .filter((path) => !path.startsWith(COMPOSABLES_DIR))
      .filter((path) => readSource(path).includes(`${LOCK_CHECK}(`))
      .flatMap((path) =>
        [...readFunctionDeclarations(path)]
          .filter(([, declaration]) => callsLockCheck(declaration))
          .map(([name]) => `${path}:${name}`),
      );

    assert.deepEqual(
      checking.filter((key) => !sheetEntries.has(key)).sort(),
      Object.keys(SHEET_LATE_CHECKS).sort(),
    );

    assert.deepEqual(
      [...sheetEntries].filter((key) => !checking.includes(key)),
      [],
    );
  });

  it('интерфейс не пишет в мир сам: запись из компонента — только из названных мест', () => {
    const writing = listClientSources()
      .map(toSystemPath)
      .filter((path) => !path.startsWith(COMPOSABLES_DIR))
      .filter((path) => DIRECT_WORLD_WRITE_PATTERN.test(readSource(path)));

    assert.deepEqual(writing.sort(), Object.keys(DIRECT_WORLD_WRITES).sort());
  });

  it('оба листа держат отметку правки на id черновика', () => {
    for (const path of [ACTOR_SHEET_PATH, CREATURE_SHEET_PATH]) {
      assert.match(
        readSource(path),
        /useSheetEditLock\(\s*\(\) => local\w+\.value\?\.id,/u,
      );
    }
  });

  it('передачу предмета лист в правке не принимает и говорит почему', () => {
    for (const path of [ACTOR_SHEET_PATH, CREATURE_SHEET_PATH]) {
      const source = readSource(path);
      const start = source.indexOf('function handleItemTransferDrop');
      const body = source.slice(start, source.indexOf('\n  }\n', start));

      // Отказ — до приёма: приём сразу вынимает предмет у отправителя
      assert.match(
        body,
        /if \(isEditMode\.value\) \{\s*return \(\s*isItemTransferDrop\(event\)\s*&& refuseWhileSheetEditing\(local\w+\.value\??\.id\)\s*\);\s*\}[\s\S]*receiveTransferredItem\(/u,
        `${path}: передача в режиме правки`,
      );
    }
  });

  it('плитка состояния пишет в мир только в просмотре; в правке меняет черновик', () => {
    const source = readSource('src/client/ui/actor/ActiveEffectsPanel.vue');
    const start = source.indexOf('function handleConditionTile');
    const body = source.slice(start, source.indexOf('\n  }\n', start));

    assert.match(
      body,
      /owner\s*&& !props\.isEditMode\s*&& isConditionActive\(key\)\s*&& removeEntityCondition\(owner\.id, key\)/u,
    );

    // «Прервать концентрацию» идёт общим входом — он и проверяет правку
    assert.match(
      source,
      /function endConcentration\(effect: ActiveEffect\): void \{\s*endEntityConcentration\(props\.owner\?\.id, effect\);\s*\}/u,
    );
  });

  it('отметка правки стоит на том же id, с которым действуют вкладки листа', () => {
    // Лист нового, ещё не сохранённого персонажа: `props.actorId` пуст, а
    // вкладки действуют от id черновика — отметка на `props.actorId` такой
    // лист не закрывала, и «Применить» у заклинания молча ничего не делало
    const sheet = readSource('src/client/ui/actor/Dnd5eActorSheet.vue');

    assert.match(
      sheet,
      /<ActorTabs\s+(?:v-if="localActor"\s+)?:actor="localActor"/u,
      'вкладки получают черновик листа',
    );

    const spellsTab = readSource('src/client/ui/actor/tabs/ActorSpellsTab.vue');

    assert.match(
      spellsTab,
      /createSpellCasterPort\(props\.actor\.id, refuseSpellCast\)/u,
    );

    assert.match(
      spellsTab,
      /function castSpell\(sourceSpell: Spell\): void \{\s*startSpellCast\(sourceSpell, createSheetCasterPort\(\)\);\s*\}/u,
      'каст с листа идёт общим входом — он и проверяет правку',
    );

    // Кнопку каста и плитку урона строки правка не гасит и не прячет
    const row = readSource('src/client/ui/actor/ActorSpellRow.vue');

    assert.doesNotMatch(row, /isEditMode/u);
  });

  it('пункты «Применить» и переключатели предмета правка не гасит: причину говорит вход действия', () => {
    const source = readSource('src/client/ui/actor/tabs/ActorEquipmentTab.vue');
    const start = source.indexOf('function getItemMenuItems');
    const body = source.slice(start, source.indexOf('\n  }\n', start));

    assert.ok(body.includes('onSelect: () => applyItemUse(item)'));
    assert.ok(body.includes('toggleEntityItemEffect(props.entity.id'));

    // Погашенный пункт молчит; щелчок доходит до `refuseWhileSheetEditing`
    assert.doesNotMatch(body, /disabled:[^\n]*isEditMode/u);

    const use = source.indexOf('function applyItemUse');

    assert.ok(
      source
        .slice(use, source.indexOf('\n  }\n', use))
        .includes('applyEntityItemUse(props.entity.id, item.id)'),
    );
  });

  it('кнопки действий вкладки эффектов правка не гасит: причину говорит вход действия', () => {
    const source = readSource('src/client/ui/actor/ActiveEffectsPanel.vue');

    // «Применить», «Вырваться», «При действии»: погашенная кнопка молчит, а
    // щелчок доходит до `refuseWhileSheetEditing` и объясняет отказ
    for (const handler of [
      'applyUseEffect(effect)',
      'escapeEffect(effect)',
      'runActiveAction(effect)',
    ]) {
      const buttons = [...source.matchAll(/<UButton[^>]*>/gu)]
        .map((match) => match[0])
        .filter((button) => button.includes(handler));

      assert.ok(buttons.length > 0, `кнопка ${handler} не найдена`);

      for (const button of buttons) {
        assert.doesNotMatch(button, /:disabled="[^"]*isEditMode/u, handler);
      }
    }

    const start = source.indexOf('function isApplyDisabled');
    const body = source.slice(start, source.indexOf('\n  }\n', start));

    assert.doesNotMatch(body, /isEditMode/u);
  });
});

describe('несохранённый лист и концентрация: отказ с уведомлением', () => {
  /** Id черновика нового листа: в мире такой сущности ещё нет */
  const DRAFT_ID = 'actor_draft';

  /** Мир без сущности нового листа */
  const emptyWorld = () => ({ findCurrentDndEntity: () => undefined });

  /**
   * Заголовки уведомлений отметки.
   *
   * @param {object} lock - функции отметки
   * @returns {string[]} заголовки
   */
  const titlesOf = (lock) => lock.toasts.map((toast) => toast.title);

  it('удар оружием с несохранённого листа просит сохранить лист; вне правки идёт как раньше', async () => {
    const lock = await loadLock();
    const costs = [];

    const ports = {
      refuseWhileSheetEditing: lock.refuseWhileSheetEditing,
      useWorldEntities: emptyWorld,
      spendShotAmmunition: () => assert.fail('боеприпас не тратится'),
      runWithWeaponAttackCost: (attacker, name) =>
        costs.push([attacker.id, name]),
    };

    const createWeaponAttackPort = await loadHandler(
      `${COMPOSABLES_DIR}/weaponAttackRoll.ts`,
      'createWeaponAttackPort',
      ports,
    );

    const startWeaponAttack = await loadHandler(
      `${COMPOSABLES_DIR}/weaponAttackRoll.ts`,
      'startWeaponAttack',
      ports,
    );

    const dagger = { id: 'item_dagger', name: 'Кинжал' };

    /** Удар с листа: порт собирает та же фабрика, что у вкладки снаряжения */
    const strike = () =>
      startWeaponAttack(
        dagger,
        createWeaponAttackPort(DRAFT_ID, () => assert.fail('отказа входа нет')),
      );

    // Новый лист в правке: сущности в мире нет, а ответ есть
    lock.holdSheetEdit(DRAFT_ID);
    strike();

    assert.deepEqual(titlesOf(lock), [LOCK_TOAST_TITLE]);
    assert.deepEqual(costs, []);

    // Вне правки: сущности нет — тихий выход, как раньше
    lock.releaseSheetEdit(DRAFT_ID);
    strike();

    assert.deepEqual(titlesOf(lock), [LOCK_TOAST_TITLE]);
    assert.deepEqual(costs, []);

    // Вне правки с сущностью мира удар идёт дальше
    ports.useWorldEntities = () => ({
      findCurrentDndEntity: (id) => ({ id }),
    });

    strike();

    assert.deepEqual(costs, [[DRAFT_ID, 'Кинжал']]);
    assert.deepEqual(titlesOf(lock), [LOCK_TOAST_TITLE]);
  });

  it('«Использовать» у предмета и «Применить» у умения с несохранённого листа просят сохранить лист', async () => {
    const lock = await loadLock();
    const applied = [];

    const potion = { id: 'item_potion', name: 'Зелье лечения' };

    const ports = {
      refuseWhileSheetEditing: lock.refuseWhileSheetEditing,
      useWorldEntities: emptyWorld,
      canUseItem: () => true,
      buildItemUseSpell: (item) => ({ name: item.name }),
      resolveEntityStats: () => ({ spellSaveDC: 10 }),
      resolveEffectUseCost: () => undefined,
      buildItemUseSpend: () => ({}),
      applyEffectSource: (spell, user) => applied.push([user.id, spell.name]),
    };

    const applyEntityItemUse = await loadHandler(
      `${COMPOSABLES_DIR}/effectActivationUse.ts`,
      'applyEntityItemUse',
      ports,
    );

    const applyEntityEffectUse = await loadHandler(
      `${COMPOSABLES_DIR}/effectActivationUse.ts`,
      'applyEntityEffectUse',
      ports,
    );

    lock.holdSheetEdit(DRAFT_ID);
    applyEntityItemUse(DRAFT_ID, potion.id);
    applyEntityEffectUse(DRAFT_ID, 'effect_use');

    assert.deepEqual(titlesOf(lock), [LOCK_TOAST_TITLE, LOCK_TOAST_TITLE]);
    assert.deepEqual(applied, []);

    // Вне правки: сущности нет — тихий выход, как раньше
    lock.releaseSheetEdit(DRAFT_ID);
    applyEntityItemUse(DRAFT_ID, potion.id);

    assert.equal(lock.toasts.length, 2);
    assert.deepEqual(applied, []);

    // Вне правки с сущностью мира применение идёт дальше
    ports.useWorldEntities = () => ({
      findCurrentDndEntity: (id) => ({ id, equipment: [potion] }),
    });

    applyEntityItemUse(DRAFT_ID, potion.id);

    assert.deepEqual(applied, [[DRAFT_ID, 'Зелье лечения']]);
    assert.equal(lock.toasts.length, 2);
  });

  it('«Прервать концентрацию» в правке — уведомление, каст цел; вне правки каст заканчивается', async () => {
    const lock = await loadLock();
    const ended = [];

    const endEntityConcentration = await loadHandler(
      `${COMPOSABLES_DIR}/spellCasts.ts`,
      'endEntityConcentration',
      {
        refuseWhileSheetEditing: lock.refuseWhileSheetEditing,
        requestEndCasts: (casterId, castIds) =>
          ended.push([casterId, [...castIds]]),
      },
    );

    const mark = {
      concentration: true,
      castId: 'cast_heroism',
      sourceActorId: 'actor_bard',
    };

    lock.holdSheetEdit('actor_bard');
    endEntityConcentration('actor_bard', mark);

    // Один отказ — одно уведомление: носитель метки и заклинатель совпали
    assert.deepEqual(titlesOf(lock), [LOCK_TOAST_TITLE]);
    assert.deepEqual(ended, []);

    lock.releaseSheetEdit('actor_bard');
    endEntityConcentration('actor_bard', mark);

    assert.deepEqual(ended, [['actor_bard', ['cast_heroism']]]);
    assert.equal(lock.toasts.length, 1);

    // Не метка концентрации — заканчивать нечего
    endEntityConcentration('actor_bard', { ...mark, castId: undefined });

    assert.equal(ended.length, 1);
  });
});

describe('«Сохранить» сливает черновик с миром', () => {
  /** Хиты героя */
  const HERO_HP = 30;

  /** Заклинание с зарядом */
  const MISTY_STEP = {
    id: 'spell_step',
    name: 'Туманный шаг',
    level: 2,
    uses: { max: 2, current: 2, recovery: 'longRest' },
  };

  /** Заклинание, которое владелец правит */
  const FIRE_BOLT = { id: 'spell_bolt', name: 'Огненный снаряд', level: 0 };

  /** Стрелы */
  const ARROWS = { id: 'item_arrows', name: 'Стрелы', quantity: 20 };

  /**
   * Герой с ячейками, заклинаниями и стрелами.
   *
   * @returns {object} персонаж
   */
  function hero() {
    const actor = withHp(createActor, HERO_HP, {
      spells: [structuredClone(MISTY_STEP), structuredClone(FIRE_BOLT)],
      equipment: [structuredClone(ARROWS)],
    });

    actor.system = {
      ...actor.system,
      spellSlotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    };

    return actor;
  }

  it('панель + лист в правке + «Сохранить»: потраченное не возвращается, правки владельца остаются', async () => {
    const world = new Map([['actor_hero', hero()]]);

    const { changeEntitySheet, changeEntityCombatState } =
      await loadEntityWrites({ world });

    // Вход в правку: снимок и черновик — копии мира
    const savedSnapshot = structuredClone(world.get('actor_hero'));
    const draft = structuredClone(savedSnapshot);

    // За время правки мир меняется: ячейка, заряд, стрела, урон, эффект
    changeEntitySheet('actor_hero', (current) => ({
      ...current,
      system: {
        ...current.system,
        spellSlotsUsed: [1, 0, 0, 0, 0, 0, 0, 0, 0],
      },
      spells: engine.withSpentSpellUse(current.spells, MISTY_STEP.id),
      equipment: current.equipment.map((item) => ({
        ...item,
        quantity: item.quantity - 1,
      })),
    }));

    // Боевой снимок правит мир ответом сервера — здесь он приходит сразу
    changeEntityCombatState('actor_hero', (current) => current);

    engine.writeEntityHitPoints(world.get('actor_hero'), {
      current: HERO_HP - 7,
      temp: 0,
    });

    world.get('actor_hero').activeEffects = [createEffect('effect_bless')];

    // Владелец правит своё: имя, силу, описание заклинания, новый предмет
    draft.name = 'Гримли Старший';
    draft.system.abilities.strength = 18;
    draft.spells[1].description = 'Жжёт';
    draft.equipment.push({ id: 'item_rope', name: 'Верёвка', quantity: 1 });

    const resolveActorToSave = await loadHandler(
      'src/client/ui/actor/Dnd5eActorSheet.vue',
      'resolveActorToSave',
      {
        storeActor: { value: world.get('actor_hero') },
        isEditMode: { value: true },
        savedSnapshot: { value: savedSnapshot },
        mergeEntityDraft: engine.mergeEntityDraft,
        isDndActorRecord: engine.isDndActorRecord,
      },
    );

    const saved = resolveActorToSave(draft);

    // Мир — что владелец не трогал
    assert.equal(saved.system.spellSlotsUsed[0], 1, 'ячейка остаётся списана');
    assert.equal(saved.spells[0].uses.current, 1, 'заряд остаётся списан');
    assert.equal(saved.equipment[0].quantity, 19, 'стрела остаётся списана');
    assert.equal(engine.resolveEntityCurrentHp(saved), HERO_HP - 7);

    assert.deepEqual(
      saved.activeEffects.map((effect) => effect.id),
      ['effect_bless'],
    );

    // Черновик — что владелец правил
    assert.equal(saved.name, 'Гримли Старший');
    assert.equal(saved.system.abilities.strength, 18);
    assert.equal(saved.spells[1].description, 'Жжёт');

    assert.deepEqual(
      saved.equipment.map((item) => item.id),
      ['item_arrows', 'item_rope'],
    );

    // Слитое не делит объекты ни с миром, ни с черновиком
    assert.notEqual(saved.system, world.get('actor_hero').system);
    assert.notEqual(saved.spells[1], draft.spells[1]);
  });

  it('эффекты, снятые миром за время правки: нетронутые не возвращаются, правленный владельцем остаётся', async () => {
    // Каст закончился в мире, пока лист был в правке (конец хода, другой
    // игрок, срабатывание сервера): метка концентрации и эффект каста сняты
    const base = hero();

    base.activeEffects = [
      createEffect('effect_mark', { concentration: true, castId: 'cast_a' }),
      createEffect('effect_heroism', { castId: 'cast_a' }),
      createEffect('effect_own'),
    ];

    const world = structuredClone(base);

    world.activeEffects = [structuredClone(base.activeEffects[2])];

    /**
     * Что уйдёт по «Сохранить» из черновика с такой правкой.
     *
     * @param {(draft: object) => void} edit - правка владельца
     * @returns {Promise<string[]>} id эффектов записи
     */
    async function savedEffectIds(edit) {
      const draft = structuredClone(base);

      edit(draft);

      const resolveActorToSave = await loadHandler(
        ACTOR_SHEET_PATH,
        'resolveActorToSave',
        {
          storeActor: { value: world },
          isEditMode: { value: true },
          savedSnapshot: { value: base },
          mergeEntityDraft: engine.mergeEntityDraft,
          isDndActorRecord: engine.isDndActorRecord,
        },
      );

      return resolveActorToSave(draft).activeEffects.map((effect) => effect.id);
    }

    // Черновик с изменениями в другом месте листа: снятое не возвращается
    assert.deepEqual(
      await savedEffectIds((draft) => {
        draft.name = 'Гримли Старший';
        draft.activeEffects[2].name = 'Своё';
      }),
      ['effect_own'],
    );

    // Известное ограничение слияния: эффект, который владелец в правке
    // изменил сам (выключил, переименовал), остаётся его — даже снятый миром.
    // Возвращается он уже без метки концентрации: каста у него нет
    assert.deepEqual(
      await savedEffectIds((draft) => {
        draft.activeEffects[1].disabled = true;
      }),
      ['effect_heroism', 'effect_own'],
    );
  });

  it('вне режима правки и без сущности мира уходит сам черновик', async () => {
    const draft = hero();

    for (const ports of [
      { isEditMode: { value: false }, storeActor: { value: hero() } },
      { isEditMode: { value: true }, storeActor: { value: null } },
    ]) {
      const resolveActorToSave = await loadHandler(
        'src/client/ui/actor/Dnd5eActorSheet.vue',
        'resolveActorToSave',
        {
          savedSnapshot: { value: hero() },
          mergeEntityDraft: () => assert.fail('слияния быть не должно'),
          isDndActorRecord: engine.isDndActorRecord,
          ...ports,
        },
      );

      assert.equal(resolveActorToSave(draft), draft);
    }
  });

  it('лист существа сливает так же', async () => {
    const wolf = withHp(createCreature, HERO_HP, {
      spells: [structuredClone(MISTY_STEP)],
    });

    const world = structuredClone(wolf);
    const draft = structuredClone(wolf);

    world.spells = engine.withSpentSpellUse(world.spells, MISTY_STEP.id);
    draft.name = 'Вожак';

    const resolveCreatureToSave = await loadHandler(
      'src/client/ui/creature/CreatureSheet.vue',
      'resolveCreatureToSave',
      {
        storeCreature: { value: world },
        isEditMode: { value: true },
        savedSnapshot: { value: wolf },
        mergeEntityDraft: engine.mergeEntityDraft,
        isDndCreatureRecord: engine.isDndCreatureRecord,
      },
    );

    const saved = resolveCreatureToSave(draft);

    assert.equal(saved.name, 'Вожак');
    assert.equal(saved.spells[0].uses.current, 1);
  });

  it('оба листа шлют по «Сохранить» слитое', () => {
    assert.match(
      readSource('src/client/ui/actor/Dnd5eActorSheet.vue'),
      /const saved = resolveActorToSave\(localActor\.value\);\s*localActor\.value = saved;\s*props\.socket\.emit\('actor:updated', withoutEntityOwnership\(saved\)\);/u,
    );

    assert.match(
      readSource('src/client/ui/creature/CreatureSheet.vue'),
      /const saved = resolveCreatureToSave\(localCreature\.value\);\s*localCreature\.value = saved;\s*props\.socket!\.emit\('creature:updated', withoutEntityOwnership\(saved\)\);/u,
    );
  });
});

describe('слияние черновика с миром: правила', () => {
  /** Гвард для тестов правил: любое значение */
  const anything = (value) => value !== undefined;

  /**
   * Слияние трёх значений через сущность-обёртку.
   *
   * @param {unknown} base - значение на входе в правку
   * @param {unknown} draft - значение черновика
   * @param {unknown} world - значение мира
   * @returns {unknown} слитое значение
   */
  function merge(base, draft, world) {
    return engine.mergeEntityDraft(
      { value: base },
      { value: draft },
      { value: world },
      anything,
    ).value;
  }

  it('не менял владелец — мир; не менялся мир — черновик; оба — черновик', () => {
    assert.equal(merge(1, 1, 2), 2);
    assert.equal(merge(1, 3, 1), 3);
    assert.equal(merge(1, 3, 2), 3);
    assert.equal(merge(undefined, undefined, 'мир'), 'мир');
    assert.equal(merge('было', 'было', undefined), undefined);
  });

  it('запись сливается по полям, поле, снятое миром, не возвращается', () => {
    assert.deepEqual(
      merge(
        { hp: 10, name: 'а', gone: 1, deep: { left: 1, right: 1 } },
        { hp: 10, name: 'б', gone: 1, deep: { left: 2, right: 1 } },
        { hp: 4, name: 'а', deep: { left: 1, right: 5 }, fresh: true },
      ),
      { hp: 4, name: 'б', deep: { left: 2, right: 5 }, fresh: true },
    );
  });

  it('список записей с id сливается по записям', () => {
    const base = [
      { id: 'a', uses: 2 },
      { id: 'b', uses: 2 },
      { id: 'c', uses: 2 },
      { id: 'd', uses: 2 },
    ];

    // Владелец: правит «b», удаляет «c», добавляет «e»
    const draft = [
      { id: 'a', uses: 2 },
      { id: 'b', uses: 2, note: 'моё' },
      { id: 'd', uses: 2 },
      { id: 'e', uses: 1 },
    ];

    // Мир: тратит «a» и «b», возвращает «c» изменённым, снимает «d», кладёт «f»
    const world = [
      { id: 'a', uses: 1 },
      { id: 'b', uses: 0 },
      { id: 'c', uses: 0 },
      { id: 'f', uses: 3 },
    ];

    assert.deepEqual(merge(base, draft, world), [
      { id: 'a', uses: 1 },
      { id: 'b', uses: 0, note: 'моё' },
      { id: 'e', uses: 1 },
      { id: 'f', uses: 3 },
    ]);
  });

  it('список без id — целиком: правленый владельцем остаётся его', () => {
    assert.deepEqual(merge([1, 2], [1, 2], [3]), [3]);
    assert.deepEqual(merge([1, 2], [1, 2, 5], [3]), [1, 2, 5]);

    // Повторяющийся id — не список записей: по записям его не слить
    assert.deepEqual(
      merge([{ id: 'a' }], [{ id: 'a' }, { id: 'a' }], [{ id: 'b' }]),
      [{ id: 'a' }, { id: 'a' }],
    );
  });

  it('слитое не прошло гвард формы — уходит копия черновика', () => {
    const draft = createActor({ name: 'Черновик' });

    const saved = engine.mergeEntityDraft(
      createActor(),
      draft,
      createActor({ name: 'Мир' }),
      () => false,
    );

    assert.deepEqual(saved, JSON.parse(JSON.stringify(draft)));
    assert.equal(saved.name, 'Черновик');
    assert.notEqual(saved, draft);
  });
});
