const LEVELS: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let minLevel = LEVELS.info;

function emit(level: string, tag: string, message: string): void {
  if ((LEVELS[level] ?? 20) < minLevel) return;
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level.toUpperCase()}] [${tag}] ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  setLevel(name: string): void {
    if (LEVELS[name]) minLevel = LEVELS[name];
  },
  debug: (tag: string, msg: string) => emit('debug', tag, msg),
  info: (tag: string, msg: string) => emit('info', tag, msg),
  warn: (tag: string, msg: string) => emit('warn', tag, msg),
  error: (tag: string, msg: string) => emit('error', tag, msg),
};
