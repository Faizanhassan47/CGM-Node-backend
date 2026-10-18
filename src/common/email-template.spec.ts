import {
  buildPasswordResetEmailHtml,
  buildWelcomeEmailHtml,
} from "./email-template";

describe("Circle email templates", () => {
  it("renders the Circle password reset template and escapes recipient data", () => {
    const html = buildPasswordResetEmailHtml({
      otp: "123456",
      recipientEmail: "patient+<unsafe>@example.com",
    });

    expect(html).toContain("Circle");
    expect(html).toContain("#FF5A43");
    expect(html).toContain("123456");
    expect(html).toContain("patient+&lt;unsafe&gt;@example.com");
    expect(html).not.toContain("Aima");
  });

  it("renders the welcome template and escapes profile values", () => {
    const html = buildWelcomeEmailHtml({
      fullName: '<script>alert("x")</script>',
      recipientEmail: "patient@example.com",
      familyCode: "CIRCLE-123",
    });

    expect(html).toContain("Welcome to Circle");
    expect(html).toContain("CIRCLE-123");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("Aima");
  });
});
