# 0004 — Versionado, CHANGELOG y tags por fase

- Estado: aceptada (2026-11-10)

## Decisión
- Cada fase del CLAUDE.md §11 termina con: app estable y probada → entrada en `CHANGELOG.md` → commit → **tag anotado** → push de `main` y del tag a `origin`.
- Formato del changelog: [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versionado semántico pre-1.0.
- Mapeo fase → versión: `v0.<fase+1>.0` (Fase 0 → `v0.1.0`, Fase 1 → `v0.2.0`, … Fase 8 → `v0.9.0`). `v1.0.0` es el despliegue a producción.
- Entre fases, los cambios se acumulan en la sección `[Sin publicar]`.
- Commits: [Conventional Commits](https://www.conventionalcommits.org/es/) en español (`feat(rooms): …`, `fix(rls): …`, `chore:`, `docs:`, `ci:`, `test:`), pequeños y atómicos.
- `package.json` → `version` coincide con el tag.
