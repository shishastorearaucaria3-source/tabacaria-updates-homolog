import { contextBridge, ipcRenderer } from 'electron'

const api = {
  estado: () => ipcRenderer.invoke('setup:estado'),
  instalar: (tipo: string, enderecoServidor?: string) => ipcRenderer.invoke('setup:instalar', tipo, enderecoServidor),
  atualizar: () => ipcRenderer.invoke('setup:atualizar'),
  reinstalar: () => ipcRenderer.invoke('setup:reinstalar'),
  desinstalar: () => ipcRenderer.invoke('setup:desinstalar'),
  relancar: (exe: string) => ipcRenderer.invoke('setup:relancar', exe),
  sair: () => ipcRenderer.invoke('setup:sair'),
  servidorRodando: () => ipcRenderer.invoke('setup:servidorRodando'),
  onProgresso: (cb: (info: { etapa: string; arquivos: number; total: number; atual: string }) => void) => {
    ipcRenderer.on('setup:progresso', (_e, info) => cb(info))
  }
}

contextBridge.exposeInMainWorld('setup', api)

export type SetupApi = typeof api