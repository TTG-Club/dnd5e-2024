import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadHandler } from './helpers/sourceHandler.mjs';
import { engine } from './scenarios/_fixtures.mjs';

/**
 * Имя другой сущности в чате (`chatTargetNames.ts`): в обычный текст, который
 * получают все, скрытое имя существа не пишется — вместо него заглушка; в блок
 * карточки имя идёт настоящим, вместе с id сущности.
 */

const HELPER_PATH = 'src/client/composables/chatTargetNames.ts';

const hag = {
  id: 'creature_hag',
  name: 'Зелёная карга',
  entityType: 'creature',
  token: { showName: false },
};

const guard = { ...hag, id: 'creature_guard', name: 'Стражник' };

guard.token = { showName: true };

const world = { actors: [], creatures: [hag, guard] };

const ports = {
  useWorldStore: () => ({ currentWorld: world }),
  findEntityInWorld: (currentWorld, entityId) =>
    currentWorld.creatures.find((creature) => creature.id === entityId),
  resolvePublicEntityName: engine.resolvePublicEntityName,
};

const resolvePublicTargetName = await loadHandler(
  HELPER_PATH,
  'resolvePublicTargetName',
  ports,
);

const toChatTarget = await loadHandler(HELPER_PATH, 'toChatTarget', ports);

const toRecordChatTarget = await loadHandler(
  HELPER_PATH,
  'toRecordChatTarget',
  ports,
);

const serializeChatDamageRecord = await loadHandler(
  HELPER_PATH,
  'serializeChatDamageRecord',
  {
    ...ports,
    resolvePublicTargetName,
    serializeAttackDamageRecord: engine.serializeAttackDamageRecord,
  },
);

describe('имя цели для общего текста', () => {
  it('у существа со скрытым именем — заглушка', () => {
    assert.equal(
      resolvePublicTargetName(hag.id, hag.name),
      engine.HIDDEN_ENTITY_NAME,
    );
  });

  it('открытое имя остаётся как есть', () => {
    assert.equal(resolvePublicTargetName(guard.id, guard.name), guard.name);
  });

  it('сущности в мире нет или id не назван — имя остаётся как есть', () => {
    assert.equal(
      resolvePublicTargetName('creature_gone', 'Призрак'),
      'Призрак',
    );

    assert.equal(resolvePublicTargetName(null, hag.name), hag.name);
  });
});

describe('цель для блока карточки', () => {
  it('несёт настоящее имя вместе с id сущности', () => {
    const target = toChatTarget(hag.id, hag.name);

    assert.equal(target.name, hag.name);
    assert.equal(target.entityId, hag.id);
  });

  it('без id — только имя', () => {
    const target = toChatTarget(null, hag.name);

    assert.equal(target.name, hag.name);
    assert.equal('entityId' in target, false);
  });
});

describe('запись об уроне в дополнении чата', () => {
  /** Запись удара по двум целям: скрытое имя и открытое */
  const record = {
    label: 'Когти',
    critical: false,
    parts: [{ formula: '1к6+3', types: ['slashing'] }],
    targets: [hag, guard].map((entity) => ({
      entityId: entity.id,
      name: entity.name,
      hpLost: 4,
      tempLost: 0,
      contributions: [],
    })),
  };

  it('не несёт скрытого имени: запись получают все', () => {
    const payload = serializeChatDamageRecord(record);

    assert.equal(payload.includes(hag.name), false);
    assert.equal(payload.includes(engine.HIDDEN_ENTITY_NAME), true);
    assert.equal(payload.includes(guard.name), true);

    // Сама запись не тронута — по ней ещё строится карточка
    assert.equal(record.targets[0].name, hag.name);
  });

  it('блоку карточки отдаёт настоящее имя из мира', () => {
    const target = toRecordChatTarget({
      entityId: hag.id,
      name: engine.HIDDEN_ENTITY_NAME,
    });

    assert.equal(target.name, hag.name);
    assert.equal(target.entityId, hag.id);
  });

  it('сущности в мире нет — остаётся имя из записи', () => {
    const target = toRecordChatTarget({
      entityId: 'creature_gone',
      name: 'Призрак',
    });

    assert.equal(target.name, 'Призрак');
  });
});
