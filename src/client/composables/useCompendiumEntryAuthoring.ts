/**
 * Правка записей своего компендиума мира прямо в окне раздела.
 *
 * Приложение сообщает окну, что раздел открыт для правки, и даёт команды
 * сохранения; какой формой править запись, знает система. Записи правятся теми
 * же формами, что и записи «Мастерской»: запись превращается в предмет для
 * формы, а сохранённое формой — обратно в запись. Форма сама никуда не пишет,
 * поэтому в мир при этом ничего не попадает.
 *
 * @module composables/useCompendiumEntryAuthoring
 */

import type { CompendiumAuthoringTarget } from '@/core/compendiumAuthoringClient';
import type { TypedWebSocketClient } from '@vtt/shared';
import type {
  CompendiumEntryDraft,
  DnDCreature,
} from '@vtt/shared/system/dnd.js';

import { useToast } from '@nuxt/ui/composables';
import { computed } from 'vue';

import {
  deleteCompendiumEntry,
  saveCompendiumEntry,
} from '@/core/compendiumAuthoringClient';
import {
  COMPENDIUM_ENTRY_ORIGIN_FIELD,
  getItemTypeProvider,
} from '@/core/registries';
import { useModalManager } from '@/shared_ui/composables/useModalManager';
import { isRecord } from '@vtt/shared';
import {
  COMPENDIUM_CREATURE_KIND,
  compendiumEntryToWorldItem,
  isDnDGameItem,
  worldCreatureToCompendiumEntry,
  worldItemToCompendiumEntry,
} from '@vtt/shared/system/dnd.js';

import {
  COMPENDIUM_AUTHORING_LABELS,
  COMPENDIUM_ITEM_SECTION_KINDS,
} from '../ui/compendium/constants';

/** Поля записи, которые переживают правку формой (см. `pickPreservedFields`). */
const PRESERVED_ENTRY_FIELDS: readonly string[] = [
  'id',
  COMPENDIUM_ENTRY_ORIGIN_FIELD,
];

/** Что окну раздела нужно для правки записей. */
export interface CompendiumEntryAuthoringOptions {
  /** Актуальный WS-клиент мира */
  getSocket: () => TypedWebSocketClient | null | undefined;
  /** Раздел, открытый для правки; `undefined` — раздел только читается */
  getTarget: () => CompendiumAuthoringTarget | undefined;
  /** Тип записей раздела */
  getKind: () => string | undefined;
}

/**
 * Ключ записи, по которому сервер её находит: `id`, а у определений класса и
 * вида — `key`. Тот же порядок, что у ядра (`compendiumEntryKey`); записи
 * приходят с сервера без проверки формы, поэтому поля читаются с проверкой.
 *
 * @param entry - запись компендиума
 * @returns ключ записи либо `undefined`
 */
function readEntryKey(entry: CompendiumEntryDraft): string | undefined {
  if (typeof entry.id === 'string' && entry.id.length > 0) {
    return entry.id;
  }

  return typeof entry.key === 'string' && entry.key.length > 0
    ? entry.key
    : undefined;
}

/**
 * Поля записи, которые форма правки не знает и не вернёт, а потерять их нельзя:
 * `id` (по нему сервер находит запись; определения класса и вида живут по
 * `key`, и `id` у них может не быть вовсе) и отметка, из какой сущности мира
 * запись сделана, — без неё повторное добавление той же сущности завело бы
 * вторую запись молча.
 *
 * @param entry - правимая запись
 * @returns поля, которые надо вернуть записи после формы
 */
function pickPreservedFields(
  entry: CompendiumEntryDraft,
): CompendiumEntryDraft {
  return Object.fromEntries(
    PRESERVED_ENTRY_FIELDS.filter(
      (field) => typeof entry[field] === 'string',
    ).map((field) => [field, entry[field]]),
  );
}

/**
 * Правка записей своего компендиума мира.
 *
 * Список после правки окно перечитывает само — по оповещению сервера
 * `compendium:updated`, которое приходит и автору правки.
 *
 * @param options - раздел и сокет
 * @returns признаки доступности правки и действия над записями
 */
export function useCompendiumEntryAuthoring(
  options: CompendiumEntryAuthoringOptions,
) {
  const toast = useToast();
  const { openModal } = useModalManager();

  /** Раздел хранит существ: их правит лист существа, а не форма «Мастерской» */
  const isCreatureSection = computed(
    () => options.getKind() === COMPENDIUM_CREATURE_KIND,
  );

  /**
   * Записи раздела можно править средствами системы: раздел открыт для правки,
   * а его тип — существа либо то, что правится формами «Мастерской».
   */
  const canAuthor = computed(() => {
    const kind = options.getKind();

    return (
      options.getTarget() !== undefined
      && kind !== undefined
      && (isCreatureSection.value
        || COMPENDIUM_ITEM_SECTION_KINDS.includes(kind))
    );
  });

  /**
   * Показывает причину, по которой запись не сохранилась.
   *
   * @param description - причина простыми словами
   */
  function reportFailure(description: string): void {
    toast.add({
      title: COMPENDIUM_AUTHORING_LABELS.failedTitle,
      description,
      color: 'error',
      icon: 'tabler:alert-triangle',
    });
  }

  /**
   * Сохраняет в раздел то, что вернула форма.
   *
   * @param kind - тип записей раздела
   * @param saved - объект, сохранённый формой
   * @param preserved - поля правимой записи, которых форма не знает и потому
   *   не возвращает; у новой записи их нет
   */
  async function saveFormResult(
    kind: string,
    saved: unknown,
    preserved: CompendiumEntryDraft,
  ): Promise<void> {
    const target = options.getTarget();
    const item = getItemTypeProvider()?.normalizeSave(saved);

    if (!target || !item || !isDnDGameItem(item)) {
      return;
    }

    const entry = worldItemToCompendiumEntry(kind, item);

    if (entry === null) {
      reportFailure(COMPENDIUM_AUTHORING_LABELS.wrongKind);

      return;
    }

    const result = await saveCompendiumEntry(
      options.getSocket() ?? null,
      target.moduleId,
      target.sectionId,
      { ...entry, ...preserved },
    );

    if (!result.success) {
      reportFailure(result.error);
    }
  }

  /**
   * Открывает лист существа на черновике записи. Лист сохраняет не раз — при
   * каждой правке вне режима редактирования, — поэтому сохранения идут строго
   * по очереди: у новой записи ключ появляется после первого из них, и второе
   * обязано его дождаться, иначе завелась бы вторая запись.
   *
   * @param entry - запись существа; `undefined` — существо новое
   */
  function openCreatureDraft(entry: CompendiumEntryDraft | undefined): void {
    const target = options.getTarget();

    if (!target) {
      return;
    }

    let preserved: CompendiumEntryDraft =
      entry === undefined ? {} : pickPreservedFields(entry);

    let pendingSave: Promise<void> = Promise.resolve();

    /**
     * Сохраняет черновик листа в раздел.
     *
     * @param creature - существо из листа
     */
    const saveDraft = async (creature: DnDCreature): Promise<void> => {
      const result = await saveCompendiumEntry(
        options.getSocket() ?? null,
        target.moduleId,
        target.sectionId,
        { ...worldCreatureToCompendiumEntry(creature), ...preserved },
      );

      if (!result.success) {
        reportFailure(result.error);

        return;
      }

      preserved = { ...preserved, id: result.entryKey };
    };

    openModal('CreatureSheet', {
      initialData: entry,
      socket: options.getSocket() ?? null,
      isAdmin: true,
      draftSave: (creature: DnDCreature) => {
        pendingSave = pendingSave.then(() => saveDraft(creature));
      },
      _modalKey: `compendium-creature:${target.moduleId}/${target.sectionId}/${
        entry === undefined ? '' : (readEntryKey(entry) ?? '')
      }`,
    });
  }

  /** Открывает форму новой записи раздела */
  function createEntry(): void {
    const kind = options.getKind();

    if (!canAuthor.value || kind === undefined) {
      return;
    }

    if (isCreatureSection.value) {
      openCreatureDraft(undefined);

      return;
    }

    getItemTypeProvider()?.openForm(kind, null, {
      socket: options.getSocket() ?? null,
      onSave: (saved) => {
        void saveFormResult(kind, saved, {});
      },
    });
  }

  /**
   * Открывает форму правки записи раздела.
   *
   * @param entry - запись компендиума
   */
  function editEntry(entry: unknown): void {
    const kind = options.getKind();

    if (!canAuthor.value || kind === undefined || !isRecord(entry)) {
      return;
    }

    if (isCreatureSection.value) {
      openCreatureDraft(entry);

      return;
    }

    const item = compendiumEntryToWorldItem(kind, entry);

    if (item === null) {
      reportFailure(COMPENDIUM_AUTHORING_LABELS.unreadable);

      return;
    }

    const preserved = pickPreservedFields(entry);

    getItemTypeProvider()?.openForm(kind, item, {
      socket: options.getSocket() ?? null,
      onSave: (saved) => {
        void saveFormResult(kind, saved, preserved);
      },
    });
  }

  /**
   * Удаляет запись из раздела.
   *
   * @param entry - запись компендиума
   */
  async function removeEntry(entry: unknown): Promise<void> {
    const target = options.getTarget();
    const entryKey = isRecord(entry) ? readEntryKey(entry) : undefined;

    if (!target || entryKey === undefined) {
      return;
    }

    const result = await deleteCompendiumEntry(
      options.getSocket() ?? null,
      target.moduleId,
      target.sectionId,
      entryKey,
    );

    if (!result.success) {
      reportFailure(result.error);
    }
  }

  return { canAuthor, createEntry, editEntry, removeEntry };
}
