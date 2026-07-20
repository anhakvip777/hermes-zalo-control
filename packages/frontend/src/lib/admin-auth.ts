"use client";

export interface AdminCredentialStore {
  getAuthorization(): string | null;
  set(username: string, password: string): string;
  clear(expectedGeneration?: number): boolean;
  generation(): number;
  subscribe(listener: () => void): () => void;
}

const listeners = new Set<() => void>();
let authorization: string | null = null;
let currentGeneration = 0;

/** Encode Basic credentials as UTF-8 without persisting the password. */
export function encodeBasicAuthorization(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

function notify() {
  for (const listener of listeners) listener();
}

export const adminCredentials: AdminCredentialStore = {
  getAuthorization: () => authorization,
  set: (username, password) => {
    authorization = encodeBasicAuthorization(username, password);
    currentGeneration += 1;
    notify();
    return authorization;
  },
  clear: (expectedGeneration) => {
    if (expectedGeneration !== undefined && expectedGeneration !== currentGeneration) return false;
    if (authorization === null) return false;
    authorization = null;
    currentGeneration += 1;
    notify();
    return true;
  },
  generation: () => currentGeneration,
  subscribe: (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
