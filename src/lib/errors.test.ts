import { reportError } from './errors';

describe('reportError logger', () => {
  it('formats error objects with message, stack, cause, and code', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const testError = new Error('Database is locked');
    (testError as any).code = 'SQLITE_BUSY';
    (testError as any).cause = new Error('Underlying lock collision');

    const result = reportError(testError, 'TestContext', 'am', false);

    expect(result).toBe('መጫን አልተቻለም። ድጋሚ ይሞክሩ።');
    expect(spy).toHaveBeenCalled();
    const loggedString = spy.mock.calls[0][0];
    expect(loggedString).toContain('[BIRHAN_ERROR:TestContext] Error: Database is locked');
    expect(loggedString).toContain('Code: SQLITE_BUSY');
    expect(loggedString).toContain('Causes: [Error: Underlying lock collision]');

    spy.mockRestore();
  });

  it('handles string errors and object errors gracefully', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    reportError('Raw string error', 'StringContext', 'en', false);
    expect(spy.mock.calls[0][0]).toContain('[BIRHAN_ERROR:StringContext] Raw string error');

    spy.mockRestore();
  });

  it('handles expo-style empty message with nested cause', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const inner = new Error('cannot rollback - no transaction is active');
    const wrapped = new Error('');
    (wrapped as any).code = 'ERR_SQLITE';
    (wrapped as any).cause = inner;

    reportError(wrapped, 'SQLite', 'en', false);

    const loggedString = spy.mock.calls[0][0];
    expect(loggedString).toContain('Code: ERR_SQLITE');
    expect(loggedString).toContain('cannot rollback - no transaction is active');

    spy.mockRestore();
  });

  it('handles null, undefined, and custom non-Error object throws gracefully', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    reportError(null, 'NullContext', 'en', false);
    expect(spy.mock.calls[0][0]).toContain('[BIRHAN_ERROR:NullContext] null');

    reportError(undefined, 'UndefinedContext', 'en', false);
    expect(spy.mock.calls[1][0]).toContain('[BIRHAN_ERROR:UndefinedContext] undefined');

    reportError({ details: 'Custom object failure detail' }, 'ObjContext', 'en', false);
    expect(spy.mock.calls[2][0]).toContain('Custom object failure detail');

    spy.mockRestore();
  });
});
