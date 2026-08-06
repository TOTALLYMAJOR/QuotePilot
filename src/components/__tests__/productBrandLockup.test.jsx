import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import ProductBrandLockup from "../ProductBrandLockup";
import {
  PRODUCT_COMPANY,
  PRODUCT_FULL_NAME,
  PRODUCT_NAME
} from "../../lib/productIdentity";

describe("QuotePilot product identity", () => {
  test("uses the approved product and company casing", () => {
    expect(PRODUCT_NAME).toBe("QuotePilot");
    expect(PRODUCT_COMPANY).toBe("MBMApps");
    expect(PRODUCT_FULL_NAME).toBe("QuotePilot by MBMApps");
  });

  test("renders an accessible product lockup independent of tenant branding", () => {
    const html = renderToStaticMarkup(<ProductBrandLockup />);

    expect(html).toContain('aria-label="QuotePilot by MBMApps"');
    expect(html).toContain("<strong>QuotePilot</strong>");
    expect(html).toContain("<small>by MBMApps</small>");
    expect(html).toContain('/brand/quotepilot-mark.svg');
  });
});
