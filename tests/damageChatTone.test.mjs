import assert from 'node:assert/strict';

import { it } from 'vitest';

import { loadHandler } from './helpers/sourceHandler.mjs';

/** Окраска сообщения об уроне в ленте чата */
const DAMAGE_CHAT_OPTIONS = { tone: 'damage' };

/**
 * Параметры сообщения боя, как их собирает `damageChatMessage.ts`: окраска,
 * подпись действующего и блоки карточки.
 *
 * @param {string} [speakerEntityId] - кто действует
 * @param {object[]} [blocks] - блоки карточки
 * @returns {object} параметры отправки
 */
function buildCombatChatOptions(speakerEntityId, blocks) {
  return {
    ...DAMAGE_CHAT_OPTIONS,
    ...buildSpeakerChatOptions(speakerEntityId),
    ...(blocks?.length ? { blocks } : {}),
  };
}

/**
 * Подпись действующего без окраски боя.
 *
 * @param {string} [speakerEntityId] - кто действует
 * @returns {object} параметры отправки
 */
function buildSpeakerChatOptions(speakerEntityId) {
  return speakerEntityId ? { speakerEntityId } : {};
}

/** Начало строки части: значок и название по виду части, цель — если названа */
function buildDamageChatRowLabel(kind, targetName) {
  return {
    icon: kind.isHealing ? 'heal-icon' : 'damage-icon',
    name: 'kind',
    ...(targetName ? { target: targetName } : {}),
  };
}

/** Итог урона без цели: брошенное число и подробности броска в строке */
function buildUnappliedDamageValue(amount, detail) {
  return { value: `${amount}`, ...(detail ? { detail } : {}) };
}

/** Шапка отдельной карточки: чем действовали и единственная цель */
function buildActionChatHeader({ name, targetNames = [] }) {
  return {
    title: name,
    ...(targetNames.length === 1 ? { target: targetNames[0] } : {}),
  };
}

/** Шапка встаёт над первым блоком строк отдельной карточки */
function headChatBlocks(header, blocks) {
  const [first, ...rest] = blocks;

  return first ? [{ ...first, ...header }, ...rest] : [{ ...header }];
}

/** Имя цели в строке — только когда целей несколько */
function pickRowTargetName(targetName, targetCount) {
  return targetCount > 1 ? targetName : undefined;
}

/** Блок броска урона окном: строка с видом урона и брошенным числом без цели */
function buildDamageChatBlock(applyResult, damageType, rolledTotal) {
  return {
    rows: [
      {
        name: damageType ?? 'Урон',
        ...(applyResult ? {} : { value: `${rolledTotal}` }),
      },
    ],
  };
}

/** Подписи пустого итога: цели нет либо в области никого */
const SPELL_NO_TARGETS_LABELS = {
  noTarget: 'цель не выбрана',
  emptyArea: 'в области никого нет',
};

/**
 * Разбирает брошенные части без цели и отдаёт то, что ушло в чат.
 *
 * @param {object[]} parts - брошенные части урона или лечения
 * @param {object} [options] - шаблон области и карточка броска атаки
 * @returns {Promise<{ sent: object[], appended: object[] }>} сообщения чата
 */
async function resolveWithoutTargets(parts, options = {}) {
  const sent = [];
  const appended = [];

  const chatStore = {
    sendMessage: (content, _type, _rollData, _cardData, chatOptions) =>
      sent.push({ content, options: chatOptions }),
    appendToMessage: (messageId, content, _type, _rollData, chatOptions) => {
      appended.push({ messageId, content, options: chatOptions });

      return true;
    },
  };

  const resolveSpellDamageWithParts = await loadHandler(
    'src/client/composables/useSpellDamageWithParts.ts',
    'resolveSpellDamageWithParts',
    {
      chatStore,
      buildCombatChatOptions,
      buildSpeakerChatOptions,
      buildDamageChatRowLabel,
      buildUnappliedDamageValue,
      buildActionChatHeader,
      headChatBlocks,
      attachHpChangeDetails: (blocks) => blocks,
      isEntityHpShownToPlayers: () => true,
      pickRowTargetName,
      SPELL_NO_TARGETS_LABELS,
      SPELL_SUMMARY_LABELS: {},
      DAMAGE_DEDUCTION_LABELS: { header: 'Вычет' },
      buildAttackDamageChatOptions: (_record, blocks) => ({
        ...DAMAGE_CHAT_OPTIONS,
        blocks,
      }),
      chooseAreaTargets: () => Promise.resolve([]),
      resolveGridCellSize: () => 5,
      resolveSelectedAttackTarget: () => null,
      resolveAttackerIgnoredResistances: () => [],
      isSaveAbility: () => false,
      getPartKindLabel: (part) => part.label,
      formatTargetGateSuffix: () => '',
      formatDiceFormula: (formula) => formula,
    },
  );

  await resolveSpellDamageWithParts(
    {
      spell: { name: 'Раздирание' },
      spellSaveDC: 0,
      actors: [],
      casterId: 'caster',
      ...(options.attackMessageId
        ? { attack: { chatMessageId: options.attackMessageId } }
        : {}),
    },
    parts,
    {
      scene: options.cachedTemplate ? { gridSettings: {} } : null,
      cachedTemplate: options.cachedTemplate ?? null,
    },
  );

  return { sent, appended };
}

/** Брошенная часть урона: 1к8 + 3 [7] = 10 */
const FORCE_DAMAGE_PART = {
  label: 'Силовой урон',
  formula: '1к8 + 3',
  amount: 10,
  values: [7],
  type: 'force',
  target: 'selected',
};

/** Брошенная часть лечения */
const HEALING_PART = {
  label: 'Лечение',
  formula: '1к8',
  amount: 5,
  values: [5],
  isHealing: true,
  target: 'selected',
};

it('урон без выбранной цели выделяется в ленте', async () => {
  const { sent } = await resolveWithoutTargets([FORCE_DAMAGE_PART]);

  // Сообщение собрано в другом контексте исполнения: сравнивается копия
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [
    {
      // Ни «цель не выбрана», ни строки «Без цели»: брошенный в пустоту
      // урон говорит сам за себя
      content: 'Раздирание\nСиловой урон\n→ 1к8 + 3 [7] = 10',
      // Подпись — действующего, а не того, чей токен выделен; строка — та же,
      // что в карточке атаки: вид урона, брошенное число и свёрнутая формула,
      // а шапкой — чем действовали (цели нет — имени в шапке тоже)
      options: {
        ...DAMAGE_CHAT_OPTIONS,
        speakerEntityId: 'caster',
        blocks: [
          {
            title: 'Раздирание',
            rows: [
              {
                icon: 'damage-icon',
                name: 'Силовой урон',
                value: '10',
                detail: '1к8 + 3 [7] = 10',
              },
            ],
          },
        ],
      },
    },
  ]);
});

it('урон по пустой области выделяется в ленте', async () => {
  const { sent } = await resolveWithoutTargets([FORCE_DAMAGE_PART], {
    cachedTemplate: { id: 'template' },
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].options.tone, DAMAGE_CHAT_OPTIONS.tone);

  // Урон брошен и показан — причина пустого итога под ним была бы шумом
  assert.doesNotMatch(sent[0].content, /в области никого нет/);
  assert.equal(sent[0].options.blocks[0].note, undefined);
  assert.equal(sent[0].options.blocks[0].rows[0].value, '10');
});

it('урон без цели после броска атаки красит карточку атаки', async () => {
  const { sent, appended } = await resolveWithoutTargets([FORCE_DAMAGE_PART], {
    attackMessageId: 'attack-message',
  });

  assert.equal(sent.length, 0);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].messageId, 'attack-message');
  assert.equal(appended[0].options.tone, DAMAGE_CHAT_OPTIONS.tone);

  // В карточке атаки «чем» называет сам бросок: блок урона — без шапки,
  // строка та же, что в отдельной карточке
  assert.deepEqual(JSON.parse(JSON.stringify(appended[0].options.blocks)), [
    {
      rows: [
        {
          icon: 'damage-icon',
          name: 'Силовой урон',
          value: '10',
          detail: '1к8 + 3 [7] = 10',
        },
      ],
    },
  ]);
});

it('лечение без цели остаётся обычным сообщением', async () => {
  const { sent } = await resolveWithoutTargets([HEALING_PART]);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].options.tone, undefined);
  assert.equal(sent[0].options.speakerEntityId, 'caster');
});

/**
 * Бросает окном броска без броска попадания и отдаёт параметры сообщения.
 *
 * @param {object} window - формула, тип урона и признак лечения окна
 * @returns {Promise<object | undefined>} параметры отправки в чат
 */
async function rollWindowWithoutAttack(window) {
  const sent = [];
  const rolls = [];

  const performSimpleRoll = await loadHandler(
    'src/client/ui/actor/DiceRollModal.vue',
    'performSimpleRoll',
    {
      props: {
        rollLabel: 'Раздирание',
        modifier: 0,
        isHealing: window.isHealing ?? false,
        skipChatMessage: false,
        skipDamageApplication: false,
        attackerId: window.attackerId,
      },
      rollFormula: { value: window.formula },
      effectiveFormula: { value: window.formula },
      bonusValue: { value: 0 },
      currentConditionalBonuses: { value: { damageBonus: 0, attackBonus: 0 } },
      attackRollMode: { value: 'normal' },
      resolvedDamageType: { value: window.damageType },
      buildAttackFormula: () => '1к20',
      diceRollerStore: { parseAndRoll: () => ({ total: 10 }) },
      getShortDamageTypeLabel: () => '',
      targetStore: { targetActorId: null },
      chatStore: {
        sendMessage: (_formula, _type, rollData, _cardData, chatOptions) => {
          rolls.push(rollData);

          return sent.push(chatOptions);
        },
      },
      buildDamageChatBlock,
      buildActionChatHeader,
      buildCombatChatOptions,
      buildSpeakerChatOptions,
      DICE_ROLL_LABELS: {},
    },
  );

  performSimpleRoll([]);

  return window.returnsRoll ? rolls[0] : sent[0];
}

it('бросок урона окном без цели — строка урона под шапкой, чем бьют', async () => {
  const roll = await rollWindowWithoutAttack({
    formula: '1к8+3',
    damageType: 'force',
    returnsRoll: true,
  });

  // Сообщение собрано в другом контексте исполнения: сравнивается копия
  assert.deepEqual(JSON.parse(JSON.stringify(roll.block)), {
    title: 'Раздирание',
    rows: [{ name: 'force', value: '10' }],
  });
});

it('лечение окном броска блока урона не получает', async () => {
  const roll = await rollWindowWithoutAttack({
    formula: '1к8',
    isHealing: true,
    returnsRoll: true,
  });

  assert.equal(roll.block, undefined);
});

it('бросок урона без цели выделяется и без известного типа урона', async () => {
  assert.deepEqual(
    await rollWindowWithoutAttack({ formula: '1к8+3', damageType: 'force' }),
    DAMAGE_CHAT_OPTIONS,
  );

  assert.deepEqual(
    await rollWindowWithoutAttack({ formula: '1к8+3' }),
    DAMAGE_CHAT_OPTIONS,
  );
});

it('лечение и проверка окном броска остаются обычными', async () => {
  assert.deepEqual(
    await rollWindowWithoutAttack({ formula: '1к8', isHealing: true }),
    {},
  );

  assert.deepEqual(await rollWindowWithoutAttack({}), {});
});

it('бросок урона подписывается атакующим, а не выделенным токеном', async () => {
  assert.deepEqual(
    await rollWindowWithoutAttack({
      formula: '1к8+3',
      attackerId: 'familiar',
    }),
    { ...DAMAGE_CHAT_OPTIONS, speakerEntityId: 'familiar' },
  );
});
