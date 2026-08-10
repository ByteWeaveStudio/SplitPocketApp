import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { Providers } from '@/app/providers'
import { migrateStoredTheme } from '@/lib/theme'

import './index.css'

// Before render, so next-themes never reads a value it can no longer resolve.
migrateStoredTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers />
  </StrictMode>,
)
