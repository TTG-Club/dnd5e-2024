import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';

const engine = await loadEngineBundle(`
  export * from './src/engine/index.ts';
  export { getEntityOwnerIds, withTokenDisposition } from '@vtt/shared';
`);

const labels = await loadEngineBundle(
  "export * from './src/client/ui/stealth/hideLabels.ts';",
);

/**
 * Засада и поиск на столе (`hideAction.ts`): права, ход, пауза, цена, отбор
 * союзников, двойное нажатие, засада существа ведущего, «Найти» и «Шум».
 * Функции — настоящие, окружение (окна, чат, мир) — журналом.
 */

const HIDE_PATH = 'src/client/composables/hideAction.ts';

/** Функции модуля в порядке зависимостей */
const HIDE_FUNCTIONS = [
  'warn',
  'resolveEntitySide',
  'areAllies',
  'refuseOutsideOwnTurn',
  'refuseAction',
  'announceHide',
  'settleHide',
  'rollHide',
  'startHide',
  'removeHide',
  'findLiveHide',
  'settleSearch',
  'openSearchCheck',
  'searchForHidden',
  'listSearchableHides',
  'startSearch',
  'listSearchers',
  'searchFromChat',
  'endHideByNoise',
];

const GM_ID = 'user-gm';
const PLAYER_ID = 'user-player';

/**
 * Сущность мира.
 *
 * @param {string} id - id
 * @param {object} overrides - поля
 * @returns {object} сущность
 */
function entity(id, overrides = {}) {
  return { id, name: id, system: {}, activeEffects: [], ...overrides };
}

/**
 * Сущность в засаде.
 *
 * @param {string} id - id
 * @param {number} searchDc - Сл поиска
 * @param {object} overrides - поля
 * @returns {object} сущность
 */
function hiddenEntity(id, searchDc, overrides = {}) {
  const effect = { ...engine.buildHiddenEffect(searchDc), id: `hide_${id}` };

  return entity(id, { activeEffects: [effect], ...overrides });
}

/**
 * Фишка сцены.
 *
 * @param {string} actorId - сущность
 * @param {string} disposition - отношение
 * @returns {object} фишка
 */
function token(actorId, disposition) {
  return { id: `token_${actorId}`, actorId, disposition, x: 0, y: 0 };
}

/**
 * Окружение засады: мир, сцена, пользователь и журналы.
 *
 * @param {object} options - что подменить
 * @param {object[]} options.entities - сущности мира
 * @param {object[]} options.tokens - фишки сцены
 * @param {string} options.userId - кто нажимает
 * @param {Set<string>} options.flags - флаги действующего
 * @param {boolean} options.paused - игра на паузе
 * @param {string[]} options.offTurn - кто в бою и не ходит
 * @param {number} options.answer - какой вариант выбрать в плашке
 * @param {number} options.rollTotal - итог броска окна; нет — окно не бросает
 * @param {boolean} options.gmOnlyChat - хост умеет сообщения «только для мастера»
 * @returns {Promise<object>} функции и журналы
 */
async function loadHide({
  entities = [],
  tokens = [],
  userId = GM_ID,
  flags = new Set(),
  paused = false,
  offTurn = [],
  answer = 0,
  rollTotal,
  gmOnlyChat = false,
} = {}) {
  const world = new Map(
    entities.map((item) => [item.id, structuredClone(item)]),
  );

  const log = {
    windows: [],
    questions: [],
    toasts: [],
    messages: [],
    messageOptions: [],
    appends: [],
    spends: [],
  };

  const ports = {
    ...labels,
    HIDE_MODAL_KEY_PREFIX: 'hide:',
    HIDE_COST_MODAL_KEY_PREFIX: 'hide-cost:',
    SEARCH_MODAL_KEY_PREFIX: 'search:',
    SEARCH_COST: 'action',
    GM_ONLY_ROLL: 'gm',
    WHOLE_SCENE_FEET: Number.POSITIVE_INFINITY,
    EFFECT_QUESTION_PROMPT_MODAL: 'EffectQuestionPromptModal',
    buildHiddenEffect: engine.buildHiddenEffect,
    findHiddenEffect: engine.findHiddenEffect,
    getRelativeDisposition: engine.getRelativeDisposition,
    getEntityOwnerIds: engine.getEntityOwnerIds,
    withTokenDisposition: engine.withTokenDisposition,
    HIDE_CHECK_DC: engine.HIDE_CHECK_DC,
    HIDE_FOLLOW_UP_KIND: engine.HIDE_FOLLOW_UP_KIND,
    HIDE_SKILL: engine.HIDE_SKILL,
    SEARCH_SKILL: engine.SEARCH_SKILL,
    isHideSuccess: engine.isHideSuccess,
    listHideCosts: engine.listHideCosts,
    mergeAppliedEffects: engine.mergeAppliedEffects,
    pickFoundHides: engine.pickFoundHides,
    resolveHideSearchDc: engine.resolveHideSearchDc,
    serializeHideFollowUp: engine.serializeHideFollowUp,
    resolveActionCostBlock: () => null,
    listAmbientEffects: () => [],
    resolveEntityStats: () => ({ activeFlags: flags }),
    isGameMasterUser: (id) => id === GM_ID,
    hasPlayerOwner: (item) =>
      engine.getEntityOwnerIds(item).some((id) => id !== GM_ID),
    controlsEntityAsUser: (item) =>
      userId === GM_ID || (item.ownerIds ?? []).includes(userId),
    refuseWhileSheetEditing: () => false,
    refuseWhilePaused: () => paused,
    isEntityOwnTurn: (id) => !offTurn.includes(id),
    warnActionCostBlocked: () => false,
    recordEntityActionSpend: (id, cost) => log.spends.push([id, cost]),
    listEntitiesNear: (id) =>
      [...world.values()].filter((item) => item.id !== id),
    useWorldStore: () => ({
      connectionState: { loggedAsUserId: userId },
      isGM: userId === GM_ID,
      currentScene: { tokens },
    }),
    useWorldEntities: () => ({ findCurrentDndEntity: (id) => world.get(id) }),
    changeEntityCombatState: (id, change) => {
      const current = world.get(id);
      const next = current ? change(structuredClone(current)) : null;

      if (next) {
        world.set(id, next);
      }

      return next;
    },
    canSendGmOnlyChat: () => gmOnlyChat,
    useSystemToastStore: () => ({ add: (toast) => log.toasts.push(toast) }),
    useChatStore: () => ({
      sendMessage: (content, _type, _roll, _speaker, options) => {
        log.messages.push(content);
        log.messageOptions.push(options);

        return `msg_${log.messages.length}`;
      },
      appendToMessage: (id, content, _type, _roll, options) =>
        log.appends.push({ id, content, kind: options?.kind }),
    }),
    useModalManager: () => ({
      openModal: (name, props) => {
        log.questions.push(props);
        props.onAnswer(String(answer));
      },
    }),
    openSkillCheckModal: (who, skill, options) => {
      log.windows.push({ who: who.id, skill, options });

      if (rollTotal !== undefined) {
        options.onRoll({ total: rollTotal, natural: 10, modifier: 0 });
      }
    },
  };

  ports.chooseOne = await loadHandler(
    'src/client/composables/questionChoice.ts',
    'chooseOne',
    ports,
  );

  for (const name of HIDE_FUNCTIONS) {
    ports[name] = await loadHandler(HIDE_PATH, name, ports);
  }

  return { ...ports, world, log };
}

const rogue = entity('rogue', { ownerIds: [PLAYER_ID] });
const goblin = entity('goblin');

describe('засада на столе', () => {
  it('чужой персонаж, чужой ход и пауза — засады нет', async () => {
    const stranger = await loadHide({
      entities: [rogue],
      userId: 'user-other',
    });

    assert.equal(stranger.startHide(stranger.world.get('rogue')), false);
    assert.deepEqual(stranger.log.windows, []);

    const offTurn = await loadHide({ entities: [rogue], offTurn: ['rogue'] });

    assert.equal(offTurn.startHide(offTurn.world.get('rogue')), false);
    assert.equal(offTurn.log.toasts.length, 1, 'причина не глотается');

    const paused = await loadHide({ entities: [rogue], paused: true });

    assert.equal(paused.startHide(paused.world.get('rogue')), false);
    assert.deepEqual(paused.log.windows, []);
  });

  it('цена: без умения — действие без вопроса; с «Хитрым действием» — выбор', async () => {
    const plain = await loadHide({ entities: [rogue], rollTotal: 18 });

    plain.startHide(plain.world.get('rogue'));

    assert.deepEqual(plain.log.questions, [], 'один вариант — без плашки');
    assert.deepEqual(plain.log.spends, [['rogue', 'action']]);
    assert.equal(plain.log.messages[0], 'rogue в засаде');

    const cunning = await loadHide({
      entities: [rogue],
      flags: new Set([engine.HIDE_AS_BONUS_FLAG]),
      answer: 0,
      rollTotal: 18,
    });

    cunning.startHide(cunning.world.get('rogue'));

    assert.equal(cunning.log.questions.length, 1);
    assert.equal(cunning.log.questions[0]._modalKey, 'hide-cost:rogue');
    assert.deepEqual(cunning.log.spends, [['rogue', 'bonus']]);

    assert.equal(
      cunning.log.messages[0],
      'rogue в засаде (бонусным действием)',
    );

    const byAction = await loadHide({
      entities: [rogue],
      flags: new Set([engine.HIDE_AS_BONUS_FLAG]),
      answer: 1,
      rollTotal: 18,
    });

    byAction.startHide(byAction.world.get('rogue'));

    assert.deepEqual(
      byAction.log.spends,
      [['rogue', 'action']],
      'выбор за игроком',
    );
  });

  it('двойное нажатие: окно и плашка с постоянным ключом — вторые не открываются', async () => {
    const env = await loadHide({ entities: [rogue] });

    env.startHide(env.world.get('rogue'));
    env.startHide(env.world.get('rogue'));

    assert.deepEqual(
      env.log.windows.map((window) => window.options.modalKey),
      ['hide:rogue', 'hide:rogue'],
      'менеджер окон второе окно с тем же ключом не открывает',
    );
  });

  it('персонаж игрока: сообщение и кнопки; существо ведущего — бросок ведущему, чат молчит', async () => {
    const player = await loadHide({ entities: [rogue], rollTotal: 17 });

    player.startHide(player.world.get('rogue'));

    assert.equal(player.log.windows[0].options.rollVisibility, undefined);
    assert.equal(player.log.appends[0].kind, engine.HIDE_FOLLOW_UP_KIND);
    assert.equal(player.world.get('rogue').activeEffects[0].searchDc, 17);

    const gm = await loadHide({ entities: [goblin], rollTotal: 19 });

    gm.startHide(gm.world.get('goblin'));

    assert.equal(gm.log.windows[0].options.rollVisibility, 'gm');
    assert.deepEqual(gm.log.messages, [], 'в общий чат ни «в засаде», ни Сл');
    assert.deepEqual(gm.log.appends, [], 'кнопок «Найти» и «Шум» нет');
    assert.equal(gm.log.toasts[0].description, 'Сл поиска: 19');
    assert.equal(gm.world.get('goblin').activeEffects[0].searchDc, 19);
  });

  it('существо ведущего на хосте с gmOnly: сообщение и кнопки только ведущему', async () => {
    const gm = await loadHide({
      entities: [goblin],
      rollTotal: 19,
      gmOnlyChat: true,
    });

    gm.startHide(gm.world.get('goblin'));

    assert.equal(gm.log.messages.length, 1);
    assert.equal(gm.log.messageOptions[0].gmOnly, true);
    assert.equal(gm.log.appends[0].kind, engine.HIDE_FOLLOW_UP_KIND);
    assert.deepEqual(gm.log.toasts, [], 'уведомление не нужно');

    const player = await loadHide({
      entities: [rogue],
      rollTotal: 17,
      gmOnlyChat: true,
    });

    player.startHide(player.world.get('rogue'));

    assert.equal(
      player.log.messageOptions[0].gmOnly,
      undefined,
      'засада персонажа игрока видна всем',
    );
  });
});

describe('поиск', () => {
  it('«Поиск» видит засады врагов и нейтральных, но не союзников', async () => {
    const env = await loadHide({
      entities: [
        rogue,
        hiddenEntity('goblin', 14),
        hiddenEntity('ally', 12, { ownerIds: [PLAYER_ID] }),
        hiddenEntity('cat', 10),
      ],
      tokens: [
        token('rogue', 'friendly'),
        token('goblin', 'hostile'),
        token('ally', 'friendly'),
        token('cat', 'neutral'),
      ],
    });

    assert.deepEqual(
      env
        .listSearchableHides(env.world.get('rogue'))
        .map((hide) => hide.entityId),
      ['goblin', 'cat'],
    );
  });

  it('ищущий без фишки: сторона по владельцу — засады своих не находит', async () => {
    const env = await loadHide({
      entities: [
        rogue,
        hiddenEntity('ally', 12, { ownerIds: [PLAYER_ID] }),
        hiddenEntity('goblin', 14),
      ],
      tokens: [token('ally', 'friendly'), token('goblin', 'hostile')],
    });

    assert.deepEqual(
      env
        .listSearchableHides(env.world.get('rogue'))
        .map((hide) => hide.entityId),
      ['goblin'],
    );
  });

  it('«Поиск» с полки: один бросок, снимаются все перебитые засады', async () => {
    const env = await loadHide({
      entities: [rogue, hiddenEntity('goblin', 14), hiddenEntity('wolf', 20)],
      tokens: [
        token('rogue', 'friendly'),
        token('goblin', 'hostile'),
        token('wolf', 'hostile'),
      ],
      rollTotal: 15,
    });

    env.startSearch(env.world.get('rogue'));

    assert.equal(
      env.log.windows[0].options.targetDc,
      undefined,
      'окно Сл не показывает',
    );

    assert.equal(env.findHiddenEffect(env.world.get('goblin')), undefined);
    assert.notEqual(env.findHiddenEffect(env.world.get('wolf')), undefined);
    assert.deepEqual(env.log.spends, [['rogue', 'action']]);
    assert.match(env.log.messages[0], /находит: goblin\./u);
  });

  it('«Найти»: только ведущий; без союзников спрятавшегося в «Кто ищет?»', async () => {
    const hidden = hiddenEntity('rogue', 15, { ownerIds: [PLAYER_ID] });
    const payload = { entityId: 'rogue', effectId: 'hide_rogue', searchDc: 15 };

    const player = await loadHide({ entities: [hidden], userId: PLAYER_ID });

    player.searchFromChat(payload);
    assert.deepEqual(player.log.questions, []);
    assert.deepEqual(player.log.windows, []);
    assert.equal(player.log.toasts.length, 1);

    const gm = await loadHide({
      entities: [hidden, entity('ally', { ownerIds: [PLAYER_ID] }), goblin],
      tokens: [
        token('rogue', 'friendly'),
        token('ally', 'friendly'),
        token('goblin', 'hostile'),
      ],
    });

    assert.deepEqual(
      gm.listSearchers(gm.world.get('rogue')).map((item) => item.id),
      ['goblin'],
    );
  });

  it('«Найти» по засаде, которой к броску уже нет: сообщение, действие не тратится', async () => {
    const env = await loadHide({ entities: [rogue, goblin] });

    env.settleSearch(
      env.world.get('goblin'),
      [{ entityId: 'rogue', effectId: 'gone', searchDc: 12 }],
      20,
      true,
    );

    assert.deepEqual(env.log.spends, []);

    assert.equal(
      env.log.toasts[0].description,
      labels.HIDE_LABELS.goneDescription,
    );
  });

  it('«Шум»: ведущий и владелец спрятавшегося — да, другой игрок — нет', async () => {
    const hidden = hiddenEntity('rogue', 15, { ownerIds: [PLAYER_ID] });
    const payload = { entityId: 'rogue', effectId: 'hide_rogue', searchDc: 15 };

    for (const [userId, removed] of [
      [GM_ID, true],
      [PLAYER_ID, true],
      ['user-other', false],
    ]) {
      const env = await loadHide({ entities: [hidden], userId });

      env.endHideByNoise(payload);

      assert.equal(
        env.findHiddenEffect(env.world.get('rogue')) === undefined,
        removed,
        userId,
      );
    }
  });
});

describe('полка действий', () => {
  /**
   * Регистрация засады на заглушке API ядра.
   *
   * @param {boolean} withShelf - есть ли у ядра полка
   * @param {object} selected - выделенная сущность
   * @returns {Promise<object>} журнал регистраций
   */
  async function registerOn(withShelf, selected) {
    const registered = { shelf: null, followUps: null };

    const api = {
      chatFollowUpActions: (registration) => {
        registered.followUps = registration;
      },
      ...(withShelf
        ? {
            actionShelf: (provider) => {
              registered.shelf = provider;

              return { refresh: () => {} };
            },
          }
        : {}),
    };

    const ports = {
      ...labels,
      findHiddenEffect: engine.findHiddenEffect,
      parseHideFollowUp: engine.parseHideFollowUp,
      HIDE_FOLLOW_UP_KIND: engine.HIDE_FOLLOW_UP_KIND,
      HIDE_ACTIONS_LAYOUT: 'row',
      useWorldEntities: () => ({
        findCurrentDndEntity: (id) =>
          id === selected.id ? selected : undefined,
      }),
      findLiveHide: () => undefined,
      searchFromChat: () => {},
      endHideByNoise: () => {},
      startHide: () => true,
      startSearch: () => true,
    };

    ports.hasActionShelf = await loadHandler(
      'src/client/composables/actionShelf.ts',
      'hasActionShelf',
      ports,
    );

    ports.registerActionShelf = await loadHandler(
      'src/client/composables/actionShelf.ts',
      'registerActionShelf',
      ports,
    );

    for (const name of [
      'resolveHideActionView',
      'withHidePayload',
      'runWithLiveEntity',
      'buildIdleShelfButtons',
    ]) {
      ports[name] = await loadHandler(
        'src/client/modules/stealth/register.ts',
        name,
        ports,
      );
    }

    const register = await loadHandler(
      'src/client/modules/stealth/register.ts',
      'register',
      ports,
    );

    register(api);

    return registered;
  }

  it('без полки у ядра — регистрируются только кнопки под сообщением', async () => {
    const registered = await registerOn(false, rogue);

    assert.equal(registered.shelf, null);
    assert.ok(registered.followUps);
  });

  it('четыре кнопки по порядку; недоступные без обработчика; «Спрятаться» горит в засаде', async () => {
    const plain = await registerOn(true, rogue);
    const buttons = plain.shelf.list({ entityId: 'rogue' });

    assert.deepEqual(
      Array.from(buttons, (button) => button.id),
      ['attack', 'jump', 'hide', 'search'],
    );

    for (const button of buttons.slice(0, 2)) {
      assert.equal(button.disabled, true);
      assert.equal(button.disabledReason, 'В разработке');
      assert.equal(button.onClick, undefined);
    }

    assert.equal(buttons[2].active, false);
    assert.equal(typeof buttons[3].onClick, 'function');

    const hidden = await registerOn(true, hiddenEntity('rogue', 15));

    assert.equal(hidden.shelf.list({ entityId: 'rogue' })[2].active, true);

    const idle = hidden.shelf.list({ entityId: 'nobody' });

    assert.deepEqual(
      Array.from(idle, (button) => button.id),
      ['attack', 'jump', 'hide', 'search'],
      'без своего героя полка та же',
    );

    for (const button of idle) {
      assert.equal(button.disabled, true, 'и вся погашена');
      assert.equal(button.onClick, undefined);
    }
  });

  it('«Найти» помечен только для ведущего, «Шум» — нет', async () => {
    const registered = await registerOn(false, rogue);
    const [search, noise] = registered.followUps.actions;

    assert.equal(search.gmOnly, true);
    assert.equal(noise.gmOnly, undefined);
  });
});
