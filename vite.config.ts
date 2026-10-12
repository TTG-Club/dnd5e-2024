import type { UserConfig } from 'vite';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import ui from '@nuxt/ui/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig, mergeConfig } from 'vite';
import { z } from 'zod';

import { devHostModules } from './scripts/lib/devHostModules.mjs';
import {
  ENGINE_PART,
  ENGINE_PART_NOTICE,
  ENGINE_PART_PATHS,
  SERVER_PART,
  SERVER_PART_NOTICE,
  SERVER_PART_PATHS,
  STALE_PART_EVENT,
} from './src/client/systemDevConsts';

/**
 * Сборка клиентской части системы ВНЕ приложения VTTG.
 *
 * Отличие от внутренней сборки: движок правил живёт здесь же (`src/engine`), а
 * нейтральное ядро (`@vtt/shared`) и внутренние модули приложения (`@/…`)
 * помечены EXTERNAL и резолвятся в рантайме из `globalThis.__VTTHost`; `vue` —
 * из `globalThis.Vue`. Так система не задваивает синглтоны приложения.
 *
 * Четыре настройки ниже обязательны для библиотечной IIFE-сборки (см.
 * комментарии по месту): `define` process.env, `interop: 'esModule'`,
 * отключение авто-импорта компонентов Nuxt UI и переписывание динамических
 * `import('@/…')`.
 */

/** Внутренние модули приложения — резолвятся из `globalThis.__VTTHost`. */
const HOST_MODULE_IDS: string[] = [
  '@/core/actorDragState',
  '@/core/api/chatService',
  '@/core/api/rollRequestService',
  '@/core/clientHooks',
  '@/core/compendiumAuthoringClient',
  '@/core/compendiumDataClient',
  '@/core/entityDragState',
  '@/core/entityUtils',
  '@/core/extensionRegistry',
  '@/core/mimeTypes',
  '@/core/registries',
  '@/core/registries/macroRegistry',
  '@/core/tokenConsts',
  '@/core/utils/hotbarDrag',
  '@/shared_ui/components',
  '@/shared_ui/components/AssetBrowser.vue',
  '@/shared_ui/components/CardErrorFallback.vue',
  '@/shared_ui/components/EntityCard.vue',
  '@/shared_ui/components/FieldGroupReset.vue',
  '@/shared_ui/components/FieldsetLabel.vue',
  '@/shared_ui/components/ItemDescriptionRenderer.vue',
  '@/shared_ui/components/JournalEditor.vue',
  '@/shared_ui/components/LightEmitterEditor.vue',
  '@/shared_ui/components/RichTextEditor.vue',
  '@/shared_ui/components/SendToChatButton.vue',
  '@/shared_ui/components/TokenMediaPreview.vue',
  '@/shared_ui/components/UDraggableModal.vue',
  '@/shared_ui/composables',
  '@/shared_ui/composables/useActiveTab',
  '@/shared_ui/composables/useCompendiumView',
  '@/shared_ui/composables/useModalManager',
  '@/shared_ui/consts',
  '@/shared_ui/utils/componentUtils',
  '@/shared_ui/utils/diceRollMarkup',
  '@/shared_ui/utils/domUtils',
  '@/stores/actionPromptStore',
  '@/stores/auraStore',
  '@/stores/chatStore',
  '@/stores/diceRollerStore',
  '@/stores/hotbarStore',
  '@/stores/initiativeStore',
  '@/stores/itemsStore',
  '@/stores/projectileStore',
  '@/stores/spellTemplateStore',
  '@/stores/targetStore',
  '@/stores/worldStore',
  '@/system-runtime/activeSocket',
  '@/system-runtime/sceneSight',
  '@nuxt/ui/composables',
  '@vtt/shared',
  '@vueuse/core',
  'pinia',
];

const EXTERNAL = new Set<string>([...HOST_MODULE_IDS, 'vue']);

/**
 * Порт dev-сервера системы (`npm run dev:hot`). Тот же порт стоит во флаге запуска
 * приложения `VTT_SYSTEM_DEV`.
 */
const DEV_SERVER_PORT = 5174;

/** Точка входа клиента (от корня проекта). */
const CLIENT_ENTRY = 'src/client/systemEntry.ts';

/** Что конфигу нужно от манифеста: id системы. */
const manifestSchema = z.object({ id: z.string().min(1) });

/**
 * id системы. Записан в одном месте — в манифесте; отсюда он нужен dev-серверу,
 * который живёт под адресом `/system-dev/<id>/`.
 */
const { id: systemId } = manifestSchema.parse(
  JSON.parse(readFileSync(path.resolve(__dirname, 'system.json'), 'utf-8')),
);

/**
 * Берётся ли модуль у приложения во время работы.
 *
 * @param id - спецификатор импорта
 * @returns `true` для `vue` и модулей из `HOST_MODULE_IDS`
 */
function isHostModule(id: string): boolean {
  return EXTERNAL.has(id);
}

/**
 * Выражение, которым код системы достаёт модуль приложения.
 *
 * @param id - спецификатор импорта
 * @returns `globalThis.Vue` либо обращение к реестру `__VTTHost`
 */
function hostGlobal(id: string): string {
  return id === 'vue'
    ? 'globalThis.Vue'
    : `globalThis.__VTTHost[${JSON.stringify(id)}]`;
}

const baseConfig: UserConfig = {
  // ОБЯЗАТЕЛЬНО: фиксирует семантику полей класса (`[[Define]]` против
  // `[[Set]]`) для клиентского бандла. Раньше строки не было, и Vite подставлял
  // свой исторический дефолт `false` (он включает `true` только начиная с
  // `target: ES2022` в tsconfig); `false` здесь — ровно он, записанный явно.
  //
  // Явно он нужен потому, что `tsconfig.json` в корне существует ради редактора
  // и объявляет `target: ESNext`. Без этой строки Vite вывел бы флаг из того
  // `target` — то есть настройка РЕДАКТОРА меняла бы бандл. Серверная сборка
  // закрывает то же место своим `tsconfigRaw` в `scripts/build-server.mjs`, но
  // противоположным значением: esbuild вызывается там напрямую, а его
  // собственный дефолт — `true`.
  //
  // ⚠️ `tsconfigRaw` ЗАМЕЩАЕТ файл целиком для трансформации esbuild. Это
  // безопасно: разрешение путей делает сам Vite (`resolve.alias`), а цель
  // выпуска задаёт `build.target`. Проверено сравнением хешей `dist/`.
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        useDefineForClassFields: false,
      },
    },
  },
  plugins: [
    // enforce:'pre' — помечаем EXTERNAL ДО алиас-резолва, чтобы ключ остался в
    // форме `@/…`/`vue` и совпал с ключами `__VTTHost` / `globalThis.Vue`.
    {
      name: 'vttg-host-externals',
      enforce: 'pre',
      resolveId(source: string) {
        if (EXTERNAL.has(source)) {
          return { id: source, external: true };
        }

        // Ассеты ПРИЛОЖЕНИЯ по абсолютному URL (фоны модалок и т.п.). Их отдаёт
        // веб-корень VTTG, а не папка системы, поэтому ссылку надо сохранить
        // как строку.
        //
        // ⚠️ Пометить их EXTERNAL НЕЛЬЗЯ: тогда они попадают под общий маппинг
        // `output.globals` и превращаются в `globalThis.__VTTHost["/assets/…"]`.
        // Такого «модуля» приложение не отдаёт → `undefined`, а `import bg from`
        // читает у него `.default` → «Cannot read properties of undefined» уже
        // при отрисовке листа. Поэтому подставляем КРОШЕЧНЫЙ виртуальный модуль,
        // экспортирующий сам URL: форма импорта сохраняется, адрес не меняется.
        if (source.startsWith('/assets/')) {
          return `\0vttg-app-asset:${source}`;
        }

        return null;
      },
      load(id: string) {
        if (id.startsWith('\0vttg-app-asset:')) {
          const url = id.slice('\0vttg-app-asset:'.length);

          return `export default ${JSON.stringify(url)};`;
        }

        return null;
      },
      // ОБЯЗАТЕЛЬНО: статические импорты внешних модулей Rollup разворачивает в
      // `globalThis.__VTTHost[…]` через `output.globals`, а ДИНАМИЧЕСКИЕ — нет.
      // Оставшийся `import('@/stores/…')` не резолвится в браузере и падает
      // асинхронно («Uncaught (in promise) TypeError») уже ПОСЛЕ того, как
      // система успешно зарегистрировалась — то есть мир открывается, а ломается
      // потом. Подменяем на синхронный резолв из реестра хоста, сохраняя форму
      // промиса с неймспейсом модуля.
      renderDynamicImport({ targetModuleId }) {
        if (targetModuleId && EXTERNAL.has(targetModuleId)) {
          return {
            left: 'Promise.resolve(globalThis.__VTTHost[',
            right: '])',
          };
        }

        return null;
      },
    },
    vue(),
    ui({
      // ОБЯЗАТЕЛЬНО: иначе авто-импорт втянет в бандл ВТОРУЮ копию Nuxt UI и
      // reka-ui, чьи Symbol-контексты не сойдутся с контекстами приложения →
      // падает setup компонентов с provide/inject. Теги резолвятся в рантайме:
      // приложение регистрирует UI-компоненты глобально.
      components: {
        exclude: [/.*/],
        dts: false,
      },
      ui: {
        icons: {
          arrowDown: 'tabler:arrow-down',
          arrowLeft: 'tabler:arrow-left',
          arrowRight: 'tabler:arrow-right',
          arrowUp: 'tabler:arrow-up',
          check: 'tabler:check',
          chevronDoubleLeft: 'tabler:chevrons-left',
          chevronDoubleRight: 'tabler:chevrons-right',
          chevronDown: 'tabler:chevron-down',
          chevronLeft: 'tabler:chevron-left',
          chevronRight: 'tabler:chevron-right',
          chevronUp: 'tabler:chevron-up',
          close: 'tabler:x',
          ellipsis: 'tabler:dots',
          loading: 'tabler:loader-2',
          minus: 'tabler:minus',
          plus: 'tabler:plus',
          search: 'tabler:search',
        },
      },
    }),
  ],
  resolve: {
    alias: [
      // Движок правил системы живёт в этой же репе — инлайнится в бандл.
      {
        find: '@vtt/shared/system/dnd.js',
        replacement: path.resolve(__dirname, './src/engine/index.ts'),
      },
      // Алиаса самоссылок (`@/systems/dnd5e/…` → `src/client`) здесь больше
      // нет: внутри приложения система ссылалась так на свои же файлы, теперь
      // все такие импорты переписаны на относительные пути. Без алиаса новая
      // самоссылка не «починится» молча, а упадёт сборкой как неизвестный
      // модуль хоста — это и нужно, адрес приложения к нашим файлам не ведёт.
    ],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    copyPublicDir: false,
    cssCodeSplit: false,
    lib: {
      entry: path.resolve(__dirname, CLIENT_ENTRY),
      formats: ['iife'],
      name: '__vttgSystemDnd5e2024',
      fileName: () => 'client.js',
      cssFileName: 'client',
    },
    rollupOptions: {
      external: [...EXTERNAL],
      output: {
        inlineDynamicImports: true,
        globals: hostGlobal,
        // ОБЯЗАТЕЛЬНО: в `__VTTHost`/`globalThis.Vue` лежат ES-неймспейсы, а
        // Rollup по умолчанию трактует external как CJS → при `import X from`
        // подставил бы весь объект вместо `X.default`, и `.vue`-компоненты
        // приезжали бы как `Module {default:{…}}` («missing template»).
        interop: 'esModule',
      },
    },
  },
};

/**
 * Настройки, которые нужны только сборке.
 *
 * ОБЯЗАТЕЛЬНО: в `build.lib` Vite не подставляет NODE_ENV (рассчитывает на
 * бандлер-потребитель), а `client.js` грузится тегом `script` прямо в браузер,
 * где `process` не существует → ReferenceError ещё до вызова register().
 * Dev-серверу подстановка не нужна: он делает её сам и со своим значением.
 */
const buildConfig: UserConfig = {
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
};

/**
 * Настройки режима разработки (`npm run dev:hot`): dev-сервер отдаёт исходники
 * прямо в приложение, и правки клиента видны без сборки и перезагрузки
 * страницы. На сборку они не влияют.
 *
 * Со стороны приложения режим включает флаг запуска
 * `VTT_SYSTEM_DEV=<id>=http://localhost:5174/src/client/systemEntry.ts`
 * (README, § «Разработка: правки видно сразу»).
 */
const devServerConfig: UserConfig = {
  // Приложение отдаёт dev-сервер системы под `/system-dev/<id>/` — сам он
  // обязан жить под тем же адресом.
  base: `/system-dev/${systemId}/`,
  server: {
    port: DEV_SERVER_PORT,
    // Занятый порт — это ошибка: молча взятый соседний не совпал бы с флагом
    // запуска приложения.
    strictPort: true,
    // Канал горячей замены страница открывает прямо к dev-серверу системы.
    hmr: { host: 'localhost', clientPort: DEV_SERVER_PORT },
  },
  // Зависимости находим заранее, по точке входа. Без этого dev-сервер
  // натыкался бы на них по ходу работы и каждый раз перезагружал страницу.
  optimizeDeps: {
    entries: [CLIENT_ENTRY],
  },
  plugins: [
    devHostModules({
      isHostModule,
      hostGlobal,
      staleEvent: STALE_PART_EVENT,
      staleParts: [
        {
          name: SERVER_PART,
          paths: SERVER_PART_PATHS,
          notice: SERVER_PART_NOTICE,
        },
        {
          name: ENGINE_PART,
          paths: ENGINE_PART_PATHS,
          notice: ENGINE_PART_NOTICE,
        },
      ],
    }),
  ],
};

export default defineConfig(({ command }) =>
  mergeConfig(baseConfig, command === 'serve' ? devServerConfig : buildConfig),
);
