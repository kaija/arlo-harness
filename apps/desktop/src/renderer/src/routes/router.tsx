import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { TooltipProvider } from '../components/ui/tooltip.js';
import { MainWindow } from '../features/main-window/MainWindow.js';
import { Onboarding } from '../features/onboarding/Onboarding.js';
import { PersonaWindow } from '../features/persona-window/PersonaWindow.js';
import { GlobalSettingsDialog } from '../features/settings/GlobalSettings.js';
import { PersonaSettingsDialog } from '../features/settings/PersonaSettings.js';
import { platformStore } from '../state/store.js';

/*
 * ADR-0007 §2: every window loads the same bundle; the hash picks the window.
 *   #/main                          main window
 *   #/main/settings                 global settings over the main window
 *   #/main/personas/<id>/settings   Persona settings over the main window
 *   #/persona/<id>                  a Persona window
 *   #/persona/<id>/settings         Persona settings over its window
 *   #/welcome                       first run and "new persona"
 */

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined;

export interface MainSearch {
  agent?: string | undefined;
  panel?: 'chat' | 'tree' | undefined;
  task?: string | undefined;
  draft?: string | undefined;
}

export interface PersonaSearch {
  thread?: string | undefined;
}

export interface SettingsSearch {
  tab?: string | undefined;
}

export interface WelcomeSearch {
  step?: 1 | 2 | 3 | undefined;
  from?: 'main' | undefined;
}

const rootRoute = createRootRoute({
  component: () => (
    <TooltipProvider delayDuration={300}>
      <Outlet />
    </TooltipProvider>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: platformStore.getState().data.onboarded ? '/main' : '/welcome' });
  },
});

export const mainRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/main',
  validateSearch: (search: Record<string, unknown>): MainSearch => ({
    agent: str(search.agent),
    panel: search.panel === 'tree' ? 'tree' : search.panel === 'chat' ? 'chat' : undefined,
    task: str(search.task),
    draft: str(search.draft),
  }),
  component: MainWindow,
});

export const mainSettingsRoute = createRoute({
  getParentRoute: () => mainRoute,
  path: 'settings',
  validateSearch: (search: Record<string, unknown>): SettingsSearch => ({ tab: str(search.tab) }),
  component: GlobalSettingsDialog,
});

export const mainPersonaSettingsRoute = createRoute({
  getParentRoute: () => mainRoute,
  path: 'personas/$personaId/settings',
  validateSearch: (search: Record<string, unknown>): SettingsSearch => ({ tab: str(search.tab) }),
  component: PersonaSettingsDialog,
});

export const personaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/persona/$personaId',
  validateSearch: (search: Record<string, unknown>): PersonaSearch => ({
    thread: str(search.thread),
  }),
  component: PersonaWindow,
});

export const personaSettingsRoute = createRoute({
  getParentRoute: () => personaRoute,
  path: 'settings',
  validateSearch: (search: Record<string, unknown>): SettingsSearch => ({ tab: str(search.tab) }),
  component: PersonaSettingsDialog,
});

export const welcomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/welcome',
  validateSearch: (search: Record<string, unknown>): WelcomeSearch => {
    const step = Number(search.step);
    return {
      step: step === 2 || step === 3 ? step : step === 1 ? 1 : undefined,
      from: search.from === 'main' ? 'main' : undefined,
    };
  },
  component: Onboarding,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  mainRoute.addChildren([mainSettingsRoute, mainPersonaSettingsRoute]),
  personaRoute.addChildren([personaSettingsRoute]),
  welcomeRoute,
]);

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: false,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
