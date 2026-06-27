"use client";

const TOKEN_KEY = "cdp_us_admin_token";

export function readAdminToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveAdminToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token.trim());
}

export function clearAdminToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}
