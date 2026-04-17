/**
 * Privacy page component for the Signmons CallDesk UI.
 *
 * This page displays the Signmons LLC privacy policy. It follows the
 * Next.js app router conventions: export a default React component and
 * optionally metadata. The policy content comes from the user-supplied
 * privacy statement and is structured with headings and lists for
 * readability.
 */

import type { Metadata } from "next";

/**
 * Metadata for the privacy page.
 *
 * Setting a unique page title helps search engines and users
 * identify the page content. You can add more fields such as
 * description if desired.
 */
export const metadata: Metadata = {
  title: "Privacy Policy | Signmons CallDesk",
};

/**
 * Renders the privacy policy.
 *
 * The policy text is taken directly from the user-provided statement.
 * Lists are used for the information we collect and how we use it.
 */
export default function PrivacyPage() {
  return (
    <main style={{ padding: "2rem", maxWidth: "48rem", margin: "0 auto" }}>
      <h1>Privacy Policy</h1>
      <p>
        Signmons LLC ("Signmons", "we", "our", "us") provides customer support
        and service-intake messaging for home-service requests.
      </p>
      <h2>Information We Collect</h2>
      <ul>
        <li>Name</li>
        <li>Mobile phone number</li>
        <li>Service address</li>
        <li>Service request details</li>
        <li>Message history and timestamps</li>
        <li>Payment status metadata (processed by Stripe)</li>
      </ul>
      <h2>How We Use Information</h2>
      <ul>
        <li>
          Send service-related SMS (request confirmations, intake links,
          scheduling updates, technician dispatch updates, payment reminders,
          and support responses)
        </li>
        <li>Operate and improve our service workflows</li>
        <li>Maintain security, fraud prevention, and audit logs</li>
      </ul>
      <h2>Sharing of Information</h2>
      <p>We do not sell personal information.</p>
    </main>
  );
}
