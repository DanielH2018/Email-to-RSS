import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { handle as handleRSS, handleEmailView } from "./rss";
import { createMockEnv } from "../test/setup";
import { EmailData, FeedConfig, FeedMetadata } from "../types";

const ORIGIN = "https://email-rss.example.com";

describe("RSS Routes", () => {
  let testApp: Hono;
  let mockEnv: ReturnType<typeof createMockEnv>;
  let request: (path: string, init?: RequestInit) => Promise<Response>;

  const feedId = "paper.frost.31";
  // The inbound webhook keys emails by storage time (feed:<id>:<Date.now()>),
  // while receivedAt is the email's own Date header — they always differ.
  const receivedAt = 1782758098000;
  const storedAt = 1782758100123;
  const emailKey = `feed:${feedId}:${storedAt}`;

  // Legacy second format written by storage.ts (feed:<id>:email:<ts>)
  const legacyStoredAt = 1782154136999;
  const legacyEmailKey = `feed:${feedId}:email:${legacyStoredAt}`;

  const emailData: EmailData = {
    subject: "AI's budget",
    from: "news@example.org",
    content: "<p>Hello newsletter</p>",
    receivedAt,
    headers: {},
  };

  const legacyEmailData: EmailData = {
    ...emailData,
    subject: "Older issue",
    content: "<p>Legacy content</p>",
  };

  beforeEach(async () => {
    mockEnv = createMockEnv();
    testApp = new Hono();
    const rss = new Hono();
    rss.get("/:feedId", handleRSS);
    rss.get("/:feedId/emails/:timestamp", handleEmailView);
    testApp.route("/rss", rss);
    request = async (path, init = {}) => testApp.request(path, init, mockEnv);

    // Stored config deliberately carries a stale/wrong domain (the bug being fixed)
    const staleConfig: FeedConfig = {
      title: "The New Atlantis",
      description: "Converted email newsletter",
      language: "en",
      site_url: `https://wrong-domain.com/rss/${feedId}`,
      feed_url: `https://wrong-domain.com/rss/${feedId}`,
      created_at: receivedAt,
    };
    const metadata: FeedMetadata = {
      emails: [
        { key: emailKey, subject: emailData.subject, receivedAt },
        {
          key: legacyEmailKey,
          subject: legacyEmailData.subject,
          receivedAt: receivedAt - 1000,
        },
      ],
    };
    await mockEnv.EMAIL_STORAGE.put(
      `feed:${feedId}:config`,
      JSON.stringify(staleConfig),
    );
    await mockEnv.EMAIL_STORAGE.put(
      `feed:${feedId}:metadata`,
      JSON.stringify(metadata),
    );
    await mockEnv.EMAIL_STORAGE.put(emailKey, JSON.stringify(emailData));
    await mockEnv.EMAIL_STORAGE.put(
      legacyEmailKey,
      JSON.stringify(legacyEmailData),
    );
  });

  describe("GET /rss/:feedId", () => {
    it("returns 404 for an unknown feed", async () => {
      const res = await request(`${ORIGIN}/rss/no.such.feed`);
      expect(res.status).toBe(404);
    });

    it("builds channel and item URLs from the request origin, not DOMAIN or stored config", async () => {
      const res = await request(`${ORIGIN}/rss/${feedId}`);
      expect(res.status).toBe(200);
      const xml = await res.text();
      expect(xml).toContain(`<link>${ORIGIN}/rss/${feedId}</link>`);
      expect(xml).not.toContain("wrong-domain.com");
      expect(xml).not.toContain(`https://${mockEnv.DOMAIN}/`);
    });

    it("links items by their KV key timestamp so the links resolve", async () => {
      const res = await request(`${ORIGIN}/rss/${feedId}`);
      const xml = await res.text();
      expect(xml).toContain(
        `<link>${ORIGIN}/rss/${feedId}/emails/${storedAt}</link>`,
      );
      expect(xml).toContain(
        `<link>${ORIGIN}/rss/${feedId}/emails/${legacyStoredAt}</link>`,
      );
    });
  });

  describe("GET /rss/:feedId/emails/:timestamp", () => {
    it("renders the stored email as HTML", async () => {
      const res = await request(`${ORIGIN}/rss/${feedId}/emails/${storedAt}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");
      const body = await res.text();
      expect(body).toContain("<p>Hello newsletter</p>");
      expect(body).toContain(emailData.subject);
    });

    it("resolves emails stored under the legacy feed:<id>:email:<ts> key format", async () => {
      const res = await request(
        `${ORIGIN}/rss/${feedId}/emails/${legacyStoredAt}`,
      );
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("<p>Legacy content</p>");
    });

    it("returns 404 for a missing email", async () => {
      const res = await request(`${ORIGIN}/rss/${feedId}/emails/1234567890`);
      expect(res.status).toBe(404);
    });
  });
});
