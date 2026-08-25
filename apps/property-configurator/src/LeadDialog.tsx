import type { ConfigurationQuotePayload } from "@meshtour/core";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { track } from "./analytics";

interface LeadDialogProps {
  payload: ConfigurationQuotePayload;
  shareUrl: string;
  onClose: () => void;
}

export function LeadDialog({ payload, shareUrl, onClose }: LeadDialogProps) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    nameRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const lead = {
      tourId: "italian-flat-v4",
      catalogVersion: payload.catalogVersion,
      contact: {
        name: String(form.get("name") ?? ""),
        email: String(form.get("email") ?? ""),
        phone: String(form.get("phone") ?? ""),
      },
      configuration: payload,
      shareUrl,
    };
    window.__MESHTOUR_LAST_LEAD__ = lead;
    window.dispatchEvent(new CustomEvent("meshtour:lead", { detail: lead }));
    track("configuration_requested", {
      catalogVersion: payload.catalogVersion,
      presetId: payload.presetId,
      priceDeltaMinor: payload.priceDeltaMinor,
    });
    setSubmitted(true);
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="lead-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          className="icon-button dialog-close"
          type="button"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
        {submitted ? (
          <div className="lead-success" role="status">
            <span className="success-mark" aria-hidden="true">
              ✓
            </span>
            <p className="eyebrow">Specification received</p>
            <h2 id="lead-dialog-title">Your home is ready for review.</h2>
            <p>
              The complete SKU-level configuration has been emitted to the host application for CRM
              delivery.
            </p>
            <button className="primary-button" type="button" onClick={onClose}>
              Continue exploring
            </button>
          </div>
        ) : (
          <>
            <p className="eyebrow">Private specification</p>
            <h2 id="lead-dialog-title">Request this home</h2>
            <p className="dialog-intro">
              Send this exact finish schedule to the sales team. Pricing and availability are
              confirmed before reservation.
            </p>
            <form onSubmit={submit}>
              <label>
                Name
                <input ref={nameRef} name="name" autoComplete="name" required />
              </label>
              <label>
                Email
                <input name="email" type="email" autoComplete="email" required />
              </label>
              <label>
                Phone <span>Optional</span>
                <input name="phone" type="tel" autoComplete="tel" />
              </label>
              <div className="quote-summary">
                <span>{payload.lineItems.length} selected specifications</span>
                <strong>
                  +
                  {new Intl.NumberFormat("en", {
                    style: "currency",
                    currency: payload.currency,
                    maximumFractionDigits: 0,
                  }).format(payload.priceDeltaMinor / 100)}
                </strong>
              </div>
              <button className="primary-button" type="submit">
                Send specification
              </button>
            </form>
            <p className="privacy-note">
              Demo mode: the payload is emitted locally and no personal data leaves this browser.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
