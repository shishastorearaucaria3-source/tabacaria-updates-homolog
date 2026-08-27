/**
 * Centralized data directory resolution.
 *
 * All runtime code that needs the application data directory (database, logs,
 * backups, cache, config files) MUST use this module instead of computing
 * paths independently via `process.env.APPDATA`, `app.getPath('userData')`,
 * or any other ad-hoc method.
 *
 * Data directory priority:
 *  1. `TABACARIA_DB` env var        -- dev/testing override (full path to .sqlite file;
 *                                      the parent directory is used as data dir).
 *  2. `SETUP_DADOS_DIR` env var     -- set by the setup launcher.
 *  3. `PORTABLE_EXECUTABLE_DIR`     -- set by the portable SFX (NSIS) to $EXEDIR.
 *                                      Data lives next to the portable .exe.
 *  4. `<install-dir>/sistema-loja-tabacaria/` -- when execPath is NOT inside %TEMP%
 *                                      (normal installed version).
 *  5. Fallback: `<execDir>/sistema-loja-tabacaria/`.
 */

import { dirname, join, resolve } from 'node:path'

/** Sub-directory name inside the base directory that holds all application data. */
const DATA_SUBDIR = 'sistema-loja-tabacaria'

function isTempPath(p: string): boolean {
  const tmp = (process.env.TEMP || process.env.TMP || '').toLowerCase()
  if (!tmp) return false
  return p.toLowerCase().replace(/\\/g, '/').startsWith(tmp.replace(/\\/g, '/'))
}

/**
 * Returns the application data directory.
 *
 * - Installed (setup): `<install-dir>/sistema-loja-tabacaria/`
 * - Portable (SFX): `<portable-exe-dir>/sistema-loja-tabacaria/` (next to .exe)
 * - Dev: same as installed, relative to process.execPath
 */
export function getDataDir(): string {
  // Setup-process override (autoupdater, installer post-install hooks).
  if (process.env.SETUP_DADOS_DIR) return process.env.SETUP_DADOS_DIR

  // Dev/testing override -- TABACARIA_DB points to the sqlite file itself;
  // the parent directory is the data dir.
  if (process.env.TABACARIA_DB) return dirname(process.env.TABACARIA_DB)

  // Portable (SFX): NSIS sets PORTABLE_EXECUTABLE_DIR to $EXEDIR (where the .exe lives).
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return join(process.env.PORTABLE_EXECUTABLE_DIR, DATA_SUBDIR)
  }

  const execDir = dirname(resolve(process.execPath))

  // Normal installed version: execPath is NOT inside %TEMP%.
  if (!isTempPath(resolve(process.execPath))) {
    return join(execDir, DATA_SUBDIR)
  }

  // Fallback (should rarely be reached): use execDir.
  return join(execDir, DATA_SUBDIR)
}

/**
 * Full path to the SQLite database file.
 *
 * When `TABACARIA_DB` is set it is returned as-is (backward compatibility).
 */
export function getDefaultDbPath(): string {
  return process.env.TABACARIA_DB || join(getDataDir(), 'tabacaria.sqlite')
}

/** Full path to the server start-up log file. */
export function getLogFilePath(): string {
  return join(getDataDir(), 'servidor-inicio.log')
}

/** Full path to the file that stores the TCP port number of the server. */
export function getPortFilePath(): string {
  return join(getDataDir(), 'servidor.porta')
}

/** Full path to the file that stores the server URL. */
export function getUrlFilePath(): string {
  return join(getDataDir(), 'servidor.url')
}

/** Full path to the auto-update channel URL config file. */
export function getUpdateUrlPath(): string {
  return join(getDataDir(), 'update.url')
}

/** Full path to the cached product images directory. */
export function getImageCacheDir(): string {
  return join(getDataDir(), 'imagens_cache')
}

/** Full path to the database backups directory. */
export function getBackupDir(): string {
  return join(getDataDir(), 'backups')
}

/** Full path to the product import staging directory. */
export function getImportDir(): string {
  return join(getDataDir(), 'importacao')
}

/** Full path to the update marker file (used across restarts). */
export function getUpdateMarkerPath(): string {
  return join(getDataDir(), 'atualizacao-pendente.json')
}
