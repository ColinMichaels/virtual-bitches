/**
 * Centralized logging utility with environment-aware logging
 *
 * Usage:
 * ```ts
 * import { logger } from './utils/logger';
 *
 * logger.debug('Debug info', { data: value });
 * logger.info('Info message');
 * logger.warn('Warning!');
 * logger.error('Error occurred', error);
 * ```
 */

import { environment } from "@env";

/** Log levels in order of severity */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/** Current minimum log level based on environment */
const MIN_LOG_LEVEL = environment.debug ? LogLevel.DEBUG : LogLevel.INFO;

class Logger {
  /**
   * Log debug information (only in development)
   *
   * @param message - Log message
   * @param args - Additional arguments to log
   */
  debug(message: string, ...args: any[]): void {
    if (MIN_LOG_LEVEL <= LogLevel.DEBUG) {
      console.log(`🔍 [DEBUG] ${message}`, ...args);
    }
  }

  /**
   * Log informational message
   *
   * @param message - Log message
   * @param args - Additional arguments to log
   */
  info(message: string, ...args: any[]): void {
    if (MIN_LOG_LEVEL <= LogLevel.INFO) {
      console.log(`ℹ️ [INFO] ${message}`, ...args);
    }
  }

  /**
   * Log warning message
   *
   * @param message - Warning message
   * @param args - Additional arguments to log
   */
  warn(message: string, ...args: any[]): void {
    if (MIN_LOG_LEVEL <= LogLevel.WARN) {
      console.warn(`⚠️ [WARN] ${message}`, ...args);
    }
  }

  /**
   * Log error message
   *
   * @param message - Error message
   * @param args - Additional arguments to log (usually error object)
   */
  error(message: string, ...args: any[]): void {
    if (MIN_LOG_LEVEL <= LogLevel.ERROR) {
      console.error(`❌ [ERROR] ${message}`, ...args);
    }
  }

  /**
   * Create a prefixed logger for a specific module
   *
   * @param prefix - Module or component name
   * @returns Logger with prefixed messages
   *
   * @example
   * ```ts
   * const log = logger.create('ThemeManager');
   * log.info('Theme loaded'); // Outputs: "ℹ️ [INFO] [ThemeManager] Theme loaded"
   * ```
   */
  create(prefix: string): Logger {
    return {
      debug: (message: string, ...args: any[]) =>
        this.debug(`[${prefix}] ${message}`, ...args),
      info: (message: string, ...args: any[]) =>
        this.info(`[${prefix}] ${message}`, ...args),
      warn: (message: string, ...args: any[]) =>
        this.warn(`[${prefix}] ${message}`, ...args),
      error: (message: string, ...args: any[]) =>
        this.error(`[${prefix}] ${message}`, ...args),
      create: (subPrefix: string) =>
        this.create(`${prefix}:${subPrefix}`),
    };
  }
}

/** Singleton logger instance */
export const logger = new Logger();
