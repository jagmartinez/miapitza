import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './ui/tokens.css'
import './ui/base.css'
import './index.css'
import { retireLegacyAppCache } from './utils/legacy-cache.ts'
import { installGlobalErrorHandlers } from './services/globalErrorHandlers.ts'

installGlobalErrorHandlers()
void retireLegacyAppCache()

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)
