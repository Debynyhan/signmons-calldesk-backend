/**
 * Terms and conditions page component for the Signmons CallDesk UI.
 *
 * This page displays the Signmons LLC terms and conditions, focusing on SMS consent,
 * information sharing, data retention, and user choices. It follows the Next.js
 * app router conventions: export a default React component and optionally
 * metadata. The content comes from the user‑supplied terms and is structured
 * with headings, paragraphs, and lists for readability.
 */

import type { Metadata } from "next";

/**
 * Metadata for the terms page.
 *
 * Setting a unique page title helps search engines and users identify the
 * page content. You can add more fields such as description if desired.
 */
export const metadata: Metadata = {
  title: "Terms & Conditions | Signmons CallDesk",
};

/**
 * Renders the terms and conditions content.
 *
 * The text is taken directly from the user‑provided statement. Sections are
 * grouped by topic with headings for clarity. Unordered lists are used for
 * bullet points. Inline styles are applied to keep layout consistent with
 * other simple pages.
 */
export default function TermsPage() {
  return (
    <main style={{ padding: "2rem", maxWidth: "48rem", margin: "0 auto" }}>
      <h1>Terms &amp; Conditions</h1>

      <section>
        <h2>SMS Consent and Messaging</h2>
        <p>
          When you opt in to SMS, you agree to receive recurring service‑related
          text messages.
        </p>
        <ul>
          <li>Message frequency varies by active request.</li>
          <li>Message and data rates may apply.</li>
          <li>Reply STOP to opt out.</li>
          <li>Reply HELP for help.</li>
        </ul>
      </section>

      <section>
        <h2>Sharing of Information</h2>
        <p>We do not sell personal information.</p>
        <p>
          We may share data with service providers strictly to operate the
          service (for example, telecom/SMS providers, hosting providers,
          payment processors).
        </p>
        <p>
          Mobile opt‑in data and SMS consent are not shared with third parties
          for their marketing or promotional purposes.
        </p>
      </section>

      <section>
        <h2>Data Retention</h2>
        <p>
          We keep data only as long as needed for service delivery, compliance,
          and legitimate business purposes.
        </p>
      </section>

      <section>
        <h2>Your Choices</h2>
        <p>You may:</p>
        <ul>
          <li>Opt out of SMS anytime by replying STOP.</li>
          <li>Request support by replying HELP.</li>
          <li>
            Contact us to request access, correction, or deletion (subject to
            legal requirements).
          </li>
        </ul>
        <p>
          We may update these terms from time to time. Updates are effective
          when posted at this URL.
        </p>
      </section>
    </main>
  );
}
