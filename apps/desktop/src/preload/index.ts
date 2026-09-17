import { contextBridge, ipcRenderer } from 'electron';
import type { ArloBridge } from './api.js';

// Each method forwards to one whitelisted `rendererInvokeContract` channel; main validates params.
const api: ArloBridge = {
  platform: process.platform,
  windows: Object.freeze({
    showPersona: (params) => ipcRenderer.invoke('windows/showPersona', params),
    showMain: (params) => ipcRenderer.invoke('windows/showMain', params),
  }),
};

contextBridge.exposeInMainWorld('arlo', Object.freeze(api));
