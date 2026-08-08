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
import ControlInboxPage from './pages/control/InboxPage'
import ControlCasePage from './pages/control/CasePage'
import ControlRespondPage from './pages/control/RespondPage'

/**
 * Two surfaces, one build.
 *
 * `/` is the reporter's phone. `/control` is the oversight portal, and it is
 * NOT linked from the reporter app on purpose: they are different people, and a
 * button labelled "I am the control body" inside a citizen's app would say the
 * opposite of what the system is for. It is reachable by URL, which is how the
 * official would reach it anyway.
 */
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

    <Route path="/control" element={<ControlInboxPage/>}/>
    <Route path="/control/:id" element={<ControlCasePage/>}/>
    <Route path="/control/:id/respond" element={<ControlRespondPage/>}/>

    <Route path="*" element={<Navigate to="/" replace/>}/>
  </Routes>
}
