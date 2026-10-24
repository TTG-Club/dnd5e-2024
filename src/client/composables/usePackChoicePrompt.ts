/**
 * Вопрос игроку «из какого компендиума взять запись».
 *
 * Запись одного компендиума ссылается на другую (черта выдаёт заклинание), в её
 * компендиуме такой записи нет, а в мире копий несколько — выбирает тот, кому
 * запись выдаётся. Выбор не запоминается: следующая выдача спросит снова.
 *
 * Спрашивают мастера и лист в разных местах, а окно одно на лист, поэтому
 * вопросы стоят в общей очереди с пометкой персонажа: каждый открытый лист
 * показывает только вопросы своего персонажа, по одному. Ненайденное
 * сообщается уведомлением.
 */

import type { Ref } from 'vue';

import type {
  AmbiguousGrantedSpell,
  GrantedSpellSource,
  RefCandidate,
  RefSearchPack,
  ResolvedGrantedSpell,
} from '@vtt/shared/system/dnd.js';

import type { ChoicePickerOption } from '../ui/actor/ChoicePickerModal.vue';

import { computed, shallowRef, watch } from 'vue';

import {
  classifyRefInPacks,
  toResolvedGrantedSpell,
} from '@vtt/shared/system/dnd.js';

import { useSystemToastStore } from '../stores/systemToastStore';
import { PACK_CHOICE_LABELS } from '../ui/actor/constants';

/** Вопрос в очереди */
interface PackChoiceRequest {
  /** Номер вопроса — отличает одинаковые вопросы друг от друга */
  id: number;
  /** Персонаж, которому выдаётся запись: вопрос показывает его лист */
  actorId: string;
  title: string;
  subtitle: string;
  /** Копии записи по компендиумам: `value` — id компендиума */
  options: ChoicePickerOption[];
  /** Ответ: id компендиума или `null` — игрок закрыл окно */
  answer: (packId: string | null) => void;
}

/** Запись, которую не нашли ни в одном компендиуме мира */
export interface MissingRecord {
  /** Что её выдаёт: умение, черта, класс */
  grantedBy: string;
  /** Ключ, по которому на неё ссылались */
  key: string;
}

/** Строка окна выбора без id компендиума и его подписи — их ставит очередь */
export type CandidateOptionFields = Omit<ChoicePickerOption, 'value' | 'badge'>;

/** Как показать копию записи строкой окна выбора */
export type CandidateOption<TEntry> = (entry: TEntry) => CandidateOptionFields;

/** Где и что искать для {@link resolveRefForActor} */
export interface ActorRefSearch<TEntry> {
  /** Компендиумы мира с записями нужного вида */
  packs: ReadonlyArray<RefSearchPack<TEntry>>;
  /** Ключ ссылки */
  key: string;
  /** Чем запись адресуется внутри пака */
  keyOf: (entry: TEntry) => string | undefined;
  /** Компендиум записи, которая ссылается */
  ownPackId?: string;
  /** Что выдаёт запись — для окна и уведомления */
  grantedBy: string;
  /** Как показать копию строкой окна */
  toOption: CandidateOption<TEntry>;
}

/** Что показать в окне выбора */
interface PackChoiceQuestion {
  title: string;
  subtitle: string;
  options: ChoicePickerOption[];
}

const requests = shallowRef<PackChoiceRequest[]>([]);

let nextRequestId = 0;

/**
 * Ставит вопрос в очередь листа персонажа и ждёт ответа.
 *
 * @param actorId - персонаж, которому выдаётся запись
 * @param question - заголовок, подзаголовок и варианты
 * @returns id выбранного компендиума или `null`, если окно закрыли
 */
function askPackChoice(
  actorId: string,
  question: PackChoiceQuestion,
): Promise<string | null> {
  return new Promise((resolve) => {
    nextRequestId += 1;

    requests.value = [
      ...requests.value,
      { id: nextRequestId, actorId, ...question, answer: resolve },
    ];
  });
}

/**
 * Спрашивает, копию из какого компендиума взять.
 *
 * @param actorId - персонаж, которому выдаётся запись
 * @param candidates - копии записи по компендиумам
 * @param grantedBy - что её выдаёт
 * @param toOption - как показать копию строкой окна
 * @returns выбранная копия; `undefined` — окно закрыли, запись не выдаётся
 */
export async function chooseCandidate<TEntry>(
  actorId: string,
  candidates: ReadonlyArray<RefCandidate<TEntry>>,
  grantedBy: string,
  toOption: CandidateOption<TEntry>,
): Promise<RefCandidate<TEntry> | undefined> {
  const options = candidates.map((candidate) => ({
    ...toOption(candidate.entry),
    value: candidate.packId,
    badge: candidate.packName,
  }));

  const packId = await askPackChoice(actorId, {
    title: `${PACK_CHOICE_LABELS.titlePrefix}${options[0]?.name ?? ''}`,
    subtitle: `${PACK_CHOICE_LABELS.subtitlePrefix}${grantedBy}${PACK_CHOICE_LABELS.subtitleSuffix}`,
    options,
  });

  return candidates.find((candidate) => candidate.packId === packId);
}

/**
 * Предупреждает о записях, которых нет ни в одном компендиуме мира. Через
 * хранилище уведомлений: зовут и из мастера, и из обработчика сброса черты, где
 * `setup` уже позади.
 *
 * @param missing - ненайденные записи
 */
export function reportMissingRecords(
  missing: ReadonlyArray<MissingRecord>,
): void {
  if (missing.length === 0) {
    return;
  }

  useSystemToastStore().add({
    title: PACK_CHOICE_LABELS.missingTitle,
    description: missing
      .map(
        (record) =>
          `${record.grantedBy}${PACK_CHOICE_LABELS.missingSeparator}${record.key}`,
      )
      .join('\n'),
    color: 'warning',
    icon: 'tabler:alert-triangle',
  });
}

/**
 * Находит запись по ссылке для персонажа целиком: свой компендиум → единственный
 * другой → вопрос игроку → уведомление «не найдено».
 *
 * @param actorId - персонаж, которому выдаётся запись
 * @param search - где и что искать
 * @returns найденная копия или `undefined`
 */
export function resolveRefForActor<TEntry>(
  actorId: string,
  search: ActorRefSearch<TEntry>,
): Promise<RefCandidate<TEntry> | undefined> {
  const resolution = classifyRefInPacks(
    search.packs,
    search.key,
    search.keyOf,
    search.ownPackId,
  );

  if (resolution.kind === 'found') {
    return Promise.resolve(resolution.candidate);
  }

  if (resolution.kind === 'missing') {
    reportMissingRecords([{ grantedBy: search.grantedBy, key: search.key }]);

    return Promise.resolve(undefined);
  }

  return chooseCandidate(
    actorId,
    resolution.candidates,
    search.grantedBy,
    search.toOption,
  );
}

/** Запись, которую можно показать строкой окна выбора */
interface DescribedRecord {
  name: string;
  nameEn?: string;
  sourceKey?: string;
  description?: string;
}

/**
 * Строка окна для копии записи: название, английское название, книга и
 * описание по кнопке. Общая для черт и предметов.
 *
 * @param record - копия записи
 * @returns поля строки окна выбора
 */
export function describeCandidate(
  record: DescribedRecord,
): CandidateOptionFields {
  return {
    name: record.name,
    nameEn: record.nameEn,
    sourceKey: record.sourceKey,
    description: record.description,
  };
}

/**
 * Строка окна для копии заклинания: кнопка описания открывает его карточку.
 *
 * @param spell - копия заклинания
 */
function spellOption(
  spell: ResolvedGrantedSpell['spell'],
): CandidateOptionFields {
  return {
    name: spell.name,
    nameEn: spell.nameEn,
    sourceKey: spell.sourceKey,
    spell,
  };
}

/**
 * Разбирает неоднозначные и ненайденные заклинания выдачи: спрашивает игрока и
 * предупреждает. Общий последний шаг всех выдач заклинаний перед записью на
 * лист. Одно и то же заклинание от двух умений спрашивается один раз за выдачу.
 *
 * @param actorId - персонаж, которому выдаются заклинания
 * @param resolution - итог поиска заклинаний по пакам
 * @param resolution.resolved - нашедшиеся однозначно
 * @param resolution.ambiguous - требующие выбора
 * @param resolution.missing - ненайденные
 * @returns все заклинания, которые лягут на лист
 */
export async function finalizeGrantedSpells(
  actorId: string,
  resolution: {
    resolved: ResolvedGrantedSpell[];
    ambiguous: AmbiguousGrantedSpell[];
    missing: GrantedSpellSource[];
  },
): Promise<ResolvedGrantedSpell[]> {
  reportMissingRecords(
    resolution.missing.map((source) => ({
      grantedBy: source.featureName,
      key: source.spellId,
    })),
  );

  const answers = new Map<string, string | undefined>();
  const settled: ResolvedGrantedSpell[] = [];

  for (const { source, candidates } of resolution.ambiguous) {
    if (!answers.has(source.spellId)) {
      // Вопросы идут по одному: следующий ждёт ответа на предыдущий
      const chosen = await chooseCandidate(
        actorId,
        candidates,
        source.featureName,
        spellOption,
      );

      answers.set(source.spellId, chosen?.packId);
    }

    const chosenPackId = answers.get(source.spellId);

    const chosen = candidates.find(
      (candidate) => candidate.packId === chosenPackId,
    );

    if (chosen) {
      settled.push(toResolvedGrantedSpell(source, chosen.entry));
    }
  }

  return [...resolution.resolved, ...settled];
}

/**
 * Очередь вопросов одного листа: текущий вопрос его персонажа и ответ на него.
 *
 * @param actorId - персонаж листа
 */
export function usePackChoiceQueue(actorId: Ref<string | undefined>) {
  /**
   * Вопрос, который лист показывает сейчас. Не computed: окно после «Выбрать»
   * шлёт ещё и «закрыто», и computed к этому моменту уже показывал бы СЛЕДУЮЩИЙ
   * вопрос — закрытие ответило бы на него «ничего». Здесь вопрос снимается
   * ответом, а следующий подставляется наблюдателем на следующем тике.
   */
  const activeQuestion = shallowRef<PackChoiceRequest | undefined>();

  watch(
    [requests, actorId],
    ([queued, currentActorId]) => {
      if (!activeQuestion.value) {
        activeQuestion.value = queued.find(
          (request) => request.actorId === currentActorId,
        );
      }
    },
    { immediate: true },
  );

  /**
   * Отвечает на текущий вопрос и убирает его из очереди.
   *
   * @param packId - выбранный компендиум или `null`, если окно закрыли
   */
  function answerCurrent(packId: string | null): void {
    const current = activeQuestion.value;

    if (!current) {
      return;
    }

    activeQuestion.value = undefined;

    requests.value = requests.value.filter(
      (request) => request.id !== current.id,
    );

    current.answer(packId);
  }

  // Наружу — только чтение: снять вопрос можно лишь ответом на него
  const currentQuestion = computed(() => activeQuestion.value);

  return { currentQuestion, answerCurrent };
}
