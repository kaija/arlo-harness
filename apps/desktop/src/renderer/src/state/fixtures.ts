import { BUILTIN_TOOL_RISK_LEVELS, type AgentId, type BuiltinToolName } from '@arlo/shared';
import type { ChatItem, PersonaConfig, PlatformState, Task, Thread, ToolEntry } from './model.js';

/*
 * Sample workspace used until the renderer API (T20) streams real state. It is
 * the scenario from the Claude Design mockup: an Orchestrator splitting a
 * weekly check into an earnings summary and a Google Ads budget review.
 */

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const ORCHESTRATOR: AgentId = 'orchestrator';
export const ADS: AgentId = 'persona:google-ads';
export const STOCK: AgentId = 'persona:stock-research';
export const FINANCE: AgentId = 'persona:financial-reports';
export const REPORTS: AgentId = 'persona:performance-reports';

/** Local wall-clock time `daysAgo` days before `now`, at hh:mm. */
function at(now: number, daysAgo: number, hours: number, minutes: number): number {
  const date = new Date(now - daysAgo * DAY);
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
}

function nextWeekdayAt(now: number, hours: number, minutes: number, weekdays: number[]): number {
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(now + offset * DAY);
    candidate.setHours(hours, minutes, 0, 0);
    if (candidate.getTime() > now && weekdays.includes(candidate.getDay())) {
      return candidate.getTime();
    }
  }
  return now + DAY;
}

function builtin(key: BuiltinToolName, description: string): ToolEntry {
  return { key, description, source: { kind: 'built-in' }, risk: BUILTIN_TOOL_RISK_LEVELS[key] };
}

function userThread(agentId: AgentId, createdAt: number, lastActivityAt: number): Thread {
  const id =
    agentId === ORCHESTRATOR ? 'user:orchestrator' : `user:${agentId.slice('persona:'.length)}`;
  return { id, agentId, source: 'user', title: '直接對話', createdAt, lastActivityAt };
}

function personaConfig(
  partial: Partial<PersonaConfig> & Pick<PersonaConfig, 'workdir'>,
): PersonaConfig {
  return {
    enabled: true,
    systemPrompt: '',
    maxConcurrency: 1,
    delegationTimeoutMinutes: 30,
    browserEnabled: false,
    signedInSites: [],
    skills: [],
    mcpServers: [],
    tools: [],
    eventTriggers: [],
    webhook: { url: '', tokenLast4: '' },
    ...partial,
  };
}

export function createFixtureState(now: number = Date.now()): PlatformState {
  const weeklyStart = now - (14 * MINUTE + 22 * SECOND);
  const adsWaitingSince = now - (2 * MINUTE + 10 * SECOND);
  const authAt = now - (6 * MINUTE + 2 * SECOND);
  const premarketAt = at(now, 0, 8, 30);
  const yesterdayMovers = at(now, 1, 22, 0);

  const tasks: Record<string, Task> = {
    'task-weekly': {
      id: 'task-weekly',
      agentId: ORCHESTRATOR,
      threadId: 'user:orchestrator',
      title: '財報 + 廣告週檢',
      brief: '整理台積電 Q3 財報重點，同時檢查我們 Google Ads 上週成效，需要調整的地方先跟我確認。',
      state: 'running',
      createdAt: weeklyStart,
      startedAt: weeklyStart,
      steps: [
        { label: '拆解任務並挑選 Persona', state: 'done' },
        { label: '指派 股票研究員 · async', state: 'done' },
        { label: '等待 Google Ads 投放員 回報', state: 'running' },
      ],
      lastAction: { text: '把廣告預算變更標記為需人工批准', at: adsWaitingSince },
    },
    'task-stock-q3': {
      id: 'task-stock-q3',
      agentId: STOCK,
      parentId: 'task-weekly',
      threadId: 'ctx-stock-q3',
      title: '台積電 Q3 財報摘要',
      brief: '抓取台積電 Q3 財報與法說會重點，並與聯電、三星同期毛利率比較，輸出一頁摘要。',
      state: 'running',
      mode: 'async',
      createdAt: weeklyStart + 20 * SECOND,
      startedAt: weeklyStart + 22 * SECOND,
      steps: [
        { label: '取得 Q3 財報 PDF', state: 'done' },
        { label: '擷取法說會逐字稿', state: 'done' },
        { label: '取得聯電 Q3 財報', state: 'done' },
        { label: '比較聯電、三星毛利率', state: 'running' },
        { label: '輸出一頁摘要', state: 'queued' },
      ],
      lastAction: { text: '擷取法說會逐字稿 · 4 頁', at: now - 5 * MINUTE },
    },
    'task-ads-budget': {
      id: 'task-ads-budget',
      agentId: ADS,
      parentId: 'task-weekly',
      threadId: 'ctx-ads-budget',
      title: 'Google Ads 預算調整建議',
      brief: '檢視上週各廣告組 ROAS，提出預算調整建議並在執行前取得批准。',
      state: 'waiting',
      mode: 'async',
      createdAt: weeklyStart + 25 * SECOND,
      startedAt: weeklyStart + 27 * SECOND,
      waitingSince: adsWaitingSince,
      steps: [
        { label: '拉取 7 日廣告成效', state: 'done' },
        { label: '計算各廣告組 ROAS', state: 'done' },
        { label: '產生預算調整建議', state: 'done' },
        { label: 'update_campaign_budget 待批准', state: 'waiting' },
      ],
      lastAction: { text: '需要人工批准 update_campaign_budget', at: adsWaitingSince },
    },
    'task-fin-weekly': {
      id: 'task-fin-weekly',
      agentId: FINANCE,
      parentId: 'task-weekly',
      threadId: 'ctx-fin-weekly',
      title: '整理成一頁週報',
      brief: '等兩份結果回來後，整理成一頁週報：三行結論在前，細節表格在後。',
      state: 'queued',
      mode: 'async',
      createdAt: weeklyStart + 30 * SECOND,
      steps: [],
    },
    'task-reports-export': {
      id: 'task-reports-export',
      agentId: REPORTS,
      threadId: 'ctx-reports-export',
      title: '每週成效匯出',
      brief: '匯出 GA4 上週成效報表並存成 CSV。',
      state: 'running',
      createdAt: now - 22 * MINUTE,
      startedAt: now - 22 * MINUTE,
      steps: [
        { label: '取得 GA4 權杖', state: 'done' },
        { label: 'ga4_report 401 invalid_grant', state: 'error' },
        { label: '等待行程重啟後重試', state: 'waiting' },
      ],
      lastAction: { text: 'Tool error · ga4_report 401', at: now - 19 * MINUTE },
    },
    'task-movers': {
      id: 'task-movers',
      agentId: ORCHESTRATOR,
      threadId: 'user:orchestrator',
      title: '昨日美股盤後異動整理',
      brief: '整理昨日美股盤後異動，標出與持股相關的標的。',
      state: 'done',
      createdAt: yesterdayMovers,
      startedAt: yesterdayMovers,
      endedAt: yesterdayMovers + 6 * MINUTE + 41 * SECOND,
      steps: [
        { label: '指派 股票研究員 · sync', state: 'done' },
        { label: '寄出摘要', state: 'done' },
      ],
      result: '12 檔異動，3 檔與持股相關，已寄出摘要。',
    },
    'task-stock-movers': {
      id: 'task-stock-movers',
      agentId: STOCK,
      parentId: 'task-movers',
      threadId: 'ctx-stock-movers',
      title: '美股盤後異動清單',
      brief: '列出昨日盤後漲跌超過 5% 的美股，標出持股相關者。',
      state: 'done',
      mode: 'sync',
      createdAt: yesterdayMovers + 10 * SECOND,
      startedAt: yesterdayMovers + 12 * SECOND,
      endedAt: yesterdayMovers + 6 * MINUTE,
      steps: [
        { label: '抓取盤後行情', state: 'done' },
        { label: '比對持股清單', state: 'done' },
      ],
      result: '12 檔異動，3 檔與持股相關。',
    },
    'task-stock-premarket': {
      id: 'task-stock-premarket',
      agentId: STOCK,
      threadId: 'ctx-stock-premarket',
      title: '每日開盤前摘要',
      brief: '整理開盤前需要注意的三件事。',
      state: 'done',
      createdAt: premarketAt,
      startedAt: premarketAt,
      endedAt: premarketAt + 3 * MINUTE,
      steps: [{ label: '整理三件事', state: 'done' }],
      result: '三件事已整理完成。',
    },
    'task-stock-drop': {
      id: 'task-stock-drop',
      agentId: STOCK,
      threadId: 'ctx-stock-drop',
      title: '持股跌幅超過 3% 觸發',
      brief: '查明持股下跌原因。',
      state: 'failed',
      createdAt: at(now, 1, 13, 12),
      startedAt: at(now, 1, 13, 12),
      endedAt: at(now, 1, 13, 14),
      steps: [
        { label: '搜尋相關新聞', state: 'done' },
        { label: '開啟新聞來源', state: 'error' },
      ],
    },
    'task-stock-webhook': {
      id: 'task-stock-webhook',
      agentId: STOCK,
      threadId: 'ctx-stock-webhook',
      title: '外部系統推送的法說會通知',
      brief: '整理法說會通知中的日期與議程。',
      state: 'queued',
      createdAt: now - 3 * DAY,
      steps: [],
    },
    'task-fin-archive': {
      id: 'task-fin-archive',
      agentId: FINANCE,
      threadId: 'ctx-fin-archive',
      title: '上週財報彙整',
      brief: '彙整上週各公司財報重點並歸檔。',
      state: 'done',
      createdAt: at(now, 1, 21, 20),
      startedAt: at(now, 1, 21, 20),
      endedAt: at(now, 1, 21, 40),
      steps: [{ label: '彙整並歸檔', state: 'done' }],
      result: '上一輪任務已完成並歸檔。',
    },
  };

  const threads: Record<string, Thread> = {};
  const addThread = (thread: Thread) => {
    threads[thread.id] = thread;
  };
  addThread(userThread(ORCHESTRATOR, now - 7 * DAY, now - 2 * MINUTE));
  addThread(userThread(STOCK, now - 7 * DAY, now - 40 * SECOND));
  addThread(userThread(ADS, now - 7 * DAY, now - 3 * DAY));
  addThread(userThread(FINANCE, now - 7 * DAY, now - 4 * DAY));
  addThread(userThread(REPORTS, now - 7 * DAY, now - 5 * DAY));
  for (const task of Object.values(tasks)) {
    if (task.threadId.startsWith('user:')) continue;
    const source = task.parentId
      ? 'orchestrator'
      : task.id === 'task-stock-drop'
        ? 'event'
        : task.id === 'task-stock-webhook'
          ? 'webhook'
          : 'schedule';
    addThread({
      id: task.threadId,
      agentId: task.agentId,
      source,
      title: task.title,
      createdAt: task.createdAt,
      lastActivityAt: task.lastAction?.at ?? task.endedAt ?? task.createdAt,
      taskId: task.id,
    });
  }

  const threadItems: Record<string, ChatItem[]> = {
    'user:orchestrator': [
      {
        id: 'o1',
        kind: 'user',
        at: weeklyStart,
        text: '整理台積電 Q3 財報重點，同時檢查我們 Google Ads 上週成效，需要調整的地方先跟我確認。',
      },
      {
        id: 'o2',
        kind: 'agent',
        agentId: ORCHESTRATOR,
        at: weeklyStart + 5 * SECOND,
        text: '這是兩件獨立的工作，我會分派給兩個 Persona 並行處理。',
      },
      {
        id: 'o3',
        kind: 'reasoning',
        at: weeklyStart + 5 * SECOND,
        durationMs: 4_200,
        text: '財報部分需要瀏覽器抓 IR 公告，指派股票研究員（描述含「財報與估值分析」）。廣告部分涉及花費變更，屬高風險工具，指派 Google Ads 投放員並要求人工批准。兩者無依賴，採非同步。',
      },
      {
        id: 'o4',
        kind: 'tool',
        at: weeklyStart + 10 * SECOND,
        name: 'list_tasks',
        origin: 'built-in',
        ok: true,
        durationMs: 120,
        input: ['{ "state": "running" }'],
        output: ['[]  · 沒有進行中的委派，四個 Persona 皆可指派'],
      },
      { id: 'o5', kind: 'delegation', at: weeklyStart + 20 * SECOND, taskId: 'task-stock-q3' },
      { id: 'o6', kind: 'delegation', at: weeklyStart + 25 * SECOND, taskId: 'task-ads-budget' },
      { id: 'o7', kind: 'delegation', at: weeklyStart + 30 * SECOND, taskId: 'task-fin-weekly' },
    ],
    'ctx-stock-q3': [
      {
        id: 's1',
        kind: 'agent',
        agentId: ORCHESTRATOR,
        at: weeklyStart + 20 * SECOND,
        text: '抓取台積電 Q3 財報與法說會重點，並與聯電、三星同期毛利率比較，輸出一頁摘要。',
      },
      {
        id: 's2',
        kind: 'reasoning',
        at: weeklyStart + 30 * SECOND,
        durationMs: 2_800,
        text: '先從台積電 IR 頁面取得 Q3 財報與法說會簡報，再找聯電與三星的同期數字。三星的季度拆分可能需要券商研究網站。',
      },
      {
        id: 's3',
        kind: 'browser',
        at: weeklyStart + 40 * SECOND,
        name: 'browser_navigate',
        ok: true,
        durationMs: 1_400,
        lines: [
          '→ url: tsmc.com/chinese/investorRelations',
          '→ 擷取：Q3 毛利率 57.8%、營收 7,596 億',
          '← 3 個 PDF 連結，已下載 2',
        ],
      },
      {
        id: 's4',
        kind: 'agent',
        agentId: STOCK,
        at: authAt - 10 * SECOND,
        text: '已取得台積電與聯電數據，三星需要券商研究網站登入才能看到同期拆分。',
      },
      { id: 's5', kind: 'interrupt', at: authAt, notificationId: 'n-stock-auth' },
      {
        id: 's6',
        kind: 'user',
        at: now - 40 * SECOND,
        text: '先用公開資料的三星數據就好',
        deferred: true,
      },
    ],
    'ctx-ads-budget': [
      {
        id: 'a1',
        kind: 'agent',
        agentId: ORCHESTRATOR,
        at: weeklyStart + 25 * SECOND,
        text: '檢視上週各廣告組 ROAS，提出預算調整建議並在執行前取得批准。',
      },
      {
        id: 'a2',
        kind: 'tool',
        at: weeklyStart + 2 * MINUTE,
        name: 'get_campaign_report',
        origin: 'MCP · ads',
        ok: true,
        durationMs: 2_100,
        input: ['{ "range": "last_7_days", "level": "ad_group" }'],
        output: ['← 5 個廣告組 · 花費 38,420 TWD · 平均 ROAS 3.1'],
      },
      {
        id: 'a3',
        kind: 'agent',
        agentId: ADS,
        at: adsWaitingSince - 20 * SECOND,
        text: '上週 5 個廣告組中，「秋季新品_搜尋」ROAS 4.8 且預算連 5 天提早用盡；其餘維持即可。建議日預算 1,200 → 2,400。',
      },
      { id: 'a4', kind: 'interrupt', at: adsWaitingSince, notificationId: 'n-ads-approval' },
    ],
    'ctx-reports-export': [
      {
        id: 'r1',
        kind: 'system',
        tone: 'info',
        at: now - 22 * MINUTE,
        text: '排程觸發 · 每週成效匯出',
      },
      {
        id: 'r2',
        kind: 'tool',
        at: now - 19 * MINUTE,
        name: 'ga4_report',
        origin: 'MCP · analytics',
        ok: false,
        durationMs: 860,
        input: ['{ "property": "GA4-main", "range": "last_week" }'],
        output: ['401 invalid_grant · 權杖已過期'],
      },
      { id: 'r3', kind: 'interrupt', at: now - 19 * MINUTE, notificationId: 'n-reports-error' },
      {
        id: 'r4',
        kind: 'system',
        tone: 'error',
        at: now - 40 * SECOND,
        text: 'Agent 行程結束，30 秒後重啟（第 3 / 3 次），佇列中的任務會保留。',
      },
    ],
    'ctx-stock-premarket': [
      {
        id: 'p1',
        kind: 'system',
        tone: 'info',
        at: premarketAt,
        text: '排程觸發 · 每日開盤前摘要',
      },
      {
        id: 'p2',
        kind: 'agent',
        agentId: STOCK,
        at: premarketAt + 3 * MINUTE,
        text: '開盤前三件事：一、台積電今天法說會前靜默期；二、聯發科公布 8 月營收；三、美元指數隔夜走強，留意外資賣超。',
      },
    ],
    'ctx-stock-drop': [
      {
        id: 'd1',
        kind: 'system',
        tone: 'info',
        at: at(now, 1, 13, 12),
        text: '事件觸發 · 持股跌幅超過 3%',
      },
      {
        id: 'd2',
        kind: 'browser',
        at: at(now, 1, 13, 14),
        name: 'browser_navigate',
        ok: false,
        durationMs: 30_000,
        lines: ['→ url: news.example.com/markets', '← timeout 30s'],
      },
      {
        id: 'd3',
        kind: 'system',
        tone: 'error',
        at: at(now, 1, 13, 14),
        text: '任務失敗 · 新聞來源逾時',
      },
    ],
    'ctx-stock-webhook': [
      {
        id: 'w1',
        kind: 'system',
        tone: 'info',
        at: now - 3 * DAY,
        text: 'Webhook 收到 · 法說會通知，等待目前任務完成（並行上限 2）',
      },
    ],
    'ctx-fin-weekly': [
      {
        id: 'f1',
        kind: 'agent',
        agentId: ORCHESTRATOR,
        at: weeklyStart + 30 * SECOND,
        text: '等兩份結果回來後，整理成一頁週報：三行結論在前，細節表格在後。',
      },
      {
        id: 'f2',
        kind: 'system',
        tone: 'info',
        at: weeklyStart + 30 * SECOND,
        text: 'queued · 等待 股票研究員 與 Google Ads 投放員 的結果',
      },
    ],
    'ctx-fin-archive': [
      {
        id: 'fa1',
        kind: 'agent',
        agentId: FINANCE,
        at: at(now, 1, 21, 40),
        text: '上週財報彙整完成，已存到工作目錄 reports/2026-w37.md。',
      },
    ],
    'ctx-stock-movers': [
      {
        id: 'm1',
        kind: 'agent',
        agentId: STOCK,
        at: yesterdayMovers + 6 * MINUTE,
        text: '12 檔異動，其中 NVDA、AAPL、TSM 與持股相關。',
      },
    ],
  };

  return {
    locale: 'zh-TW',
    agents: {
      [ORCHESTRATOR]: {
        id: ORCHESTRATOR,
        name: 'Orchestrator',
        initials: 'A',
        description: '拆解任務並派發給 Persona。',
        activity: 'working',
        paused: false,
        model: { providerId: 'openai', model: 'gpt-4o', inherited: true },
        currentTaskId: 'task-weekly',
        queuedTasks: 0,
        activeSince: weeklyStart,
      },
      [ADS]: {
        id: ADS,
        name: 'Google Ads 投放員',
        initials: 'AD',
        description:
          '管理 Google Ads 廣告活動：成效分析、預算與出價調整。任何花費變更都先取得批准。',
        activity: 'waiting',
        paused: false,
        model: { providerId: 'openai', model: 'gpt-4o', temperature: 0.2, inherited: false },
        currentTaskId: 'task-ads-budget',
        queuedTasks: 0,
        activeSince: adsWaitingSince,
        resources: { memoryMb: 386, cpuPercent: 4 },
        browser: {
          tabs: [{ id: 'ads-1', title: 'Google Ads 廣告活動', url: 'ads.google.com/aw/campaigns' }],
          activeTabId: 'ads-1',
          canGoBack: true,
          canGoForward: false,
          driver: 'agent',
          thumbnail: [40, 70, 55],
        },
        config: personaConfig({
          workdir: '~/Library/Application Support/Arlo Harness/personas/google-ads/workdir',
          systemPrompt:
            '你是 Google Ads 投放員。所有花費相關變更必須先說明理由並取得批准；報告一律附上期間與資料來源。',
          browserEnabled: true,
          signedInSites: ['ads.google.com'],
          mcpServers: [
            {
              name: 'ads',
              transport: 'streamable_http',
              target: 'http://127.0.0.1:8931/mcp',
              from: 'template',
              status: 'connected',
              toolCount: 12,
            },
          ],
          tools: [
            builtin('browser_navigate', '開啟網址'),
            builtin('browser_click', '點擊頁面元素'),
            {
              key: 'ads.get_campaign_report',
              description: '讀取廣告成效',
              source: { kind: 'mcp', server: 'ads' },
              risk: 'low',
            },
            {
              key: 'ads.update_campaign_budget',
              description: '變更廣告花費',
              source: { kind: 'mcp', server: 'ads' },
              risk: 'high',
            },
          ],
          webhook: { url: 'http://127.0.0.1:7391/hooks/google-ads', tokenLast4: '9c1e' },
        }),
      },
      [STOCK]: {
        id: STOCK,
        name: '股票研究員',
        initials: 'ST',
        description: '擅長台股與美股財報分析、法說會摘要、同業估值比較。需要瀏覽器抓取 IR 資料。',
        activity: 'working',
        paused: false,
        model: { providerId: 'openai', model: 'gpt-4o', temperature: 0.3, inherited: false },
        currentTaskId: 'task-stock-q3',
        queuedTasks: 2,
        activeSince: weeklyStart + 22 * SECOND,
        resources: { memoryMb: 512, cpuPercent: 22 },
        browser: {
          tabs: [
            { id: 'st-1', title: 'TSMC 投資人關係', url: 'tsmc.com/chinese/investorRelations' },
            { id: 'st-2', title: 'broker research', url: 'research.broker.com.tw/login' },
          ],
          activeTabId: 'st-1',
          canGoBack: true,
          canGoForward: false,
          driver: 'agent',
          focus: { label: 'Q3 2025 法說會資料（PDF）', action: 'click' },
          thumbnail: [55, 35, 72],
        },
        config: personaConfig({
          workdir: '~/Library/Application Support/Arlo Harness/personas/stock-research/workdir',
          systemPrompt: [
            '你是一位嚴謹的財報研究員。原則：',
            '1. 所有數字必須標註來源網址與日期。',
            '2. 不確定的數字標記為「待確認」，不要推估。',
            '3. 遇到需要登入的頁面，請求使用者協助，不要嘗試繞過。',
            '4. 輸出一律先給三行結論，再附細節表格。',
          ].join('\n'),
          maxConcurrency: 2,
          delegationTimeoutMinutes: 30,
          browserEnabled: true,
          signedInSites: ['tsmc.com', 'mops.twse.com.tw'],
          skills: [
            {
              name: 'financial-statement-parse',
              description: '解析財報 PDF 成結構化表格',
              source: 'built-in',
              hasCode: false,
              trusted: true,
              enabled: true,
            },
            {
              name: 'tw-market-scraper',
              description: '抓取公開資訊觀測站',
              source: 'local folder',
              hasCode: true,
              trusted: false,
              enabled: false,
            },
            {
              name: 'valuation-compare',
              description: '同業估值倍數比較模板',
              source: 'local folder',
              hasCode: false,
              trusted: true,
              enabled: true,
            },
            {
              name: 'chart-render',
              description: '產生走勢圖',
              source: 'local folder',
              hasCode: false,
              trusted: true,
              enabled: false,
            },
          ],
          mcpServers: [
            {
              name: 'docs',
              transport: 'stdio',
              target: 'node ~/mcp/docs-server.js',
              from: 'template',
              status: 'connected',
              toolCount: 4,
            },
          ],
          tools: [
            builtin('browser_navigate', '開啟網址'),
            builtin('browser_click', '點擊頁面元素'),
            builtin('browser_evaluate', '在頁面執行 JavaScript'),
            builtin('fs_write', '寫入工作目錄'),
            {
              key: 'docs.fetch_pdf',
              description: '下載並解析 PDF',
              source: { kind: 'mcp', server: 'docs' },
              risk: 'low',
            },
            {
              key: 'tw_market_query',
              description: '查詢公開資訊觀測站',
              source: { kind: 'skill', skill: 'tw-market-scraper' },
              risk: 'medium',
            },
          ],
          eventTriggers: [
            {
              event: 'holding.price_drop',
              template: '{{symbol}} 今日下跌 {{change_pct}}%，請查明原因並摘要。',
            },
          ],
          webhook: { url: 'http://127.0.0.1:7391/hooks/stock-research', tokenLast4: '4b7d' },
        }),
      },
      [FINANCE]: {
        id: FINANCE,
        name: '財報整理員',
        initials: 'FR',
        description: '把研究結果整理成表格與一頁摘要，不需要瀏覽器。',
        activity: 'idle',
        paused: false,
        model: { providerId: 'openai', model: 'gpt-4o-mini', temperature: 0.2, inherited: false },
        queuedTasks: 1,
        config: personaConfig({
          workdir: '~/Library/Application Support/Arlo Harness/personas/financial-reports/workdir',
          systemPrompt: '你把雜亂資料整理成表格與摘要。先給三行結論，再附細節表格。',
          tools: [builtin('fs_read', '讀取工作目錄'), builtin('fs_write', '寫入工作目錄')],
        }),
      },
      [REPORTS]: {
        id: REPORTS,
        name: '成效報表員',
        initials: 'RP',
        description: '匯出 GA4 與廣告成效報表，產生每週 CSV。',
        activity: 'error',
        paused: false,
        model: {
          providerId: 'lm-studio',
          model: 'qwen2.5-32b-instruct',
          temperature: 0.2,
          inherited: false,
        },
        currentTaskId: 'task-reports-export',
        queuedTasks: 2,
        restart: { attempt: 3, maxAttempts: 3, nextRetryAt: now + 30 * SECOND, queuedTasks: 2 },
        config: personaConfig({
          workdir:
            '~/Library/Application Support/Arlo Harness/personas/performance-reports/workdir',
          systemPrompt: '你負責匯出成效報表。遇到權杖過期時回報錯誤，不要重試超過一次。',
          mcpServers: [
            {
              name: 'analytics',
              transport: 'stdio',
              target: 'node ~/mcp/ga4-server.js',
              from: 'custom',
              status: 'error',
              toolCount: 3,
              error: '401 invalid_grant',
            },
          ],
          tools: [
            builtin('fs_write', '寫入工作目錄'),
            {
              key: 'analytics.ga4_report',
              description: '匯出 GA4 報表',
              source: { kind: 'mcp', server: 'analytics' },
              risk: 'low',
            },
          ],
        }),
      },
    },
    agentOrder: [ORCHESTRATOR, ADS, STOCK, FINANCE, REPORTS],
    tasks,
    rootTaskIds: ['task-weekly', 'task-movers'],
    threads,
    threadItems,
    notifications: [
      {
        id: 'n-ads-approval',
        severity: 'action_required',
        agentId: ADS,
        title: 'Google Ads 投放員 想執行 update_campaign_budget',
        body: '秋季新品_搜尋 日預算 1,200 → 2,400 TWD',
        at: adsWaitingSince + 10 * SECOND,
        read: false,
        taskId: 'task-ads-budget',
        threadId: 'ctx-ads-budget',
        interrupt: {
          payload: {
            type: 'tool_approval',
            toolName: 'update_campaign_budget',
            args: {
              campaign: '秋季新品_搜尋',
              daily_budget: '1,200 → 2,400 TWD',
              effective: '立即',
            },
            riskLevel: 'high',
            rationale: '該廣告組近 7 日 ROAS 4.8，預算連續 5 天提早用盡，提高上限可再吃量。',
          },
        },
      },
      {
        id: 'n-stock-auth',
        severity: 'action_required',
        agentId: STOCK,
        title: '股票研究員 在券商網站遇到 MFA',
        body: 'research.broker.com.tw 要求 MFA 驗證碼。請在該 Persona 視窗的瀏覽器完成登入，然後按「繼續」，我會沿用同一個登入狀態。',
        at: authAt,
        read: false,
        taskId: 'task-stock-q3',
        threadId: 'ctx-stock-q3',
        interrupt: {
          payload: { type: 'auth_required', site: 'research.broker.com.tw', reason: 'mfa' },
        },
      },
      {
        id: 'n-reports-error',
        severity: 'error',
        agentId: REPORTS,
        title: 'Tool error · ga4_report',
        body: '401 invalid_grant，權杖已過期',
        at: now - 19 * MINUTE,
        read: false,
        taskId: 'task-reports-export',
        threadId: 'ctx-reports-export',
        interrupt: {
          payload: {
            type: 'tool_error',
            toolName: 'ga4_report',
            error: '401 invalid_grant',
            retryable: true,
          },
        },
      },
      {
        id: 'n-movers-done',
        severity: 'success',
        agentId: STOCK,
        title: '背景任務完成 · 昨日美股盤後異動',
        body: '12 檔異動，3 檔與持股相關',
        at: yesterdayMovers + 6 * MINUTE,
        read: true,
        taskId: 'task-movers',
        threadId: 'ctx-stock-movers',
      },
      {
        id: 'n-premarket',
        severity: 'info',
        agentId: STOCK,
        title: '排程觸發 · 每日開盤前摘要',
        body: '每日開盤前摘要已開始執行',
        at: premarketAt,
        read: true,
        taskId: 'task-stock-premarket',
        threadId: 'ctx-stock-premarket',
      },
    ],
    providers: [
      {
        id: 'openai',
        name: 'OpenAI',
        type: 'openai',
        baseUrl: 'api.openai.com/v1',
        keyPreview: 'sk-··········4f2a',
        status: 'connected',
        capabilities: { realtimeVoice: true, speechToText: true },
        models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1'],
      },
      {
        id: 'lm-studio',
        name: 'Local LM Studio',
        type: 'openai_compatible',
        baseUrl: '127.0.0.1:1234/v1',
        keyPreview: 'lm-··········0000',
        status: 'invalid_key',
        lastError: { message: '401 Unauthorized', at: at(now, 0, 9, 12) },
        capabilities: { realtimeVoice: false, speechToText: false },
        models: ['qwen2.5-32b-instruct'],
      },
    ],
    defaults: { providerId: 'openai', model: 'gpt-4o' },
    orchestratorPrompt:
      '你是 Orchestrator。把使用者的任務拆成互不依賴的子任務，依 Persona 描述挑選最合適的執行者；涉及花費或不可逆操作時，確保由使用者批准。',
    mcpTemplates: [
      {
        name: 'docs',
        transport: 'stdio',
        target: 'node ~/mcp/docs-server.js',
        from: 'template',
        status: 'connected',
        toolCount: 4,
      },
      {
        name: 'ads',
        transport: 'streamable_http',
        target: 'http://127.0.0.1:8931/mcp',
        from: 'template',
        status: 'connected',
        toolCount: 12,
      },
    ],
    schedules: [
      {
        id: 'sch-premarket',
        name: '每日開盤前摘要',
        cron: '30 8 * * 1-5',
        cronText: '平日 08:30',
        timezone: 'Asia/Taipei',
        agentId: STOCK,
        enabled: true,
        template:
          '現在是 {{current_time}}。請整理 {{date}} 開盤前需要注意的三件事，含持股相關新聞與法說會行程。',
        lastRun: { at: premarketAt, status: 'done' },
        nextRunAt: nextWeekdayAt(now, 8, 30, [1, 2, 3, 4, 5]),
        continueThread: false,
      },
      {
        id: 'sch-ads-weekly',
        name: '廣告成效週檢',
        cron: '0 9 * * 1',
        cronText: '每週一 09:00',
        timezone: 'Asia/Taipei',
        agentId: ADS,
        enabled: true,
        template: '檢視 {{date}} 之前 7 天的廣告成效，列出 ROAS 低於 2 的廣告組。',
        lastRun: {
          at: at(now, (new Date(now).getDay() + 6) % 7 || 7, 9, 0),
          status: 'skipped',
          note: 'App 未開啟',
        },
        nextRunAt: nextWeekdayAt(now, 9, 0, [1]),
        continueThread: true,
      },
      {
        id: 'sch-reports-export',
        name: '每週成效匯出',
        cron: '35 9 * * *',
        cronText: '每天 09:35',
        timezone: 'Asia/Taipei',
        agentId: REPORTS,
        enabled: true,
        template: '匯出 {{date}} 前一週的 GA4 成效報表。',
        lastRun: { at: now - 22 * MINUTE, status: 'failed', note: 'ga4_report 401' },
        nextRunAt: nextWeekdayAt(now, 9, 35, [0, 1, 2, 3, 4, 5, 6]),
        continueThread: false,
      },
    ],
    notificationSettings: {
      toastEnabled: true,
      toastMinSeverity: 'warning',
      rules: [
        {
          id: 'rule-telegram',
          name: 'action required → Telegram',
          target: 'api.telegram.org/bot···/sendMessage',
          detail: 'body: {{title}} — {{agent}}',
          enabled: true,
        },
        {
          id: 'rule-ntfy',
          name: 'error（來源：任何 Persona）→ ntfy',
          target: 'ntfy.sh/arlo-alerts',
          detail: 'header: Priority: high',
          enabled: false,
        },
      ],
    },
    advanced: {
      otlpEnabled: false,
      otlpEndpoint: 'http://127.0.0.1:4318/v1/traces',
      traceRetentionDays: 90,
      notificationRetentionDays: 30,
      cdpPort: 9222,
      webhookPort: 7391,
      databasePath: '~/Library/Application Support/Arlo Harness/arlo.db',
      version: '0.1.0',
    },
    runs: [
      {
        id: 'run-st-1',
        agentId: STOCK,
        threadId: 'ctx-stock-q3',
        index: 1,
        startedAt: weeklyStart + 22 * SECOND,
      },
      {
        id: 'run-st-2',
        agentId: STOCK,
        threadId: 'ctx-stock-q3',
        index: 2,
        startedAt: weeklyStart + 4 * MINUTE,
      },
      {
        id: 'run-st-3',
        agentId: STOCK,
        threadId: 'ctx-stock-q3',
        index: 3,
        startedAt: authAt - 40 * SECOND,
      },
      {
        id: 'run-ad-1',
        agentId: ADS,
        threadId: 'ctx-ads-budget',
        index: 1,
        startedAt: weeklyStart + 27 * SECOND,
      },
    ],
    spans: [
      {
        id: 'sp1',
        runId: 'run-st-1',
        name: 'model.call',
        kind: 'model',
        startMs: 0,
        durationMs: 2_900,
        tokens: 6_120,
        detail: 'gpt-4o · 1 tool call',
      },
      {
        id: 'sp2',
        runId: 'run-st-1',
        name: 'browser_navigate',
        kind: 'browser',
        startMs: 2_950,
        durationMs: 1_400,
        detail: 'tsmc.com/chinese/investorRelations',
      },
      {
        id: 'sp3',
        runId: 'run-st-2',
        name: 'model.call',
        kind: 'model',
        startMs: 0,
        durationMs: 2_400,
        tokens: 8_310,
        detail: 'gpt-4o · 2 tool calls',
      },
      {
        id: 'sp4',
        runId: 'run-st-2',
        name: 'docs.fetch_pdf',
        kind: 'mcp',
        startMs: 2_450,
        durationMs: 3_900,
        detail: 'q3-2025-presentation.pdf · 42 pages',
      },
      {
        id: 'sp5',
        runId: 'run-st-3',
        name: 'model.call',
        kind: 'model',
        startMs: 0,
        durationMs: 3_180,
        tokens: 9_420,
        detail: 'gpt-4o · 1 tool call',
      },
      {
        id: 'sp6',
        runId: 'run-st-3',
        name: 'browser_navigate',
        kind: 'browser',
        startMs: 3_200,
        durationMs: 1_410,
        detail: 'research.broker.com.tw/login',
      },
      {
        id: 'sp7',
        runId: 'run-st-3',
        name: 'docs.fetch_pdf',
        kind: 'mcp',
        startMs: 4_620,
        durationMs: 2_640,
        detail: 'umc-q3-2025.pdf · 18 pages',
      },
      {
        id: 'sp8',
        runId: 'run-st-3',
        name: 'browser_extract',
        kind: 'tool',
        startMs: 7_270,
        durationMs: 820,
        detail: '毛利率表格 · 3 rows',
      },
      {
        id: 'sp9',
        runId: 'run-st-3',
        name: 'model.call',
        kind: 'model',
        startMs: 8_100,
        durationMs: 2_050,
        tokens: 14_760,
        detail: 'gpt-4o · interrupted: auth_required',
      },
      {
        id: 'sp10',
        runId: 'run-ad-1',
        name: 'model.call',
        kind: 'model',
        startMs: 0,
        durationMs: 2_200,
        tokens: 5_400,
        detail: 'gpt-4o · 1 tool call',
      },
      {
        id: 'sp11',
        runId: 'run-ad-1',
        name: 'ads.get_campaign_report',
        kind: 'mcp',
        startMs: 2_250,
        durationMs: 2_100,
        detail: '5 ad groups',
      },
      {
        id: 'sp12',
        runId: 'run-ad-1',
        name: 'model.call',
        kind: 'model',
        startMs: 4_400,
        durationMs: 1_900,
        tokens: 7_880,
        detail: 'gpt-4o · interrupted: tool_approval',
      },
    ],
    onboarded: true,
  };
}
