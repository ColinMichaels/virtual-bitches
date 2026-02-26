const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const configured = (process.env.LOG_LEVEL ?? "info").toLowerCase();
const minLevel = LEVELS[configured] ?? LEVELS.info;

function write(level, message, ...args) {
  if ((LEVELS[level] ?? LEVELS.info) < minLevel) return;

  const ts = new Date().toISOString();
  const text = `[${ts}] [${level.toUpperCase()}] ${message}`;
  if (level === "error") {
    console.error(text, ...args);
    return;
  }
  if (level === "warn") {
    console.warn(text, ...args);
    return;
  }
  console.log(text, ...args);
}

export const logger = {
  debug(message, ...args) {
    write("debug", message, ...args);
  },
  info(message, ...args) {
    write("info", message, ...args);
  },
  warn(message, ...args) {
    write("warn", message, ...args);
  },
  error(message, ...args) {
    write("error", message, ...args);
  },
  create(prefix) {
    return {
      debug: (message, ...args) => write("debug", `[${prefix}] ${message}`, ...args),
      info: (message, ...args) => write("info", `[${prefix}] ${message}`, ...args),
      warn: (message, ...args) => write("warn", `[${prefix}] ${message}`, ...args),
      error: (message, ...args) => write("error", `[${prefix}] ${message}`, ...args),
      create: (subPrefix) => this.create(`${prefix}:${subPrefix}`),
    };
  },
};
