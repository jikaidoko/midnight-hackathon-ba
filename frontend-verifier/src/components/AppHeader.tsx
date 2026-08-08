import { NavLink } from 'react-router-dom'
export default function AppHeader(){
  return <header className="app-header">
    <div className="shell header-inner">
      <div className="brand">AMPARO <span>/ Verificación</span></div>
      <nav aria-label="Principal">
        <NavLink to="/requests">Solicitudes</NavLink>
        <NavLink to="/verify/new">Verificar</NavLink>
        <a href="#help">Ayuda</a>
      </nav>
      <div className="org-pill">Organismo verificador</div>
    </div>
  </header>
}
