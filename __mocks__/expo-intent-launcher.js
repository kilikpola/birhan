module.exports = {
  ACTION_VIEW: 'android.intent.action.VIEW',
  startActivityAsync: jest.fn(async () => ({ resultCode: 0 })),
};
