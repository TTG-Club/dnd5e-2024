import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';

/**
 * Сохранение черновика листа частичной записью.
 *
 * Лист слал черновик целиком, и сервер заменял им свою сущность: урон и
 * эффекты, пришедшие за время правки, сохранение возвращало назад. Теперь на
 * сервер уходит разница между основой — копией, от которой считали правку, —
 * и черновиком; сервер кладёт её на свою текущую сущность.
 */

const DRAFT_WRITE_PATH = 'src/client/composables/useEntityDraftWrite.ts';

// Движок и разбор правки ядра собираются один раз на файл

const engine = await loadEngineBundle(
  "export * from './src/engine/index.ts'; export { applyEntityPatch, buildEntityPatch } from '@vtt/shared';",
);

// Разделы мира — тем же модулем, что у листов

const sections = await loadEngineBundle(
  "export * from './src/client/composables/worldSheetSections.ts';",
);

/** Ответ сервера: записано */
const ACCEPTED = { ok: true, changed: true };

/** Ответ сервера: правка не легла на его сущность */
const CONFLICT = { ok: false, reason: 'conflict', operationIndex: 0 };

/**
 * Копия сущности без полей прав — как помощник листа.
 *
 * @param {object} entity - сущность
 * @returns {object} сущность без `ownerId` и `ownerIds`
 */
function withoutEntityOwnership(entity) {
  const { ownerId: _ownerId, ownerIds: _ownerIds, ...content } = entity;

  return content;
}

/** Гвард формы для тестов: любая запись с `id` */
const hasId = (value) => typeof value?.id === 'string';

/**
 * Герой с хитами, ячейками и инвентарём.
 *
 * @param {object} [overrides] - поля
 * @returns {object} персонаж
 */
function hero(overrides = {}) {
  return {
    id: 'hero',
    entityType: 'actor',
    name: 'Герой',
    ownerIds: ['player'],
    ownerId: 'player',
    system: { hitPoints: { current: 30, temp: 0 }, slotsUsed: 0 },
    equipment: [
      { id: 'sword', name: 'Меч', quantity: 1 },
      { id: 'potion', name: 'Зелье', quantity: 2 },
    ],
    ...overrides,
  };
}

/**
 * Сервер одной сущности: правку кладёт на СВОЮ сущность, а что не легло —
 * отвергает целиком, как ядро.
 *
 * @param {object} entity - сущность сервера
 * @returns {object} приём правки, журнал запросов и текущая сущность
 */
function createServer(entity) {
  let current = structuredClone(entity);

  const requests = [];

  return {
    requests,
    get entity() {
      return current;
    },
    set entity(next) {
      current = structuredClone(next);
    },
    emitEntityChange: (_socket, before, after) => {
      const operations = engine.buildEntityPatch(before, after);

      requests.push({ entityId: before.id, operations });

      const applied = engine.applyEntityPatch(current, operations);

      if (!applied.ok) {
        return Promise.resolve(CONFLICT);
      }

      current = structuredClone(applied.value);

      return Promise.resolve(ACCEPTED);
    },
  };
}

/**
 * Настоящий `saveEntityDraft` поверх сервера-двойника.
 *
 * @param {object} server - сервер-двойник
 * @returns {Promise<Function>} помощник
 */
function loadSaveEntityDraft(server) {
  return loadHandler(DRAFT_WRITE_PATH, 'saveEntityDraft', {
    emitEntityChange: server.emitEntityChange,
    mergeEntityDraft: engine.mergeEntityDraft,
    withPatchRecordIds: engine.withPatchRecordIds,
    withoutEntityOwnership,
    PATCH_CONFLICT_REASON: 'conflict',
  });
}

describe('saveEntityDraft', () => {
  it('урон, пришедший за время правки, сохранение не возвращает', async () => {
    const base = hero();
    const server = createServer(base);
    const saveEntityDraft = await loadSaveEntityDraft(server);

    // Пока лист был в правке, сервер снял хиты
    server.entity = hero({
      system: { hitPoints: { current: 7, temp: 0 }, slotsUsed: 0 },
    });

    const outcome = await saveEntityDraft({
      socket: {},
      base,
      draft: hero({ name: 'Герой II' }),
      readWorld: () => server.entity,
      isEntity: hasId,
    });

    assert.deepEqual(outcome, ACCEPTED);

    assert.deepEqual(server.requests[0].operations, [
      { op: 'set', path: ['name'], value: 'Герой II' },
    ]);

    assert.equal(server.entity.name, 'Герой II');
    assert.equal(server.entity.system.hitPoints.current, 7);
  });

  it('предмет, выданный за время правки, остаётся рядом с правкой соседнего', async () => {
    const base = hero();
    const server = createServer(base);
    const saveEntityDraft = await loadSaveEntityDraft(server);

    server.entity = hero({
      equipment: [...base.equipment, { id: 'bow', name: 'Лук', quantity: 1 }],
    });

    await saveEntityDraft({
      socket: {},
      base,
      draft: hero({
        equipment: [base.equipment[0], { ...base.equipment[1], quantity: 1 }],
      }),
      readWorld: () => server.entity,
      isEntity: hasId,
    });

    assert.deepEqual(
      server.entity.equipment.map((item) => [item.id, item.quantity]),
      [
        ['sword', 1],
        ['potion', 1],
        ['bow', 1],
      ],
    );
  });

  it('правка не легла — пересобирается от сущности мира и ложится', async () => {
    const base = hero();
    const server = createServer(base);
    const saveEntityDraft = await loadSaveEntityDraft(server);

    // Сервер убрал зелье, а владелец в это время менял его количество и имя
    server.entity = hero({ equipment: [base.equipment[0]] });

    const outcome = await saveEntityDraft({
      socket: {},
      base,
      draft: hero({
        name: 'Герой II',
        equipment: [base.equipment[0], { ...base.equipment[1], quantity: 1 }],
      }),
      readWorld: () => server.entity,
      isEntity: hasId,
    });

    assert.deepEqual(outcome, ACCEPTED);
    assert.equal(server.requests.length, 2, 'одна повторная попытка');
    assert.equal(server.entity.name, 'Герой II');

    // Правка владельца главнее снятия: запись возвращается с его значением
    assert.deepEqual(
      server.entity.equipment.map((item) => [item.id, item.quantity]),
      [
        ['sword', 1],
        ['potion', 1],
      ],
    );
  });

  it('сущности мира нет — отказ возвращается как есть', async () => {
    const base = hero();
    const server = createServer(hero({ equipment: [] }));
    const saveEntityDraft = await loadSaveEntityDraft(server);

    const outcome = await saveEntityDraft({
      socket: {},
      base,
      draft: hero({
        equipment: [{ ...base.equipment[0], quantity: 3 }, base.equipment[1]],
      }),
      readWorld: () => null,
      isEntity: hasId,
    });

    assert.deepEqual(outcome, CONFLICT);
    assert.equal(server.requests.length, 1);
  });

  it('прочий отказ не повторяется', async () => {
    const saveEntityDraft = await loadHandler(
      DRAFT_WRITE_PATH,
      'saveEntityDraft',
      {
        emitEntityChange: () =>
          Promise.resolve({ ok: false, reason: 'forbidden' }),
        mergeEntityDraft: () => {
          throw new Error('Пересборка не нужна');
        },
        withPatchRecordIds: engine.withPatchRecordIds,
        withoutEntityOwnership,
        PATCH_CONFLICT_REASON: 'conflict',
      },
    );

    assert.deepEqual(
      await saveEntityDraft({
        socket: {},
        base: hero(),
        draft: hero({ name: 'Герой II' }),
        readWorld: () => hero(),
        isEntity: hasId,
      }),
      { ok: false, reason: 'forbidden' },
    );
  });
});

/**
 * Настоящий `useEntityDraftWrite` поверх сервера-двойника.
 *
 * @param {object} options - окружение
 * @param {{ value: object | null }} options.draft - черновик
 * @param {object} options.server - сервер-двойник
 * @param {() => object | null} [options.readWorld] - сущность мира; по
 *   умолчанию — сущность сервера
 * @param {(request: object, save: Function) => Promise<object>} [options.send] -
 *   своя отправка вместо настоящей: управляемый ответ либо задержка перед
 *   настоящей отправкой `save`
 * @returns {Promise<object>} помощник и журнал уведомлений
 */
async function loadDraftWrite({ draft, server, readWorld, send }) {
  const toasts = [];
  const saveEntityDraft = await loadSaveEntityDraft(server);

  const useEntityDraftWrite = await loadHandler(
    DRAFT_WRITE_PATH,
    'useEntityDraftWrite',
    {
      useToast: () => ({ add: (toast) => toasts.push(toast) }),
      cloneEntityData: (value) => structuredClone(value),
      saveEntityDraft: send
        ? (request) => send(request, saveEntityDraft)
        : saveEntityDraft,
      buildEntityPatch: engine.buildEntityPatch,
      applyEntityPatch: engine.applyEntityPatch,
      withPatchRecordIds: engine.withPatchRecordIds,
      withoutEntityOwnership,
      buildEntityPatchFailureToast: (outcome, name) =>
        outcome.ok ? null : { title: name, description: outcome.reason },
    },
  );

  const write = useEntityDraftWrite({
    readDraft: () => draft.value,
    readWorld: readWorld ?? (() => server.entity),
    isEntity: hasId,
  });

  return { ...write, toasts };
}

/**
 * Даёт отработать очереди отправок и ответам сервера.
 *
 * @returns {Promise<void>}
 */
function settleAnswers() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

describe('useEntityDraftWrite', () => {
  it('вторая правка подряд шлёт только себя: основу сдвинула записанная первая', async () => {
    const draft = { value: hero() };
    const server = createServer(hero());
    const { rebaseDraft, saveDraft } = await loadDraftWrite({ draft, server });

    rebaseDraft();

    draft.value.name = 'Герой II';
    saveDraft({});
    await settleAnswers();

    draft.value.system.slotsUsed = 1;
    saveDraft({});
    await settleAnswers();

    assert.deepEqual(
      server.requests.map((request) => request.operations),
      [
        [{ op: 'set', path: ['name'], value: 'Герой II' }],
        [{ op: 'set', path: ['system', 'slotsUsed'], value: 1 }],
      ],
    );
  });

  it('две правки в одном тике: каждая уходит сразу и шлёт только себя', async () => {
    const draft = { value: hero() };
    const server = createServer(hero());
    const { rebaseDraft, saveDraft } = await loadDraftWrite({ draft, server });

    rebaseDraft();

    draft.value.name = 'Герой II';
    saveDraft({});
    draft.value.system.slotsUsed = 1;
    saveDraft({});
    await settleAnswers();

    assert.deepEqual(
      server.requests.map((request) => request.operations),
      [
        [{ op: 'set', path: ['name'], value: 'Герой II' }],
        [{ op: 'set', path: ['system', 'slotsUsed'], value: 1 }],
      ],
    );
  });

  it('вторая правка того же раздела не теряется, когда ответ на первую переписал черновик', async () => {
    const draft = { value: hero() };
    const server = createServer(hero());

    const { draftBase, rebaseDraft, saveDraft } = await loadDraftWrite({
      draft,
      server,
    });

    rebaseDraft();

    // Два щелчка подряд в быстрой панели: меч и зелье
    draft.value.equipment[0].quantity = 5;
    saveDraft({});
    draft.value.equipment[1].quantity = 1;
    saveDraft({});

    // Сервер разослал итог первой правки раньше, чем подтвердил её: раздел
    // мира (без второй правки) лёг и в черновик, и в основу
    const afterFirst = hero();

    afterFirst.equipment[0].quantity = 5;
    sections.copyWorldSection(draft.value, afterFirst, 'equipment');
    sections.copyWorldSection(draftBase.value, afterFirst, 'equipment');

    await settleAnswers();

    assert.deepEqual(
      server.entity.equipment.map((item) => [item.id, item.quantity]),
      [
        ['sword', 5],
        ['potion', 1],
      ],
      'вторая правка дошла до сервера',
    );
  });

  it('отказ сервера: основа забывает правку, несохранённое уходит со следующей', async () => {
    const draft = { value: hero() };
    const server = createServer(hero());
    const answers = [{ ok: false, reason: 'noResponse' }];
    const sent = [];

    const { rebaseDraft, saveDraft, toasts } = await loadDraftWrite({
      draft,
      server,
      send: (request) => {
        sent.push(engine.buildEntityPatch(request.base, request.draft));

        return Promise.resolve(answers.shift() ?? ACCEPTED);
      },
    });

    rebaseDraft();

    draft.value.name = 'Герой II';
    saveDraft({});
    await settleAnswers();

    assert.deepEqual(toasts, [
      { title: 'Герой II', description: 'noResponse' },
    ]);

    draft.value.system.slotsUsed = 1;
    saveDraft({});
    await settleAnswers();

    assert.deepEqual(sent[1], [
      { op: 'set', path: ['name'], value: 'Герой II' },
      { op: 'set', path: ['system', 'slotsUsed'], value: 1 },
    ]);

    assert.equal(toasts.length, 1, 'вторая отправка записана');
  });

  it('«Сохранить» в правке: разница от снимка входа, пара снята в момент нажатия', async () => {
    const snapshot = hero();
    const draft = { value: hero({ name: 'Герой II' }) };
    const server = createServer(hero());

    const { draftBase, rebaseDraft, saveDraft } = await loadDraftWrite({
      draft,
      server,
    });

    rebaseDraft();
    draftBase.value = structuredClone(snapshot);

    // Пока лист был в правке, сервер снял хиты, а ведущий сменил управляющих:
    // синхронизация стояла, да и права она не ведёт вовсе
    server.entity = hero({
      ownerIds: ['player', 'friend'],
      system: { hitPoints: { current: 7, temp: 0 }, slotsUsed: 0 },
    });

    saveDraft({}, snapshot);

    // Лист сразу показывает черновик, слитый с миром
    draft.value = hero({
      name: 'Герой II',
      ownerIds: ['player', 'friend'],
      system: { hitPoints: { current: 7, temp: 0 }, slotsUsed: 0 },
    });

    await settleAnswers();

    assert.deepEqual(server.requests[0].operations, [
      { op: 'set', path: ['name'], value: 'Герой II' },
    ]);

    assert.equal(server.entity.system.hitPoints.current, 7, 'урон на месте');

    // Основа догнала мир и получила записанную правку: слать больше нечего
    assert.deepEqual(engine.buildEntityPatch(draftBase.value, draft.value), []);
  });

  it('раздел пришёл из мира, пока правка была в пути, — правка не теряется', async () => {
    const draft = { value: hero() };
    const server = createServer(hero());

    /** Отпускает отправку, задержанную до прихода рассылки */
    let releaseSend = () => {};

    const sendGate = new Promise((resolve) => {
      releaseSend = resolve;
    });

    const { draftBase, rebaseDraft, saveDraft } = await loadDraftWrite({
      draft,
      server,
      send: async (request, save) => {
        await sendGate;

        return save(request);
      },
    });

    rebaseDraft();

    // Сервер ушёл вперёд: убрал зелье. Клиент об этом ещё не знает
    server.entity = hero({ equipment: [hero().equipment[0]] });

    draft.value.equipment[1].quantity = 1;
    draft.value.name = 'Герой II';
    saveDraft({});
    await settleAnswers();

    // Правка в пути. Рассылка чужой правки приходит раньше ответа на нашу:
    // синхронизация кладёт раздел мира и в черновик, и в основу — на месте
    sections.copyWorldSection(draft.value, server.entity, 'equipment');
    sections.copyWorldSection(draftBase.value, server.entity, 'equipment');

    releaseSend();
    await settleAnswers();

    assert.equal(server.requests.length, 2, 'правка не легла и пересобрана');
    assert.equal(server.entity.name, 'Герой II', 'правка владельца записана');

    assert.deepEqual(
      server.entity.equipment.map((item) => [item.id, item.quantity]),
      [
        ['sword', 1],
        ['potion', 1],
      ],
      'отправленное не переписано пришедшим из мира',
    );
  });

  it('устаревшие права черновика на сервер не уходят', async () => {
    const draft = { value: hero() };
    const server = createServer(hero({ ownerIds: ['player', 'friend'] }));
    const { rebaseDraft, saveDraft } = await loadDraftWrite({ draft, server });

    rebaseDraft();

    // Ведущий назначил второго управляющего, лист об этом не знает
    draft.value.name = 'Герой II';
    draft.value.ownerIds = ['player'];
    saveDraft({});
    await settleAnswers();

    assert.deepEqual(server.requests[0].operations, [
      { op: 'set', path: ['name'], value: 'Герой II' },
    ]);

    assert.deepEqual(server.entity.ownerIds, ['player', 'friend']);
  });

  it('сущности в мире ещё нет — на сервер ничего не уходит', async () => {
    const draft = { value: hero() };
    const server = createServer(hero());

    const { rebaseDraft, saveDraft, toasts } = await loadDraftWrite({
      draft,
      server,
      readWorld: () => null,
    });

    rebaseDraft();
    draft.value.name = 'Герой II';
    saveDraft({});
    await settleAnswers();

    assert.equal(server.requests.length, 0);
    assert.equal(toasts.length, 0);
  });
});
