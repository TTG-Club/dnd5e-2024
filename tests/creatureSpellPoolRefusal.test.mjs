import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it } from 'vitest';

import { systemRoot } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';
import { engine } from './scenarios/_fixtures.mjs';

/**
 * Пустой общий счётчик группы заклинаний существа («3/день на весь список»):
 * щелчок по строке листа говорит причину отказа, как у «N/день каждое».
 *
 * Строка группы с пустым счётчиком получала `canCast: false`, и щелчок молчал
 * — ни уведомления, ни строки в чат (живая проверка 03.10, З1). Теперь строка
 * только гаснет, а щелчок доходит до общего каста, и тот отказывает сам.
 */

const CREATURE_SPELL_PATH = 'src/client/composables/creatureSpellCast.ts';

/** «Туманный шаг» из группы с общим счётчиком */
const MISTY_STEP = { id: 'misty-step', name: 'Туманный шаг', level: 2 };

/** Группа «3/день на весь список», счётчик пуст */
const EMPTY_POOL = {
  id: 'group_pool',
  mode: 'perDayPool',
  uses: { current: 0, max: 3 },
  spells: [{ spellId: MISTY_STEP.id }],
};

/** Существо с этой группой */
const MAGE = {
  id: 'creature_mage',
  name: 'Маг',
  spells: [MISTY_STEP],
  system: { spellcastingBlocks: [{ id: 'block', groups: [EMPTY_POOL] }] },
};

/** Подписи отказа — как на листе */
const LABELS = {
  noUsesTitle: 'Нет зарядов',
  noUsesText: 'Не осталось зарядов',
};

describe('пустой общий счётчик группы заклинаний существа', () => {
  it('каст отказывает с причиной «нет зарядов» и ничего не тратит', async () => {
    const refusals = [];

    const start = await loadHandler(
      CREATURE_SPELL_PATH,
      'startCreatureSpellCast',
      {
        readCreature: () => MAGE,
        resolveSpellCastBlock: () => null,
        listAmbientEffects: () => [],
        retypeCasterSpellDamage: (spell) => spell,
        hasLiveCreatureSpellUsesLeft: engine.hasLiveCreatureSpellUsesLeft,
        ACTOR_SPELLS_TAB_LABELS: LABELS,
      },
    );

    start(
      MISTY_STEP,
      { block: MAGE.system.spellcastingBlocks[0], group: EMPTY_POOL, ref: {} },
      {
        creatureId: MAGE.id,
        spendUse: () => assert.fail('заряд не тратится'),
        refuse: (_spell, refusal) => refusals.push(refusal),
      },
    );

    assert.equal(refusals.length, 1);
    assert.equal(refusals[0].title, LABELS.noUsesTitle);
    assert.equal(refusals[0].description, LABELS.noUsesText);
  });

  it('строка группы с пустым счётчиком гаснет, но щелчок до каста доходит', () => {
    const card = readFileSync(
      join(systemRoot, 'src/client/ui/creature/CreatureSpellBlockCard.vue'),
      'utf8',
    );

    assert.match(card, /:can-cast="!isReadOnly"/u);
    assert.match(card, /:group-exhausted="groupView\.isExhausted"/u);
    assert.doesNotMatch(card, /:can-cast="[^"]*isExhausted/u);

    const row = readFileSync(
      join(systemRoot, 'src/client/ui/creature/CreatureSpellRow.vue'),
      'utf8',
    );

    const start = row.indexOf('function handleCast');
    const handler = row.slice(start, row.indexOf('\n  }\n', start));

    assert.doesNotMatch(
      handler,
      /xhausted/u,
      'пустой счётчик щелчок не глотает',
    );
  });
});
