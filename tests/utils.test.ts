import { describe, expect, test } from "bun:test";
import { extractCookiesFromResponse } from "../utils";

describe("extractCookiesFromResponse", () => {
  // Test case 1: Bun/Node >= 20 with getSetCookie()
  test("should extract cookies using getSetCookie when available", () => {
    const mockResponse = {
      headers: {
        getSetCookie: () => ["cookie1=value1; path=/", "cookie2=value2; secure"],
      },
    } as unknown as Response;
    const cookies = extractCookiesFromResponse(mockResponse);
    expect(cookies).toEqual(["cookie1=value1", "cookie2=value2"]);
  });

  // Test case 2: Standard fetch where 'set-cookie' is a single comma-separated string
  test("should handle a single comma-separated set-cookie header string", () => {
    const mockResponse = {
      headers: {
        get: (header: string) => {
          if (header.toLowerCase() === "set-cookie") {
            // Simulate a browser-like environment where it might be a single string
            return "cookie1=value1; path=/, cookie2=value2; secure";
          }
          return null;
        },
      },
    } as unknown as Response;
    const cookies = extractCookiesFromResponse(mockResponse);
    expect(cookies).toEqual(["cookie1=value1", "cookie2=value2"]);
  });

  // Test case 3: Complex cookie with comma in expires attribute
  test("should correctly parse cookies with commas in expires attribute", () => {
    const mockResponse = {
      headers: {
        get: (header: string) => {
          if (header.toLowerCase() === "set-cookie") {
            return "session=abc; expires=Wed, 21 Oct 2025 07:28:00 GMT, user=xyz; path=/";
          }
          return null;
        },
      },
    } as unknown as Response;
    const cookies = extractCookiesFromResponse(mockResponse);
    expect(cookies).toEqual(["session=abc", "user=xyz"]);
  });

  // Test case 4: Complex cookie value with a comma inside quotes
  test("should correctly parse cookie with comma inside quoted value", () => {
    const mockResponse = {
      headers: {
        get: (header: string) => {
          if (header.toLowerCase() === "set-cookie") {
            return 'data={"name":"John, Doe"}; path=/, token=12345';
          }
          return null;
        },
      },
    } as unknown as Response;
    const cookies = extractCookiesFromResponse(mockResponse);
    expect(cookies).toEqual(['data={"name":"John, Doe"}', "token=12345"]);
  });

  // Test case 5: No set-cookie header
  test("should return an empty array when no set-cookie header is present", () => {
    const mockResponse = {
      headers: {
        get: () => null,
      },
    } as unknown as Response;
    const cookies = extractCookiesFromResponse(mockResponse);
    expect(cookies).toEqual([]);
  });

  // Test case 6: Empty set-cookie header
  test("should return an empty array for an empty set-cookie header", () => {
    const mockResponse = {
      headers: {
        get: (header: string) => (header.toLowerCase() === "set-cookie" ? "" : null),
      },
    } as unknown as Response;
    const cookies = extractCookiesFromResponse(mockResponse);
    expect(cookies).toEqual([]);
  });

  // Test case 7: A single cookie without extra attributes
  test("should handle a single cookie string correctly", () => {
    const mockResponse = {
      headers: {
        get: (header: string) =>
          header.toLowerCase() === "set-cookie" ? "justone=cookie" : null,
      },
    } as unknown as Response;
    const cookies = extractCookiesFromResponse(mockResponse);
    expect(cookies).toEqual(["justone=cookie"]);
  });

  // Test case 8: Fallback when getSetCookie exists but returns empty
  test("should use fallback if getSetCookie exists but returns nothing", () => {
    const mockResponse = {
      headers: {
        getSetCookie: () => [],
        get: (header: string) => {
          if (header.toLowerCase() === "set-cookie") {
            return "fallback=used; path=/";
          }
          return null;
        },
      },
    } as unknown as Response;
    const cookies = extractCookiesFromResponse(mockResponse);
    expect(cookies).toEqual(["fallback=used"]);
  });
});
