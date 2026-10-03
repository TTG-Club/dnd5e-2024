import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
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
 * (`refuseWhileSheetEditing` — первым делом в общем входе действия), а
 * сохранение сливает черновик с миром (`mergeEntityDraft`).
 */

const COMPOSABLES_DIR = 'src/client/composables';
const LOCK_PATH = `${COMPOSABLES_DIR}/sheetEditLock.ts`;

/** Помощники записи в мир: кто их зовёт, тот пишет */
const WRITE_MODULES = ['entitySheetWrite', 'entityCombatWrite'];

/**
 * Входы действий сущности и чем их позвать так, чтобы до проверки листа
 * дошло только чтение своих аргументов. Любой другой вызов упал бы на
 * неизвестном имени: в окружении нет ничего, кроме проверки.
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
    call: (entry) =>
      entry({ name: 'Лук' }, { readAttacker: () => ({ id: 'hero' }) }),
  },
  {
    path: `${COMPOSABLES_DIR}/effectActivationUse.ts`,
    name: 'applyEffectSource',
    call: (entry) => entry({ name: 'Зелье' }, { id: 'hero' }, 0, () => {}),
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
    ports: { escapeAllowsRole: () => true },
    call: (entry) =>
      entry(
        { id: 'hero' },
        { escape: {} },
        { role: 'carrier', entity: { id: 'hero' } },
      ),
  },
];

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
  buildItemUseSpend: 'ничего не пишет: расход исполняет applyEffectSource',
  listEscapeHelpOffers: 'ничего не пишет',
  readEntityCounters: 'ничего не пишет',
  payEntityActivation: 'ничего не пишет: считает копию',
  warnNoCounter: 'ничего не пишет: уведомление',
  applyEntityEffectUse: 'идёт через applyEffectSource',
  applyEntityItemUse: 'идёт через applyEffectSource',
  runRestWithTriggers:
    'отдых останавливает лист (handleRest) — до окна отдыха; тест ниже',
  dispatchAttackRollTriggers:
    'бросок окна, открытого охраняемым входом; цель в правке не действует',
  reportAttackRoll:
    'бросок окна, открытого охраняемым входом; цель в правке не действует',
  removeEntityCondition: 'правка состояния владельцем, не действие',
  useEntityActiveEffects: 'правка эффектов владельцем, не действие',
  useItemTransfer: 'лист в режиме правки жест передачи не принимает',
};

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

describe('отметка «лист в правке»', () => {
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
        title: 'Лист в режиме правки',
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

  it('действие сущности с листом в правке отклоняется с сообщением; чужой лист не мешает', async () => {
    const lock = await loadLock();

    assert.equal(lock.refuseWhileSheetEditing('hero'), false);

    lock.holdSheetEdit('hero');

    assert.equal(lock.refuseWhileSheetEditing('hero'), true);
    assert.equal(lock.refuseWhileSheetEditing('wolf'), false);
    assert.equal(lock.refuseWhileSheetEditing(undefined), false);

    assert.deepEqual(
      lock.toasts.map((toast) => toast.title),
      ['Лист в режиме правки'],
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

    // Новая сущность и запись компендиума к миру не привязаны
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

    const unguarded = listWritingModules().flatMap((moduleName) => {
      const source = readSource(`${COMPOSABLES_DIR}/${moduleName}.ts`);

      return [...source.matchAll(/^export (?:async )?function (\w+)/gmu)]
        .map((match) => match[1])
        .filter((name) =>
          interfaceSources.some((text) =>
            new RegExp(`\\b${name}\\(`, 'u').test(text),
          ),
        )
        .filter((name) => {
          const start = source.indexOf(`function ${name}`);
          const body = source.slice(start, source.indexOf('\n}\n', start));

          return !body.includes('refuseWhileSheetEditing(');
        });
    });

    assert.deepEqual(unguarded.sort(), Object.keys(UNGUARDED_REASONS).sort());

    assert.deepEqual(
      GUARDED_ENTRIES.filter(
        (entry) =>
          !readSource(entry.path).includes(`export function ${entry.name}`),
      ),
      [],
    );
  });

  it('отдых останавливают оба листа, и оба держат отметку правки', () => {
    for (const path of [
      'src/client/ui/actor/Dnd5eActorSheet.vue',
      'src/client/ui/creature/CreatureSheet.vue',
    ]) {
      const source = readSource(path);

      assert.match(
        source,
        /function handleRest\(restType: RestType\): void \{\s*\/\/[^\n]*\n\s*if \(![^)]*\|\| refuseWhileSheetEditing\(props\.\w+Id\)\) \{\s*return;/u,
        `${path}: отдых не проверяет режим правки`,
      );

      assert.match(source, /useSheetEditLock\(\s*\(\) => props\.\w+Id,/u);
    }
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
