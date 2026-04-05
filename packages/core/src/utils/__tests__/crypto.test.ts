import { describe, it, expect } from 'vitest';
import { CryptoUtils } from '../crypto';

describe('CryptoUtils', () => {
  describe('generateApiKey', () => {
    it('should generate a 64-character hexadecimal string', () => {
      const apiKey = CryptoUtils.generateApiKey();

      expect(apiKey).toHaveLength(64);
      expect(apiKey).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should generate unique keys', () => {
      const key1 = CryptoUtils.generateApiKey();
      const key2 = CryptoUtils.generateApiKey();
      const key3 = CryptoUtils.generateApiKey();

      expect(key1).not.toBe(key2);
      expect(key2).not.toBe(key3);
      expect(key1).not.toBe(key3);
    });

    it('should generate cryptographically random keys', () => {
      const keys = new Set();
      for (let i = 0; i < 100; i++) {
        keys.add(CryptoUtils.generateApiKey());
      }

      expect(keys.size).toBe(100);
    });
  });

  describe('hashApiKey', () => {
    it('should generate a 64-character hash', () => {
      const apiKey = 'test-api-key-12345';
      const hash = CryptoUtils.hashApiKey(apiKey);

      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should be deterministic', () => {
      const apiKey = 'consistent-key';
      const hash1 = CryptoUtils.hashApiKey(apiKey);
      const hash2 = CryptoUtils.hashApiKey(apiKey);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different inputs', () => {
      const hash1 = CryptoUtils.hashApiKey('key-1');
      const hash2 = CryptoUtils.hashApiKey('key-2');

      expect(hash1).not.toBe(hash2);
    });

    it('should be case-sensitive', () => {
      const hash1 = CryptoUtils.hashApiKey('ApiKey');
      const hash2 = CryptoUtils.hashApiKey('apikey');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyApiKey', () => {
    it('should verify correct API key', () => {
      const apiKey = 'my-secret-key';
      const hash = CryptoUtils.hashApiKey(apiKey);
      const isValid = CryptoUtils.verifyApiKey(apiKey, hash);

      expect(isValid).toBe(true);
    });

    it('should reject incorrect API key', () => {
      const correctKey = 'correct-key';
      const wrongKey = 'wrong-key';
      const hash = CryptoUtils.hashApiKey(correctKey);
      const isValid = CryptoUtils.verifyApiKey(wrongKey, hash);

      expect(isValid).toBe(false);
    });

    it('should be timing-safe', () => {
      const apiKey = 'timing-test-key';
      const hash = CryptoUtils.hashApiKey(apiKey);

      const startCorrect = Date.now();
      CryptoUtils.verifyApiKey(apiKey, hash);
      const correctTime = Date.now() - startCorrect;

      const startWrong = Date.now();
      CryptoUtils.verifyApiKey('wrong-key', hash);
      const wrongTime = Date.now() - startWrong;

      expect(Math.abs(correctTime - wrongTime)).toBeLessThan(5);
    });

    it('should handle malformed hash gracefully', () => {
      const apiKey = 'test-key';
      const malformedHash = 'not-a-valid-hash';

      expect(() => {
        CryptoUtils.verifyApiKey(apiKey, malformedHash);
      }).toThrow();
    });
  });

  describe('integration', () => {
    it('should work end-to-end', () => {
      const apiKey = CryptoUtils.generateApiKey();
      const hash = CryptoUtils.hashApiKey(apiKey);
      const isValid = CryptoUtils.verifyApiKey(apiKey, hash);

      expect(isValid).toBe(true);
    });

    it('should fail verification with different key', () => {
      const apiKey1 = CryptoUtils.generateApiKey();
      const apiKey2 = CryptoUtils.generateApiKey();
      const hash1 = CryptoUtils.hashApiKey(apiKey1);
      const isValid = CryptoUtils.verifyApiKey(apiKey2, hash1);

      expect(isValid).toBe(false);
    });
  });
});
