import { Feed } from 'feed';
import { FeedConfig, EmailData } from '../types';

// An email plus the trailing timestamp of its KV key, which is the only
// identifier the email view route can resolve (receivedAt is the email's
// Date header and never matches the key)
export interface RssItem {
  data: EmailData;
  linkId: string;
}

/**
 * Generate an RSS feed from a list of emails
 */
export function generateRssFeed(
  feedConfig: FeedConfig,
  items: RssItem[],
  baseUrl: string,
  feedId: string
): string {
  // Create a new feed
  const feed = new Feed({
    title: feedConfig.title,
    description: feedConfig.description || '',
    id: feedConfig.feed_url,
    link: feedConfig.site_url,
    language: feedConfig.language,
    updated: new Date(),
    generator: 'Email-to-RSS',
    copyright: `Copyright © ${new Date().getFullYear()} ${feedConfig.title}`,
    feedLinks: {
      rss: feedConfig.feed_url
    },
    author: feedConfig.author ? {
      name: feedConfig.author,
      email: `noreply@${new URL(feedConfig.site_url).hostname}`
    } : undefined
  });

  // Add each email as a feed item
  for (const { data: email, linkId } of items) {
    const date = new Date(email.receivedAt);
    const uniqueId = `${email.receivedAt}-${Buffer.from(email.subject).toString('base64').substring(0, 10)}`;

    feed.addItem({
      title: email.subject,
      id: uniqueId,
      link: `${baseUrl}/rss/${feedId}/emails/${linkId}`,
      description: email.content,
      content: email.content,
      author: [
        {
          name: email.from,
        },
      ],
      date: date,
    });
  }

  // Return the RSS feed as XML
  return feed.rss2();
} 