/**
 * Sichere Verschlüsselung für DB-Tokens
 * Verwendet AES-256-GCM mit JWT_SECRET als Schlüssel
 * 
 * Kompatibel mit dem CuraFlow-Projekt
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Leitet einen 256-bit Schlüssel vom JWT_SECRET mit SHA-256 ab
 * @returns {Buffer} 32-byte Schlüssel
 */
const getEncryptionKey = (): Buffer => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET Umgebungsvariable ist für Verschlüsselung erforderlich');
  }
  // SHA-256 verwenden um einen 32-byte Schlüssel aus dem Secret abzuleiten
  return crypto.createHash('sha256').update(secret).digest();
};

/**
 * Daten mit AES-256-GCM verschlüsseln
 * @param {string} plaintext - Die zu verschlüsselnden Daten
 * @returns {string} Base64-kodierte verschlüsselte Daten (iv + authTag + ciphertext)
 */
export const encryptToken = (plaintext: string): string => {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH
  });
  
  let encrypted = cipher.update(plaintext, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  
  const authTag = cipher.getAuthTag();
  
  // Kombiniere IV + AuthTag + Ciphertext
  const combined = Buffer.concat([iv, authTag, encrypted]);
  
  return combined.toString('base64');
};

/**
 * Daten mit AES-256-GCM entschlüsseln
 * @param {string} encryptedToken - Base64-kodierte verschlüsselte Daten
 * @returns {string} Entschlüsselter Klartext
 */
export const decryptToken = (encryptedToken: string): string => {
  const key = getEncryptionKey();
  const combined = Buffer.from(encryptedToken, 'base64');
  
  // Extrahiere IV, AuthTag und Ciphertext
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH
  });
  
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(ciphertext, undefined, 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
};

/**
 * Prüft ob ein Token im alten Base64-Format (unverschlüsselt) vorliegt
 * Alte Tokens sind nur Base64-kodiertes JSON, das mit { beginnt wenn dekodiert
 * @param {string} token - Das zu prüfende Token
 * @returns {boolean} True wenn es ein altes unverschlüsseltes Token ist
 */
export const isLegacyToken = (token: string): boolean => {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    // Prüfe ob es wie DB-Konfiguration aussieht (hat host, user, database)
    return parsed && parsed.host && parsed.user && parsed.database;
  } catch {
    return false;
  }
};

/**
 * Parse ein DB-Token - unterstützt sowohl Legacy (base64) als auch verschlüsselte Formate
 * @param {string} token - Das zu parsende Token
 * @returns {object|null} Geparsete DB-Konfiguration oder null wenn ungültig
 */
export const parseDbToken = (token: string): {
  host: string;
  user: string;
  password: string;
  database: string;
  port?: number;
  ssl?: boolean;
} | null => {
  try {
    // Prüfe zuerst ob es ein Legacy unverschlüsseltes Token ist
    if (isLegacyToken(token)) {
      console.warn('[Crypto] ⚠️ Legacy unverschlüsseltes DB-Token erkannt. Bitte Token für Sicherheit neu generieren.');
      const decoded = Buffer.from(token, 'base64').toString('utf-8');
      return JSON.parse(decoded);
    }
    
    // Versuche als neues verschlüsseltes Format zu entschlüsseln
    const decrypted = decryptToken(token);
    return JSON.parse(decrypted);
  } catch (error) {
    console.error('[Crypto] Token-Parsing fehlgeschlagen:', (error as Error).message);
    return null;
  }
};
