import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import './components/Button.css'
import { retireLegacyAppCache } from './utils/legacy-cache.ts'

void retireLegacyAppCache()

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)
