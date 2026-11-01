import { describe, expect, it } from "bun:test";
import { EMAIL_SENDER, resetPasswordEmail, sendMail, verificationEmail } from "../../src/lib/email";
import { createFakeEmail } from "../helpers/test-auth";

const url = "https://remain.scar0x00.click/api/v1/auth/verify-email?token=abc&callbackURL=%2Fverify-email";

describe("emails", () => {
  it("sends the verification link in both the HTML and the text part, from the one sender", async () => {
    const binding = createFakeEmail();
    await sendMail({ EMAIL: binding as unknown as SendEmail }, verificationEmail({ email: "ada@example.com", name: "Ada" }, url));

    const [mail] = binding.sent;
    expect(mail.from).toEqual(EMAIL_SENDER);
    expect(mail.to).toBe("ada@example.com");
    expect(mail.text).toContain(url);
    expect(mail.html).toContain(`href="${url.replaceAll("&", "&amp;")}"`);
  });

  it("escapes the user's name in HTML", () => {
    const mail = resetPasswordEmail({ email: "x@example.com", name: '<img src=x onerror="alert(1)">' }, url);
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;img");
  });

  it("logs instead of sending when DEV_LOG_EMAILS is on", async () => {
    const binding = createFakeEmail();
    await sendMail({ EMAIL: binding as unknown as SendEmail, DEV_LOG_EMAILS: "true" }, verificationEmail({ email: "a@b.c", name: "" }, url));
    expect(binding.sent).toEqual([]);
  });
});
