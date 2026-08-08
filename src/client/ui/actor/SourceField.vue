<script setup lang="ts">
  /**
   * Поле источника записи: аббревиатура и расшифровка на двух языках.
   *
   * Выпадающего списка книг здесь нет намеренно. Набор источников открыт: с
   * сайта в компендиум приезжает что угодно, а свою книгу автор всё равно не
   * найдёт ни в одном справочнике. Поэтому источник вписывается вручную, а
   * связывает записи ключ, выведенный из аббревиатуры
   * (`sourceKeyFromAbbreviation`) — одна и та же аббревиатура даёт один
   * источник, кто бы и где бы её ни вписал.
   *
   * Если аббревиатура узнаётся (встроенная книга или книга из пака), расшифровка
   * подставляется сама и правке не подлежит: название из справочника выверено,
   * и расходиться с ним у записи причин нет.
   */

  import type { SourceDefinition } from '@vtt/shared';

  import { computed, ref, watch } from 'vue';

  import {
    buildSourceDefinition,
    sourceKeyFromAbbreviation,
  } from '@vtt/shared/system/dnd.js';

  import { useSystemDataStore } from '../../stores/systemDataStore';

  const props = withDefaults(
    defineProps<{
      /** Ключ источника записи */
      sourceKey?: string;
      /** Определение источника, вписанное вместе с записью */
      source?: SourceDefinition;
    }>(),
    {
      sourceKey: undefined,
      source: undefined,
    },
  );

  const emit = defineEmits<{
    'update:sourceKey': [value: string | undefined];
    'update:source': [value: SourceDefinition | undefined];
  }>();

  const systemDataStore = useSystemDataStore();

  const abbreviation = ref('');
  const name = ref('');
  const nameEn = ref('');

  /** Источник из справочника, если вписанная аббревиатура узнана */
  const known = computed<SourceDefinition | undefined>(() => {
    const key = sourceKeyFromAbbreviation(abbreviation.value);

    if (!key) {
      return undefined;
    }

    return systemDataStore.sources.find((source) => source.key === key);
  });

  /**
   * Заполняет поля по тому, что уже сохранено на записи. Своё определение
   * приоритетнее справочника: иначе автор, открыв запись на правку, увидел бы не
   * то, что вписывал.
   */
  function seedFromProps(): void {
    const stored =
      props.source
      ?? systemDataStore.sources.find(
        (source) => source.key === props.sourceKey,
      );

    // `local` — прежний псевдоисточник формы («Свой источник» в выпадающем
    // списке). Источником он никогда не был: в справочнике его нет, подписи от
    // него не было. Показывать его как аббревиатуру незачем.
    const legacy = props.sourceKey === 'local' ? undefined : props.sourceKey;

    abbreviation.value = stored?.abbreviation ?? legacy ?? '';
    name.value = stored?.name ?? '';
    nameEn.value = stored?.nameEn ?? '';
  }

  watch(() => [props.sourceKey, props.source], seedFromProps, {
    immediate: true,
  });

  /**
   * Отдаёт наверх ключ и определение. Узнанный источник расшифровку с записи не
   * берёт — она приедет из справочника при показе.
   */
  function emitSource(): void {
    const recognized = known.value;

    const definition =
      recognized
      ?? buildSourceDefinition(abbreviation.value, name.value, nameEn.value);

    emit('update:sourceKey', definition?.key);
    emit('update:source', definition);
  }

  watch([abbreviation, name, nameEn], emitSource);

  /**
   * Запоминает вписанный источник для подсказок в следующих формах — но только
   * когда автор закончил ввод. Иначе в словарь попали бы огрызки аббревиатуры,
   * набранные по букве.
   */
  function rememberOnBlur(): void {
    const definition = buildSourceDefinition(
      abbreviation.value,
      name.value,
      nameEn.value,
    );

    if (definition && !known.value) {
      systemDataStore.rememberSource(definition);
    }
  }
</script>

<template>
  <div class="flex flex-col gap-2">
    <UFormField
      label="Аббревиатура"
      help="По ней записи связываются между собой: одна аббревиатура — один источник"
    >
      <UInput
        v-model="abbreviation"
        placeholder="PHB"
        class="w-full"
        @blur="rememberOnBlur"
      />
    </UFormField>

    <p
      v-if="known"
      class="text-xs text-primary"
    >
      {{ known.name }}<span v-if="known.nameEn"> · {{ known.nameEn }}</span>
    </p>

    <template v-else>
      <UFormField label="Название">
        <UInput
          v-model="name"
          placeholder="Книга игрока"
          class="w-full"
          @blur="rememberOnBlur"
        />
      </UFormField>

      <UFormField label="Английское название">
        <UInput
          v-model="nameEn"
          placeholder="Player's Handbook"
          class="w-full"
          @blur="rememberOnBlur"
        />
      </UFormField>
    </template>
  </div>
</template>
