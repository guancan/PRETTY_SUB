type LogLevel = 'info' | 'warn' | 'error' | 'debug';

class Logger {
    private static isDev = process.env.NODE_ENV !== 'production';

    private static formatMessage(level: LogLevel, message: string, data?: any) {
        const timestamp = new Date().toISOString();
        return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    }

    static info(message: string, data?: any) {
        console.log(this.formatMessage('info', message), data || '');
    }

    static warn(message: string, data?: any) {
        console.warn(this.formatMessage('warn', message), data || '');
    }

    static error(message: string, error?: any) {
        console.error(this.formatMessage('error', message), error || '');
    }

    static debug(message: string, data?: any) {
        if (this.isDev) {
            console.debug(this.formatMessage('debug', message), data || '');
        }
    }
}

export default Logger;
