import { describe, expect, it } from "vitest";
import { toCurrentUserView } from "../../src/lib/auth-user-view";

describe("toCurrentUserView", () => {
  it("keeps only the client-safe account fields", () => {
    const storedUser = {
      id: "user-1",
      name: "Test User",
      role: "CONSUMER",
      isAdmin: false,
      preferredArea: null,
      preferredLocationCode: null,
      theme: "system",
      homeSections: null,
      email: "private@example.test",
      phone: "+234000000000",
      passwordHash: "bcrypt-hash",
      mfaSecret: "encrypted-secret",
      failedLoginCount: 4,
      lockedUntil: new Date(),
      passwordChangedAt: new Date(),
    };

    const view = toCurrentUserView(storedUser);
    expect(view).toEqual({
      id: "user-1",
      name: "Test User",
      role: "CONSUMER",
      isAdmin: false,
      preferredArea: null,
      preferredLocationCode: null,
      theme: "system",
      homeSections: null,
    });
    expect(view).not.toHaveProperty("passwordHash");
    expect(view).not.toHaveProperty("mfaSecret");
    expect(view).not.toHaveProperty("email");
    expect(view).not.toHaveProperty("phone");
  });
});
