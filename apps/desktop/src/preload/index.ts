import { contextBridge, ipcRenderer } from 'electron'

// One narrow entry point; main only registers (and validates) known channels.
const api = {
  invoke: (channel: string, payload?: unknown): Promise<unknown> => {
    if (!/^[a-z]+:[A-Za-z]+$/.test(channel)) return Promise.reject(new Error('bad channel'))
    return ipcRenderer.invoke(channel, payload)
  }
}
contextBridge.exposeInMainWorld('skilldock', api)
