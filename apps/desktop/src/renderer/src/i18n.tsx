import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { AppLocale } from './state/model.js';
import { useData, useDispatch } from './state/store.js';

export const LOCALES = [
  { value: 'en', label: 'English' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'ja', label: '日本語' },
] as const satisfies readonly { value: AppLocale; label: string }[];

type MessageKey = keyof typeof messages.en;

const messages = {
  en: {
    'settings.title': 'Global settings',
    'settings.description': 'Providers, schedules, notifications and advanced settings',
    'settings.sections': 'Settings sections',
    'settings.providers': 'Model providers',
    'settings.orchestrator': 'Orchestrator',
    'settings.mcp': 'MCP templates',
    'settings.schedules': 'Schedules',
    'settings.notifications': 'Notifications',
    'settings.advanced': 'Advanced',
    'settings.close': 'Close settings',
    'settings.language': 'Language',
    'settings.languageDescription':
      'Use this language throughout the interface. Changes apply immediately.',
    'settings.interfaceLanguage': 'Interface language',
    'settings.appearance': 'Appearance',
    'settings.appearanceDescription':
      'Choose the color scheme for this device, or follow the system setting. Changes apply immediately.',
    'settings.colorScheme': 'Color scheme',
    'settings.darkMode': 'Dark mode',
    'settings.dark': 'Dark',
    'settings.light': 'Light',
    'settings.system': 'Follow system',
    'settings.advancedTitle': 'Advanced',
    'settings.traceExport': 'Trace export',
    'settings.exportToOtlp': 'Export to OTLP endpoint',
    'settings.retention': 'Data retention',
    'settings.traceAndMessages': 'Traces and messages',
    'settings.notificationsLabel': 'Notifications',
    'settings.localServices': 'Local services',
    'settings.database': 'Database',
    'settings.appUpdates': 'Application updates',
    'settings.currentVersion': 'Current version',
    'settings.checkUpdates': 'Check for updates',
    'main.globalSettings': 'Global settings',
    'main.panel': 'Main panel',
    'main.chat': 'Chat',
    'main.taskTree': 'Task tree',
    'main.tree': 'Tree',
    'main.actionCenter': 'Action center',
    'main.needsYou': 'needs you',
    'main.closeActionCenter': 'Close action center',
    'main.assignTask': 'Assign a new task to {name}…',
    'main.backToOrchestrator': '← Orchestrator',
    'main.orchestratorAlone': 'The Orchestrator is working alone',
    'main.orchestratorAloneDescription':
      'Create a Persona so it can delegate tasks and keep working in the background.',
    'main.createFirstPersona': 'Create your first Persona',
    'main.firstTask': 'Give the Orchestrator its first task.',
  },
  'zh-TW': {
    'settings.title': '全域設定',
    'settings.description': '供應商、排程、通知與進階設定',
    'settings.sections': '設定區段',
    'settings.providers': '模型供應商',
    'settings.orchestrator': '協調器',
    'settings.mcp': 'MCP 範本',
    'settings.schedules': '排程',
    'settings.notifications': '通知',
    'settings.advanced': '進階',
    'settings.close': '關閉設定',
    'settings.language': '語言',
    'settings.languageDescription': '使用這個語言顯示整個介面；變更會立即生效。',
    'settings.interfaceLanguage': '介面語言',
    'settings.appearance': '外觀',
    'settings.appearanceDescription': '選擇此裝置使用的色彩模式；變更會立即生效。',
    'settings.colorScheme': '色彩模式',
    'settings.darkMode': '深色模式',
    'settings.dark': '深色',
    'settings.light': '淺色',
    'settings.system': '跟隨系統',
    'settings.advancedTitle': '進階',
    'settings.traceExport': '追蹤匯出',
    'settings.exportToOtlp': '匯出到 OTLP endpoint',
    'settings.retention': '資料保留',
    'settings.traceAndMessages': '追蹤與訊息',
    'settings.notificationsLabel': '通知',
    'settings.localServices': '本機服務',
    'settings.database': '資料庫',
    'settings.appUpdates': '應用程式更新',
    'settings.currentVersion': '目前版本',
    'settings.checkUpdates': '檢查更新',
    'main.globalSettings': '全域設定',
    'main.panel': '主要面板',
    'main.chat': '對話',
    'main.taskTree': '任務樹',
    'main.tree': '樹狀',
    'main.actionCenter': '行動中心',
    'main.needsYou': '需要你處理',
    'main.closeActionCenter': '關閉行動中心',
    'main.assignTask': '指派新任務給 {name}…',
    'main.backToOrchestrator': '← 協調器',
    'main.orchestratorAlone': '協調器目前只能自己處理任務',
    'main.orchestratorAloneDescription':
      '建立 Persona 後，它就能拆解任務、派發工作，並在背景持續執行。',
    'main.createFirstPersona': '建立第一個 Persona',
    'main.firstTask': '對協調器下達第一個任務。',
  },
  ja: {
    'settings.title': 'グローバル設定',
    'settings.description': 'プロバイダー、スケジュール、通知、詳細設定',
    'settings.sections': '設定セクション',
    'settings.providers': 'モデルプロバイダー',
    'settings.orchestrator': 'オーケストレーター',
    'settings.mcp': 'MCP テンプレート',
    'settings.schedules': 'スケジュール',
    'settings.notifications': '通知',
    'settings.advanced': '詳細',
    'settings.close': '設定を閉じる',
    'settings.language': '言語',
    'settings.languageDescription': 'この言語をアプリ全体で使用します。変更はすぐに反映されます。',
    'settings.interfaceLanguage': '表示言語',
    'settings.appearance': '外観',
    'settings.appearanceDescription':
      'このデバイスの配色を選択するか、システム設定に従います。変更はすぐに反映されます。',
    'settings.colorScheme': '配色',
    'settings.darkMode': 'ダークモード',
    'settings.dark': 'ダーク',
    'settings.light': 'ライト',
    'settings.system': 'システムに従う',
    'settings.advancedTitle': '詳細',
    'settings.traceExport': 'トレースのエクスポート',
    'settings.exportToOtlp': 'OTLP エンドポイントへエクスポート',
    'settings.retention': 'データ保持',
    'settings.traceAndMessages': 'トレースとメッセージ',
    'settings.notificationsLabel': '通知',
    'settings.localServices': 'ローカルサービス',
    'settings.database': 'データベース',
    'settings.appUpdates': 'アプリケーション更新',
    'settings.currentVersion': '現在のバージョン',
    'settings.checkUpdates': 'アップデートを確認',
    'main.globalSettings': 'グローバル設定',
    'main.panel': 'メインパネル',
    'main.chat': 'チャット',
    'main.taskTree': 'タスクツリー',
    'main.tree': 'ツリー',
    'main.actionCenter': 'アクションセンター',
    'main.needsYou': '対応が必要',
    'main.closeActionCenter': 'アクションセンターを閉じる',
    'main.assignTask': '{name} に新しいタスクを依頼…',
    'main.backToOrchestrator': '← オーケストレーター',
    'main.orchestratorAlone': 'オーケストレーターは単独で作業中です',
    'main.orchestratorAloneDescription':
      'Persona を作成すると、タスクの委任とバックグラウンド処理ができます。',
    'main.createFirstPersona': '最初の Persona を作成',
    'main.firstTask': 'オーケストレーターに最初のタスクを依頼しましょう。',
  },
} as const;

function translate(locale: AppLocale, key: MessageKey, values?: Record<string, string | number>) {
  let text: string = messages[locale][key];
  for (const [name, value] of Object.entries(values ?? {})) {
    text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}

interface I18nValue {
  locale: AppLocale;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useData().locale;
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return (
    <I18nContext.Provider value={{ locale, t: (key, values) => translate(locale, key, values) }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useTranslation must be used inside I18nProvider');
  return value;
}

export function useLocaleSelection() {
  const dispatch = useDispatch();
  return (locale: AppLocale) => dispatch({ type: 'settings/setLocale', locale });
}
