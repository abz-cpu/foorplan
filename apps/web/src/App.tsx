import { Navigate, Route, Routes } from 'react-router-dom';
import AccountPage from './pages/AccountPage';
import DashboardPage from './pages/DashboardPage';
import EditorPage from './pages/EditorPage';
import { TemplatesPage } from './pages/TemplatesPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/templates" element={<TemplatesPage />} />
      <Route path="/editor/:propertyId" element={<EditorPage />} />
      <Route path="/account" element={<AccountPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
