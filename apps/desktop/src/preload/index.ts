import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('arlo', Object.freeze({}));
