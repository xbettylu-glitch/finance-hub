import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('financeBridge', {
  invoke: (method: string, args: unknown[]): Promise<unknown> => ipcRenderer.invoke('finance:api', method, args)
})
