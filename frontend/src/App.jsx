import { createContext, useCallback, useMemo, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell.jsx'
import { Toast } from './components/ui.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Jobs from './pages/Jobs.jsx'
import Candidates from './pages/Candidates.jsx'
import Upload from './pages/Upload.jsx'
import Shortlist from './pages/Shortlist.jsx'

export const AppContext = createContext({ notify: () => {}, jobs: [], setJobs: () => {}, statuses: {}, setStatuses: () => {} })

export default function App() {
  const [toast, setToast] = useState(null)
  const [jobs, setJobs] = useState(null)
  const [statuses, setStatuses] = useState({})
  const notify = useCallback((message, type = 'success') => setToast({ message, type }), [])
  const context = useMemo(() => ({ notify, jobs, setJobs, statuses, setStatuses }), [notify, jobs, statuses])
  return <AppContext.Provider value={context}><Routes><Route element={<AppShell />}><Route index element={<Dashboard />} /><Route path="jobs" element={<Jobs />} /><Route path="jobs/:id" element={<Jobs />} /><Route path="jobs/:id/edit" element={<Jobs />} /><Route path="candidates" element={<Candidates />} /><Route path="candidates/:id" element={<Candidates />} /><Route path="upload" element={<Upload />} /><Route path="shortlist" element={<Shortlist />} /><Route path="*" element={<Navigate to="/" replace />} /></Route></Routes><Toast toast={toast} onClose={() => setToast(null)} /></AppContext.Provider>
}
