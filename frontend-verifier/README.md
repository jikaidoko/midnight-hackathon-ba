# AMPARO / Verificación

Repositorio base para el portal del organismo verificador de AMPARO.

## Qué incluye

- React + TypeScript + Vite.
- 4 vistas derivadas del export de Stitch:
  - `/requests`
  - `/requests/authorized/RP-0048`
  - `/verify/new`
  - `/verify/result/VR-0182`
- Design System centralizado en `src/styles/globals.css`.
- Mocks determinísticos para grabar demo/video.
- Interfaces de servicios preparadas para reemplazar mocks por adapters Midnight.
- Export original de Stitch preservado en `docs/stitch-reference/`.

El contrato Compact ya existe en `../contracts/src/amparo.compact` (raíz del
repo, compartido con el resto de AMPARO), no en una carpeta local.

## Flujo de demo

### Verificación privada

`Solicitudes → Nueva verificación → Solicitar verificación → Resultado`

La demo prueba la condición “al menos 3 reportes sellados” y muestra explícitamente que identidad, fechas, contenido y ubicación permanecen privados.

### Acceso autorizado

`Solicitudes → Posible contaminación de un río → Ver información`

El relato ficticio expresa observación y sospecha de una posible contaminación de un río cordillerano vinculada a actividad de terceros, sin afirmar responsabilidad como hecho.

## Desarrollo

```bash
npm install
npm run dev
```

## Integración Midnight

Los componentes no deben importar el SDK de Midnight directamente. Implementar adapters que satisfagan las interfaces de `src/services/contracts.ts` y sustituir los mocks de `src/services/mock.ts`.

Arquitectura:

```text
React UI
   ↓
Service interfaces
   ↓
Mock adapters (demo)
   ↓ sustituir por
Midnight adapters
   ↓
Compact contract / ZK proof / ledger
```

La primera integración recomendada es `VerificationService.verifyCondition()`, porque representa de forma directa el valor ZK del portal: verificar un umbral sobre historial privado sin revelar el historial.
