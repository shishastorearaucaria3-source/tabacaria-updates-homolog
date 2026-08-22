const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('servidorJanela', {
  minimizar: () => ipcRenderer.send('janela:minimizar'),
  fechar: () => ipcRenderer.send('janela:fechar')
})