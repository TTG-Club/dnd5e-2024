import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it } from 'vitest';

import {
  createEntityServer,
  loadChangeEntityCombatState,
} from './helpers/combatWrite.mjs';
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
 * Одноразовый эффект, расходуемый броском атаки, действует на эту атаку
 * целиком и снимается после неё — одинаково на всех путях.
 *
 * Расход уезжает на сервер до броска. Урон же считается либо в том же тике
 * (окно применяет его само), либо после показа броска и ожиданий (части
 * урона, разбор целей заклинания) — к этому времени ответ сервера эффект из
 * мира уже убрал. Раньше итог зависел от того, успел ли прийти ответ.
 *
 * Бросок запоминает израсходованные эффекты в снимке (`AttackRollSnapshot`),
 * и разбор удара кладёт их поверх свежей сущности.
 */

const COMPOSABLES_DIR = 'src/client/composables';
const TRIGGER_EVENTS_PATH = `${COMPOSABLES_DIR}/useEffectTriggerEvents.ts`;
const SNAPSHOT_PATH = `${COMPOSABLES_DIR}/attackRollSnapshot.ts`;
const SHARED_PATH = `${COMPOSABLES_DIR}/spellResolutionShared.ts`;
const RESOLUTION_PATH = `${COMPOSABLES_DIR}/useSpellResolution.ts`;

/** Хиты сторон */
const HP = 40;

/** Урон удара до защит */
const FIRE_DAMAGE = 10;

/** Сопротивление огню до следующей атаки по носителю */
const WARD = createEffect('ward', {
  flags: ['resistance.fire'],
  consumeOn: 'attackOnCarrier',
});

/** Постоянный эффект цели: стоит в списке после одноразового */
const ARMOR = createEffect('armor', { flags: ['resistance.cold'] });

/** «Следующая атака игнорирует сопротивление огню» */
const PIERCE = createEffect('pierce', {
  flags: [`${engine.IGNORE_RESISTANCE_FLAG_PREFIX}fire`],
  consumeOn: 'carrierAttack',
});

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
 * Мир клиента, сервер и настоящие функции броска и разбора удара.
 *
 * @param {object[]} entities - сущности мира
 * @returns {Promise<object>} окружение теста
 */
async function setup(entities) {
  const world = new Map(
    entities.map((entity) => [entity.id, structuredClone(entity)]),
  );

  const servers = new Map(
    entities.map((entity) => [
      entity.id,
      createEntityServer(engine, structuredClone(entity)),
    ]),
  );

  const findEntity = (entityId) => world.get(entityId);

  // Каждый боевой снимок доходит до сервера сразу; до стора — когда скажет тест
  const emitted = {
    push: (copy) => servers.get(copy.id).receiveCombatState(copy),
  };

  const changeEntityCombatState = await loadChangeEntityCombatState({
    findEntity,
    emitted,
    recordCombatBaseline: engine.recordCombatBaseline,
  });

  let targetId = null;

  const worldPorts = {
    useWorldEntities: () => ({
      findCurrentDndEntity: findEntity,
      findCurrentWorldEntity: findEntity,
      getCurrentWorldEntities: () => [...world.values()],
    }),
    useTargetStore: () => ({
      getTargetActor: () => (targetId ? world.get(targetId) : null),
    }),
    isDndSceneEntity: engine.isDndSceneEntity,
    withHeldAttackEffects: engine.withHeldAttackEffects,
  };

  const snapshotPorts = { ...worldPorts };

  for (const name of [
    'withAttackHeldEffects',
    'listAttackResolutionEntities',
    'resolveSelectedAttackTarget',
  ]) {
    snapshotPorts[name] = await loadHandler(SNAPSHOT_PATH, name, snapshotPorts);
  }

  const triggerPorts = {
    ...worldPorts,
    findDndWorldEntity: findEntity,
    listAttackTargetIds: () => (targetId ? [targetId] : []),
    runAttackRollTriggers: engine.runAttackRollTriggers,
    listHeldAttackEffects: engine.listHeldAttackEffects,
    toTriggerAttackKinds: engine.toTriggerAttackKinds,
    isEntityInCombat: () => false,
    resolveActiveTurnActorId: () => null,
    resolveCombatRound: () => undefined,
    changeEntityCombatState,
    TRIGGER_EVENTS_LOG_PREFIX: '[test]',
    console,
    JSON,
    Map,
  };

  triggerPorts.settleAttackRollSide = await loadHandler(
    TRIGGER_EVENTS_PATH,
    'settleAttackRollSide',
    triggerPorts,
  );

  const dispatchAttackRollTriggers = await loadHandler(
    TRIGGER_EVENTS_PATH,
    'dispatchAttackRollTriggers',
    triggerPorts,
  );

  const resolveAttackerIgnoredResistances = await loadHandler(
    SHARED_PATH,
    'resolveAttackerIgnoredResistances',
    {
      ...snapshotPorts,
      listIgnoredResistances: engine.listIgnoredResistances,
      resolveActorStats: engine.resolveActorStats,
    },
  );

  // Настоящее применение урона разбором целей заклинания
  const applyResultsToEntity = await loadHandler(
    RESOLUTION_PATH,
    'applyResultsToEntity',
    {
      ...snapshotPorts,
      resolveAttackerIgnoredResistances,
      changeEntityCombatState,
      applyDamageDefenses: engine.applyDamageDefenses,
      resolveTargetDamageDefenses: engine.resolveTargetDamageDefenses,
      resolveEntityCurrentHp: engine.resolveEntityCurrentHp,
      resolveEntityMaxHp: engine.resolveEntityMaxHp,
      resolveEntityTempHp: engine.resolveEntityTempHp,
      limitEntityHealing: engine.limitEntityHealing,
      applyHpChange: engine.applyHpChange,
      writeEntityHitPoints: engine.writeEntityHitPoints,
      recordDamageHit: engine.recordDamageHit,
      mergeAppliedEffects: engine.mergeAppliedEffects,
      withInitializedDuration: engine.withInitializedDuration,
      generateId: (prefix) => `${prefix}_test`,
      JSON,
      Math,
    },
  );

  return {
    world,
    servers,
    snapshot: snapshotPorts,
    dispatchAttackRollTriggers,
    resolveAttackerIgnoredResistances,
    applyResultsToEntity,
    /**
     * Назначает выбранную цель.
     *
     * @param {string} entityId - цель
     */
    selectTarget(entityId) {
      targetId = entityId;
    },
    /**
     * Ответ сервера дошёл до стора: эффекты и `system` заменяются, как у хоста.
     *
     * @param {string} entityId - сущность
     */
    deliverEcho(entityId) {
      const server = servers.get(entityId).entity;

      Object.assign(world.get(entityId), {
        system: structuredClone(server.system),
        activeEffects: structuredClone(server.activeEffects),
      });
    },
  };
}

/**
 * Удар огнём по цели — так, как его считает разбор целей.
 *
 * @param {object} env - окружение теста
 * @param {object} attack - снимок броска
 * @param {string} attackerId - атакующий
 * @param {string} targetId - цель
 * @returns {number} урон, дошедший до цели
 */
function strike(env, attack, attackerId, targetId) {
  const [target] = env.snapshot
    .listAttackResolutionEntities(attack)
    .filter((entity) => entity.id === targetId);

  return env.applyResultsToEntity(
    target,
    FIRE_DAMAGE,
    'fire',
    false,
    undefined,
    { hit: { critical: false, sourceId: attackerId }, attack },
  ).finalDamage;
}

describe('одноразовый эффект цели: действует на эту атаку и снимается после неё', () => {
  /** Атакующий и цель с сопротивлением «до следующей атаки» */
  function sides() {
    return [
      withHp(createCreature, HP, { id: 'wolf', name: 'Волк' }),
      withHp(createActor, HP, { id: 'hero', activeEffects: [WARD, ARMOR] }),
    ];
  }

  it('бросок запоминает израсходованный эффект, а на сервере он снят сразу', async () => {
    const env = await setup(sides());

    env.selectTarget('hero');

    const attack = env.dispatchAttackRollTriggers('wolf', {
      projectile: false,
      rollMode: 'normal',
    });

    assert.equal(attack.attackerId, 'wolf');
    assert.deepEqual([...attack.targetIds], ['hero']);
    assert.deepEqual([...attack.held.keys()], ['hero']);

    assert.equal(
      JSON.stringify(attack.held.get('hero')),
      JSON.stringify([{ effect: WARD, index: 0 }]),
    );

    assert.deepEqual(
      env.servers.get('hero').entity.activeEffects.map((effect) => effect.id),
      ['armor'],
      'на сервере эффект снят броском',
    );

    assert.equal(
      env.world.get('hero').activeEffects.length,
      2,
      'стор клиента меняет только ответ сервера',
    );
  });

  it('оба порядка дают один итог: урон в тике броска и урон после показа броска', async () => {
    const outcomes = [];

    for (const echoBeforeDamage of [false, true]) {
      const env = await setup(sides());

      env.selectTarget('hero');

      const attack = env.dispatchAttackRollTriggers('wolf', {
        projectile: false,
        rollMode: 'normal',
      });

      // Путь с паузой: пока показывают бросок, ответ сервера убирает эффект
      // из стора; двухэтапный путь считает урон в тике броска
      if (echoBeforeDamage) {
        env.deliverEcho('hero');

        assert.deepEqual(
          env.world.get('hero').activeEffects.map((effect) => effect.id),
          ['armor'],
        );
      }

      const dealt = strike(env, attack, 'wolf', 'hero');
      const server = env.servers.get('hero').entity;

      outcomes.push({
        dealt,
        hp: engine.resolveEntityCurrentHp(server),
        effects: server.activeEffects.map((effect) => effect.id),
      });
    }

    assert.deepEqual(outcomes[0], {
      dealt: FIRE_DAMAGE / 2,
      hp: HP - FIRE_DAMAGE / 2,
      effects: ['armor'],
    });

    assert.deepEqual(outcomes[1], outcomes[0], 'итог не зависит от сети');
  });

  it('урон окна в тике броска (двухэтапный путь) — тот же: мир расхода ещё не видел', async () => {
    const env = await setup(sides());
    const system = new engine.Dnd5eVttSystem();

    env.selectTarget('hero');

    env.dispatchAttackRollTriggers('wolf', {
      projectile: false,
      rollMode: 'normal',
    });

    // Ядро применяет урон к копии выбранной цели и шлёт боевой снимок
    const copy = structuredClone(env.world.get('hero'));

    system.applyDamageToEntity(copy, FIRE_DAMAGE, false, 'fire', {
      critical: false,
      sourceId: 'wolf',
    });

    env.servers.get('hero').receiveCombatState(copy);

    const server = env.servers.get('hero').entity;

    assert.equal(engine.resolveEntityCurrentHp(server), HP - FIRE_DAMAGE / 2);

    assert.deepEqual(
      server.activeEffects.map((effect) => effect.id),
      ['armor'],
      'снимок урона снятый эффект не возвращает',
    );
  });

  it('без снимка удар после ответа сервера считался бы без эффекта — снимок это и закрывает', async () => {
    const env = await setup(sides());

    env.selectTarget('hero');

    env.dispatchAttackRollTriggers('wolf', {
      projectile: false,
      rollMode: 'normal',
    });

    env.deliverEcho('hero');

    assert.equal(strike(env, undefined, 'wolf', 'hero'), FIRE_DAMAGE);
  });

  it('следующая атака эффекта уже не видит', async () => {
    const env = await setup(sides());

    env.selectTarget('hero');

    const first = env.dispatchAttackRollTriggers('wolf', {
      projectile: false,
      rollMode: 'normal',
    });

    env.deliverEcho('hero');
    strike(env, first, 'wolf', 'hero');
    env.deliverEcho('hero');

    const second = env.dispatchAttackRollTriggers('wolf', {
      projectile: false,
      rollMode: 'normal',
    });

    assert.equal(second.held.size, 0, 'расходовать больше нечего');
    assert.equal(strike(env, second, 'wolf', 'hero'), FIRE_DAMAGE);
  });

  it('выбранная цель разбора — с израсходованным эффектом на прежнем месте', async () => {
    const env = await setup(sides());

    env.selectTarget('hero');

    const attack = env.dispatchAttackRollTriggers('wolf', {
      projectile: false,
      rollMode: 'normal',
    });

    env.deliverEcho('hero');

    const target = env.snapshot.resolveSelectedAttackTarget(
      env.snapshot.listAttackResolutionEntities(attack),
    );

    assert.deepEqual(
      target.activeEffects.map((effect) => effect.id),
      ['ward', 'armor'],
      'порядок эффектов — как до расхода',
    );

    assert.notEqual(target, env.world.get('hero'), 'запись стора не тронута');
    assert.equal(env.world.get('hero').activeEffects.length, 1);
  });
});

describe('одноразовый эффект атакующего: действует на эту атаку', () => {
  it('«следующая атака игнорирует сопротивление» — и до ответа сервера, и после', async () => {
    const outcomes = [];

    for (const echoBeforeDamage of [false, true]) {
      const env = await setup([
        withHp(createCreature, HP, {
          id: 'wolf',
          name: 'Волк',
          activeEffects: [PIERCE],
        }),
        withHp(createActor, HP, {
          id: 'hero',
          activeEffects: [createEffect('skin', { flags: ['resistance.fire'] })],
        }),
      ]);

      env.selectTarget('hero');

      const attack = env.dispatchAttackRollTriggers('wolf', {
        projectile: false,
        rollMode: 'normal',
      });

      assert.deepEqual([...attack.held.keys()], ['wolf']);

      if (echoBeforeDamage) {
        env.deliverEcho('wolf');
        assert.deepEqual(env.world.get('wolf').activeEffects, []);
      }

      outcomes.push({
        ignored: env.resolveAttackerIgnoredResistances('wolf', attack),
        dealt: strike(env, attack, 'wolf', 'hero'),
        attackerEffects: env.servers.get('wolf').entity.activeEffects.length,
      });
    }

    assert.equal(
      JSON.stringify(outcomes[0]),
      JSON.stringify({
        ignored: ['fire'],
        dealt: FIRE_DAMAGE,
        attackerEffects: 0,
      }),
    );

    assert.equal(JSON.stringify(outcomes[1]), JSON.stringify(outcomes[0]));
  });
});

describe('израсходованные эффекты: правила', () => {
  it('держатся снятые и изменённые эффекты — какими были до расхода', () => {
    const charged = createEffect('charged', {
      charges: { current: 2, max: 2 },
    });

    const before = [ARMOR, charged, WARD];

    const after = [
      ARMOR,
      { ...charged, charges: { current: 1, max: 2 } },
      createEffect('fresh'),
    ];

    assert.deepEqual(engine.listHeldAttackEffects(before, after), [
      { effect: charged, index: 1 },
      { effect: WARD, index: 2 },
    ]);

    assert.deepEqual(engine.listHeldAttackEffects(before, before), []);
  });

  it('возврат на прежние места не зависит от того, убрал ли сервер эффекты', () => {
    const held = engine.listHeldAttackEffects([WARD, ARMOR, PIERCE], [ARMOR]);
    const entity = createActor({ activeEffects: [WARD, ARMOR, PIERCE] });
    const echoed = createActor({ activeEffects: [ARMOR] });
    const order = ['ward', 'armor', 'pierce'];

    for (const current of [entity, echoed]) {
      assert.deepEqual(
        engine
          .withHeldAttackEffects(current, held)
          .activeEffects.map((effect) => effect.id),
        order,
      );
    }

    assert.equal(echoed.activeEffects.length, 1, 'сущность не мутируется');
    assert.equal(engine.withHeldAttackEffects(entity, []), entity);
    assert.equal(engine.withHeldAttackEffects(entity, undefined), entity);
  });
});

describe('снимок броска доходит до разбора на всех входах', () => {
  /** Обработчики урона: сущности разбора берут только из снимка */
  const HANDLER_FILES = [
    `${COMPOSABLES_DIR}/spellCastFlow.ts`,
    `${COMPOSABLES_DIR}/creatureSpellCast.ts`,
    `${COMPOSABLES_DIR}/creatureActionRoll.ts`,
    `${COMPOSABLES_DIR}/weaponAttackRoll.ts`,
  ];

  /** Оркестраторы разбора целей */
  const ORCHESTRATOR_FILES = [
    RESOLUTION_PATH,
    `${COMPOSABLES_DIR}/useSpellDamageWithParts.ts`,
  ];

  it('обработчики урона собирают сущности разбора по снимку и отдают его в контекст', () => {
    for (const path of HANDLER_FILES) {
      const source = readSource(path);

      assert.doesNotMatch(
        source,
        /getCurrentWorldEntities\(\)/u,
        `${path}: сущности разбора — мимо снимка броска`,
      );

      const lists = source.match(/listAttackResolutionEntities\(/gu) ?? [];

      const contexts = source.match(
        /^\s+attack(?:: rollContext\.attack)?,$/gmu,
      );

      assert.ok(lists.length > 0, `${path}: нет сущностей разбора`);

      assert.ok(
        (contexts ?? []).length >= lists.length,
        `${path}: снимок не отдан в контекст разбора`,
      );
    }
  });

  it('оркестраторы не читают цель из стора целей и защиты считают по снимку', () => {
    for (const path of ORCHESTRATOR_FILES) {
      const source = readSource(path);

      assert.doesNotMatch(source, /useTargetStore|getTargetActor\(/u, path);

      for (const call of source.matchAll(
        /resolveAttackerIgnoredResistances\(([^;]*?)\)[,;\n]/gu,
      )) {
        assert.match(
          call[1],
          /attack/u,
          `${path}: сопротивления атакующего — мимо снимка броска`,
        );
      }
    }

    assert.match(
      readSource(RESOLUTION_PATH),
      /resolveTargetDamageDefenses\(\s*withAttackHeldEffects\(target, options\.attack\),/u,
    );
  });

  it('окно броска отдаёт снимок каждому обработчику урона', () => {
    const modal = readSource('src/client/ui/actor/DiceRollModal.vue');

    assert.match(modal, /attack: projectileAttack,/u);
    assert.match(modal, /rollOnRollParts\.value\?\.\(rolled, attack\);/u);

    assert.match(
      modal,
      /props\.onRoll\(damageTotal, resolvedDamageType\.value, attackSnapshot\);/u,
    );

    assert.equal((modal.match(/props\.onHit\(attack\);/gu) ?? []).length, 2);
    assert.doesNotMatch(modal, /props\.onHit\(\);/u);

    // Части после показа броска идут со снимком
    assert.match(
      modal,
      /\.then\(\(\) => rollPartsSequentially\(parts, isCrit, attack\)\)/u,
    );
  });
});
