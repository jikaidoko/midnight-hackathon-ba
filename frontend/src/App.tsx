import { Navigate, Route, Routes } from 'react-router-dom'
import IdentityPage from './pages/IdentityPage'
import RecordPage from './pages/RecordPage'
import ReviewPage from './pages/ReviewPage'
import SealingPage from './pages/SealingPage'
import SealedPage from './pages/SealedPage'
import ReportDetailPage from './pages/ReportDetailPage'
import SharePage from './pages/SharePage'
import AccessGrantedPage from './pages/AccessGrantedPage'
import ReportsPage from './pages/ReportsPage'
import CredentialPage from './pages/CredentialPage'

export default function App() {
  return <Routes>
    <Route path="/" element={<IdentityPage/>}/>
    <Route path="/record" element={<RecordPage/>}/>
    <Route path="/review" element={<ReviewPage/>}/>
    <Route path="/sealing" element={<SealingPage/>}/>
    <Route path="/sealed" element={<SealedPage/>}/>
    <Route path="/reports" element={<ReportsPage/>}/>
    <Route path="/credential" element={<CredentialPage/>}/>
    <Route path="/reports/:id" element={<ReportDetailPage/>}/>
    <Route path="/reports/:id/share" element={<SharePage/>}/>
    <Route path="/reports/:id/access" element={<AccessGrantedPage/>}/>
    <Route path="*" element={<Navigate to="/" replace/>}/>
  </Routes>
}
