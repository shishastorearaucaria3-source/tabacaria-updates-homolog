import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import UpdateModal from './features/atualizacao/UpdateModal'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <UpdateModal />
  </React.StrictMode>
)