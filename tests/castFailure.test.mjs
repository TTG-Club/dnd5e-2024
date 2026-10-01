import assert from 'node:assert/strict';

import { it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';

const engine = await loadEngineBundle("export * from './src/engine/index.ts';");

const helperPath = 'src/client/composables/castFailure.ts';

/**
 * Настоящая проверка провала каста с записью чата, оплат и спасбросков.
 *
 * @param {object} options - что подменить
 * @param {number} options.roll - что выпадет на к100
 * @param {object | null} options.save - исход спасброска; `null` — окно закрыли
 * @returns {Promise<object>} проверка и журналы
 */
async function loadCastFailure({ roll = 100, save = { passed: true } } = {}) {
  const messages = [];
  const payments = [];
  const saves = [];

  const ports = {
    CANTRIP_SPELL_LEVEL: engine.CANTRIP_SPELL_LEVEL,
    formatCastFailureMessage: engine.formatCastFailureMessage,
    listCastFailureChecks: engine.listCastFailureChecks,
    rollCastFailChance: (chance) => ({ roll, failed: roll <= chance }),
    listAmbientEffects: () => [],
    useChatStore: () => ({
      sendMessage: (text) => messages.push(text),
    }),
    runWithEffectPay: (request) => payments.push(request),
    useSpellSavingThrows: () => ({
      resolveSavingThrowForTarget: (target) => {
        saves.push(target);

        return Promise.resolve(save);
      },
    }),
  };

  ports.resolveLostSlotLevel = await loadHandler(
    helperPath,
    'resolveLostSlotLevel',
    ports,
  );

  ports.settleCastFailure = await loadHandler(
    helperPath,
    'settleCastFailure',
    ports,
  );

  ports.runCastFailureCheck = await loadHandler(
    helperPath,
    'runCastFailureCheck',
    ports,
  );

  const runWithCastFailure = await loadHandler(
    helperPath,
    'runWithCastFailure',
    ports,
  );

  return { runWithCastFailure, messages, payments, saves };
}

/**
 * Заклинатель с эффектами.
 *
 * @param {object[]} activeEffects - эффекты
 * @returns {object} заклинатель
 */
function caster(activeEffects = []) {
  return {
    ...structuredClone(engine.DEFAULT_ACTOR),
    id: 'mage',
    name: 'Маг',
    activeEffects,
  };
}

/**
 * Эффект с правилом каста.
 *
 * @param {string} name - имя
 * @param {object} castRule - правило каста
 * @returns {object} эффект
 */
function ruleEffect(name, castRule) {
  return {
    id: name,
    name,
    disabled: false,
    changes: [],
    flags: [],
    duration: { type: 'permanent' },
    castRule,
  };
}

const FIREBALL = {
  name: 'Огненный шар',
  level: 3,
  components: { verbal: true, somatic: true, material: true },
};

/**
 * Ждёт, пока отработают проверки: они идут через промисы.
 *
 * @returns {Promise<void>} когда очередь микрозадач пуста
 */
function settled() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

it('без правил каста продолжение идёт сразу', async () => {
  const { runWithCastFailure, messages } = await loadCastFailure();

  let proceeded = false;

  runWithCastFailure(FIREBALL, caster(), {}, () => {
    proceeded = true;
  });

  assert.equal(proceeded, true, 'синхронно, без окон');
  assert.deepEqual(messages, []);
});

it('шанс провала: неудача — строка в чат и ячейка наименьшего круга', async () => {
  const slow = ruleEffect('Замедление', {
    failChance: 25,
    failComponent: 'somatic',
    failLosesSlot: true,
  });

  const failed = await loadCastFailure({ roll: 10 });

  let proceeded = false;

  failed.runWithCastFailure(
    FIREBALL,
    caster([slow]),
    { availableLevels: [3, 4, 5] },
    () => {
      proceeded = true;
    },
  );

  await settled();

  assert.equal(proceeded, false);
  assert.match(failed.messages[0], /не удалось — Замедление \(к100: 10/);

  // Объект собран в чужой области (вынутый обработчик) — сверяем по полям
  assert.equal(failed.payments[0].pay.length, 1);
  assert.equal(failed.payments[0].pay[0].kind, 'spellSlot');
  assert.equal(failed.payments[0].pay[0].minLevel, 3);
  assert.equal(failed.payments[0].pay[0].maxLevel, 3);

  // Выбранный раньше круг тратится как есть
  const locked = await loadCastFailure({ roll: 10 });

  locked.runWithCastFailure(
    FIREBALL,
    caster([slow]),
    { lockedLevel: 5, availableLevels: [3, 4, 5] },
    () => {},
  );

  await settled();
  assert.equal(locked.payments[0].pay[0].minLevel, 5);

  // Повезло — каст идёт
  const lucky = await loadCastFailure({ roll: 26 });

  lucky.runWithCastFailure(FIREBALL, caster([slow]), {}, () => {
    proceeded = true;
  });

  await settled();
  assert.equal(proceeded, true);
  assert.deepEqual(lucky.messages, []);
});

it('спасбросок при попытке каста: провал — действие потрачено, ячейка цела', async () => {
  const pain = ruleEffect('Слово силы: Боль', {
    failSave: { ability: 'constitution', dc: 19 },
  });

  const failed = await loadCastFailure({ save: { passed: false, total: 11 } });

  let proceeded = false;

  failed.runWithCastFailure(FIREBALL, caster([pain]), {}, () => {
    proceeded = true;
  });

  await settled();

  assert.equal(proceeded, false);
  assert.equal(failed.saves[0].ability, 'constitution');
  assert.equal(failed.saves[0].dc, 19);
  assert.match(failed.messages[0], /спасбросок 11 против Сл 19/);
  assert.match(failed.messages[0], /ячейка — нет/);
  assert.equal(failed.payments.length, 0);

  const passed = await loadCastFailure({ save: { passed: true, total: 22 } });

  passed.runWithCastFailure(FIREBALL, caster([pain]), {}, () => {
    proceeded = true;
  });

  await settled();
  assert.equal(proceeded, true);

  // Окно закрыли — каст сворачивается молча
  const closed = await loadCastFailure({ save: null });

  proceeded = false;

  closed.runWithCastFailure(FIREBALL, caster([pain]), {}, () => {
    proceeded = true;
  });

  await settled();
  assert.equal(proceeded, false);
  assert.deepEqual(closed.messages, []);
});

it('сл источника, которую не проставили, не бросают', async () => {
  const pain = ruleEffect('Слово силы: Боль', {
    failSave: { ability: 'constitution', dc: 0 },
  });

  const { runWithCastFailure, saves } = await loadCastFailure();

  let proceeded = false;

  runWithCastFailure(FIREBALL, caster([pain]), {}, () => {
    proceeded = true;
  });

  await settled();

  assert.equal(proceeded, true);
  assert.deepEqual(saves, []);
});

it('существо при провале с потерей ячейки тратит применение заклинания', async () => {
  const zone = ruleEffect('Зона преследования', {
    failChance: 100,
    failLosesSlot: true,
  });

  const { runWithCastFailure, payments, messages } = await loadCastFailure({
    roll: 50,
  });

  let lost = 0;

  runWithCastFailure(
    FIREBALL,
    caster([zone]),
    {
      loseUse: () => {
        lost += 1;
      },
    },
    () => {},
  );

  await settled();

  assert.equal(lost, 1);
  assert.equal(payments.length, 0, 'ячейку листа при этом не трогают');
  assert.match(messages[0], /Действие и ячейка потрачены/);
});
