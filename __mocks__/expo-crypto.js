module.exports = {
  CryptoDigestAlgorithm: {
    SHA256: 'SHA-256',
    SHA384: 'SHA-384',
    SHA512: 'SHA-512',
    MD5: 'MD5',
    SHA1: 'SHA-1',
  },
  digestStringAsync: jest.fn(async (_algo, data) => {
    // Return a dummy 64-char sha256 hex string for testing
    return 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  }),
};
