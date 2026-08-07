import { Navigate, Route, Routes } from 'react-router-dom'
import InboxPage from '../pages/InboxPage'
import AuthorizedInfoPage from '../pages/AuthorizedInfoPage'
import NewVerificationPage from '../pages/NewVerificationPage'
import VerificationResultPage from '../pages/VerificationResultPage'
export default function App(){
  return <Routes>
    <Route path="/" element={<Navigate to="/requests" replace />} />
    <Route path="/requests" element={<InboxPage />} />
    <Route path="/requests/authorized/:id" element={<AuthorizedInfoPage />} />
    <Route path="/verify/new" element={<NewVerificationPage />} />
    <Route path="/verify/result/:id" element={<VerificationResultPage />} />
    <Route path="*" element={<Navigate to="/requests" replace />} />
  </Routes>
}
