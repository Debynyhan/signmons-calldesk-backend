import { Injectable } from "@nestjs/common";

export type IntakePageViewModel = {
  displayName: string;
  totalCents: number;
  emergency: boolean;
  fullName: string;
  address: string;
  issue: string;
  phone: string;
};

@Injectable()
export class PaymentsPageRendererService {
  renderIntakePage(token: string, data: IntakePageViewModel): string {
    const amount = `$${(data.totalCents / 100).toFixed(2)}`;
    const emergencyChecked = data.emergency ? "checked" : "";
    const baseCopy = data.emergency
      ? `${amount} total includes emergency surcharge.`
      : `${amount} service fee applies.`;
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${this.escapeHtml(data.displayName)} - Confirm & Pay</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; background: #f5f7fb; color: #111827; }
    main { max-width: 640px; margin: 24px auto; background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 8px 24px rgba(0,0,0,.08); }
    h1 { margin-top: 0; font-size: 1.4rem; }
    p { color: #374151; }
    label { display: block; margin: 12px 0 6px; font-weight: 600; }
    input, textarea { width: 100%; border: 1px solid #d1d5db; border-radius: 8px; padding: 10px; font-size: 15px; box-sizing: border-box; }
    textarea { min-height: 92px; resize: vertical; }
    .checkbox { display: flex; gap: 8px; align-items: center; margin-top: 14px; }
    .checkbox input { width: auto; }
    .hint { font-size: 13px; color: #6b7280; }
    button { margin-top: 16px; width: 100%; background: #0f766e; color: #fff; border: 0; border-radius: 8px; padding: 12px; font-size: 16px; cursor: pointer; }
    button:hover { background: #115e59; }
  </style>
</head>
<body>
  <main>
    <h1>Confirm details for ${this.escapeHtml(data.displayName)}</h1>
    <p>${this.escapeHtml(baseCopy)} Once paid, dispatch can proceed.</p>
    <form method="post" action="/api/payments/intake/${encodeURIComponent(token)}/checkout">
      <label for="fullName">Full Name</label>
      <input id="fullName" name="fullName" value="${this.escapeHtml(data.fullName)}" required />

      <label for="address">Service Address</label>
      <input id="address" name="address" value="${this.escapeHtml(data.address)}" required />

      <label for="issue">Main Issue</label>
      <textarea id="issue" name="issue" required>${this.escapeHtml(data.issue)}</textarea>

      <label for="phone">Best Mobile Number</label>
      <input id="phone" name="phone" value="${this.escapeHtml(data.phone)}" required />

      <label class="checkbox" for="emergency">
        <input id="emergency" name="emergency" type="checkbox" value="true" ${emergencyChecked} />
        This is an emergency
      </label>
      <p class="hint">Emergency requests may include an additional surcharge.</p>

      <button type="submit">Continue to secure payment</button>
    </form>
  </main>
</body>
</html>`;
  }

  renderSuccessPage(): string {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Payment Received</title></head><body style="font-family:Arial,sans-serif;padding:24px;"><h1>Payment received</h1><p>Thank you. We received your payment and your request is now queued for dispatch.</p></body></html>`;
  }

  renderCancelPage(): string {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Payment Not Completed</title></head><body style="font-family:Arial,sans-serif;padding:24px;"><h1>Payment not completed</h1><p>No charge was made. You can return to your text link to complete payment when ready.</p></body></html>`;
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
}
