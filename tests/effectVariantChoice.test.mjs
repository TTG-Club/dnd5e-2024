import assert from 'node:assert/strict';

import { it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';

const engine = await loadEngineBundle(
  "export * from './src/engine/effectVariants.ts';",
);

const helperPath = 'src/client/composables/effectVariantChoice.ts';

/** Случайность на середину: из трёх вариантов выпадает второй */
const MIDDLE_ROLL = 0.5;

/**
 * Эффект варианта.
 *
 * @param {string} name - имя и подпись варианта
 * @param {object} variant - группа и способ выбора
 * @returns {object} эффект
 */
function variantEffect(name, variant) {
  return {
    id: name,
    name,
    disabled: false,
    variant: { label: name, ...variant },
  };
}

/**
 * Настоящий хелпер с портами: плашка и чат записываются.
 *
 * @returns {Promise<object>} хелпер и записи
 */
async function loadHelper() {
  const modals = [];
  const messages = [];

  const run = await loadHandler(helperPath, 'runWithEffectVariants', {
    ...engine,
    rollRandomEffectVariants: (groups) =>
      engine.rollRandomEffectVariants(groups, () => MIDDLE_ROLL),
    useModalManager: () => ({
      openModal: (name, props) => modals.push({ name, props }),
    }),
    useChatStore: () => ({
      sendMessage: (text) => messages.push(text),
    }),
    generateId: (prefix) => `${prefix}_test`,
    EFFECT_VARIANT_MODAL_KEY_PREFIX: 'variant',
    EFFECT_VARIANT_PROMPT_LABELS: { chatSeparator: ': ', chatJoiner: ', ' },
    formatVariantChoices: (name, choices) =>
      `${name}: ${Object.values(choices).join(', ')}`,
  });

  return { run, modals, messages };
}

it('без вариантов действие идёт сразу тем же источником', async () => {
  const { run, modals } = await loadHelper();
  const spell = { name: 'Огненный шар', activeEffects: [{ id: 'burn' }] };

  let proceeded;

  run(spell, (chosen) => {
    proceeded = chosen;
  });

  assert.equal(proceeded, spell);
  assert.equal(modals.length, 0);
});

it('случайная группа бросается сама и пишется в чат', async () => {
  const { run, modals, messages } = await loadHelper();

  const action = {
    name: 'Лучи глаз',
    activeEffects: ['Сон', 'Паралич', 'Страх'].map((name) =>
      variantEffect(name, { group: 'луч', pick: 'random' }),
    ),
  };

  let proceeded;

  run(action, (chosen) => {
    proceeded = chosen;
  });

  assert.equal(modals.length, 0);

  assert.deepEqual(
    proceeded.activeEffects.map((effect) => effect.name),
    ['Паралич'],
  );

  assert.deepEqual(messages, ['Лучи глаз: Паралич']);
});

it('выбор бросающего — плашкой; действие ждёт подтверждения', async () => {
  const { run, modals } = await loadHelper();

  const spell = {
    name: 'Глухота/слепота',
    activeEffects: [
      variantEffect('Слепота', { group: 'чувство' }),
      variantEffect('Глухота', { group: 'чувство' }),
    ],
  };

  let proceeded;

  run(spell, (chosen) => {
    proceeded = chosen;
  });

  assert.equal(proceeded, undefined, 'до выбора действие не идёт');
  assert.equal(modals[0].name, 'EffectVariantPromptModal');
  assert.deepEqual(modals[0].props.groups[0].labels, ['Слепота', 'Глухота']);

  modals[0].props.onConfirm({ чувство: 'Глухота' });

  assert.deepEqual(
    proceeded.activeEffects.map((effect) => effect.name),
    ['Глухота'],
  );
});
