import { Context } from 'hono';
import { Env, FeedConfig, FeedMetadata, EmailData } from '../types';
import { generateRssFeed } from '../utils/feed-generator';

/**
 * Generates an RSS feed for a specific feed ID
 */
export async function handle(c: Context): Promise<Response> {
  try {
    // Type assertion for environment variables
    const env = c.env as unknown as Env;

    // Extract the feed ID from the route params
    const feedId = c.req.param('feedId');

    if (!feedId) {
      return new Response('Feed ID is required', { status: 400 });
    }

    // Get the KV namespace
    const emailStorage = env.EMAIL_STORAGE;

    // Check if the feed exists
    const feedMetadataKey = `feed:${feedId}:metadata`;
    const feedMetadata = await emailStorage.get(feedMetadataKey, { type: 'json' }) as FeedMetadata | null;

    if (!feedMetadata) {
      return new Response('Feed not found', { status: 404 });
    }

    // URLs are built from the request origin: the worker's public host
    // (email-rss.<domain>) differs from env.DOMAIN, which is only correct
    // for email addresses. Stored configs may carry a stale domain, so the
    // URL fields are always overridden at render time.
    const baseUrl = new URL(c.req.url).origin;

    // Get feed configuration (title, description, etc.)
    const feedConfigKey = `feed:${feedId}:config`;
    const storedConfig = await emailStorage.get(feedConfigKey, { type: 'json' }) as FeedConfig | null;
    const feedConfig: FeedConfig = {
      title: `Newsletter Feed ${feedId}`,
      description: 'Converted email newsletter',
      language: 'en',
      created_at: Date.now(),
      ...(storedConfig || {}),
      site_url: `${baseUrl}/rss/${feedId}`,
      feed_url: `${baseUrl}/rss/${feedId}`
    };

    // Get the emails for this feed (up to the last 20)
    const emails = feedMetadata.emails.slice(0, 20);
    const emailsData: EmailData[] = [];

    // Fetch all email content
    for (const email of emails) {
      const emailData = await emailStorage.get(email.key, { type: 'json' }) as EmailData | null;
      if (emailData) {
        emailsData.push(emailData);
      }
    }

    // Generate the RSS feed XML
    const rssXml = generateRssFeed(feedConfig, emailsData, baseUrl, feedId);

    // Return the RSS feed with appropriate content type
    return new Response(rssXml, {
      status: 200,
      headers: {
        'Content-Type': 'application/rss+xml',
        'Cache-Control': 'max-age=1800' // 30 minutes cache
      }
    });
  } catch (error) {
    console.error('Error generating RSS feed:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

/**
 * Renders a single stored email as a standalone HTML page.
 * This is the target of the per-item <link> in the generated RSS.
 */
export async function handleEmailView(c: Context): Promise<Response> {
  try {
    const env = c.env as unknown as Env;
    const feedId = c.req.param('feedId');
    const timestamp = c.req.param('timestamp');

    if (!feedId || !timestamp) {
      return new Response('Not Found', { status: 404 });
    }

    const emailKey = `feed:${feedId}:email:${timestamp}`;
    const emailData = await env.EMAIL_STORAGE.get(emailKey, { type: 'json' }) as EmailData | null;

    if (!emailData) {
      return new Response('Email not found', { status: 404 });
    }

    const escapedSubject = escapeHtml(emailData.subject);
    const htmlContent = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapedSubject}</title>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif;
        line-height: 1.5;
        padding: 16px;
        margin: 0 auto;
        max-width: 720px;
        color: #333;
        box-sizing: border-box;
      }
      img {
        max-width: 100%;
        height: auto;
      }
      a {
        color: #0070f3;
      }
      @media (prefers-color-scheme: dark) {
        body {
          background-color: #1c1c1e;
          color: #ffffff;
        }
        a {
          color: #0a84ff;
        }
      }
    </style>
  </head>
  <body>
    <h1>${escapedSubject}</h1>
    ${emailData.content}
  </body>
</html>`;

    return new Response(htmlContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'max-age=1800' // 30 minutes cache
      }
    });
  } catch (error) {
    console.error('Error rendering email view:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
