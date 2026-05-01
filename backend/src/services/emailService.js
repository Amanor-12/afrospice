const nodemailer = require("nodemailer");

const AppError = require("../errors/AppError");
const { getMailConfig } = require("../config/mailConfig");

let cachedTransport = null;
let cachedSignature = "";

function buildTransportSignature(config) {
  return [
    config.host,
    config.port,
    config.secure,
    config.user,
    config.fromEmail,
    config.fromName,
    config.replyTo,
  ].join("|");
}

function createTransport(config) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    pool: config.pool,
    auth: {
      user: config.user,
      pass: config.pass,
    },
    connectionTimeout: config.connectionTimeout,
    greetingTimeout: config.greetingTimeout,
    socketTimeout: config.socketTimeout,
  });
}

function buildFromHeader(config) {
  return config.fromName
    ? `"${String(config.fromName || "").replace(/"/g, '\\"')}" <${config.fromEmail}>`
    : config.fromEmail;
}

function getTransport() {
  const config = getMailConfig();
  if (!config.configured || config.provider !== "smtp") {
    return {
      transport: null,
      config,
    };
  }

  const signature = buildTransportSignature(config);
  if (!cachedTransport || cachedSignature !== signature) {
    cachedTransport = createTransport(config);
    cachedSignature = signature;
  }

  return {
    transport: cachedTransport,
    config,
  };
}

function getMailTransportStatus() {
  const config = getMailConfig();

  return {
    provider: config.provider,
    configured: config.configured,
    mode: config.provider,
    host: config.host,
    port: config.port,
    secure: config.secure,
    fromEmail: config.fromEmail,
    fromName: config.fromName,
    replyTo: config.replyTo,
    missing: config.missing,
  };
}

function buildDeliveryErrorMessage(error, config) {
  const message = String(error?.message || "Email delivery failed.").trim();
  const responseText = String(error?.response || "").trim();
  const combined = `${message} ${responseText}`.trim();
  const isGmail = /gmail/i.test(String(config?.host || "")) || /google/i.test(responseText);
  const isResend = String(config?.provider || "").trim() === "resend";

  if (isResend) {
    const providerStatus = Number(error?.providerStatus || error?.responseStatus || 0);

    if (providerStatus === 401 || providerStatus === 403) {
      return "Resend rejected the API key. Replace RESEND_API_KEY with a valid active key.";
    }

    if (providerStatus === 422) {
      return message || "Resend rejected the email payload. Check the sender address and recipient.";
    }
  }

  if (isGmail && (String(error?.code || "").trim() === "EAUTH" || /app password|username and password not accepted/i.test(combined))) {
    return "Gmail rejected SMTP authentication. Set SMTP_PASS to a Google App Password for afrospicess@gmail.com.";
  }

  if (String(error?.code || "").trim() === "ECONNECTION") {
    return "SMTP connection failed. Check the mail host, firewall, and outbound network access.";
  }

  return message || "Email delivery failed.";
}

function normalizeAttachments(attachments = []) {
  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments
    .map((attachment) => {
      const filename = String(attachment?.filename || "").trim();
      if (!filename) return null;

      const content =
        Buffer.isBuffer(attachment?.content)
          ? attachment.content
          : attachment?.content instanceof Uint8Array
          ? Buffer.from(attachment.content)
          : typeof attachment?.content === "string"
          ? Buffer.from(attachment.content, attachment.encoding || "utf8")
          : null;

      if (!content) return null;

      return {
        filename,
        content,
        contentType: String(attachment?.contentType || attachment?.content_type || "application/octet-stream").trim(),
      };
    })
    .filter(Boolean);
}

async function sendWithResend(config, { recipient, subject, html, text, attachments = [] }) {
  const payload = {
    from: buildFromHeader(config),
    to: [recipient],
    subject,
    html: String(html || ""),
    text: String(text || ""),
  };

  const normalizedAttachments = normalizeAttachments(attachments);
  if (normalizedAttachments.length) {
    payload.attachments = normalizedAttachments.map((attachment) => ({
      filename: attachment.filename,
      content: attachment.content.toString("base64"),
      content_type: attachment.contentType,
    }));
  }

  if (config.replyTo) {
    payload.reply_to = config.replyTo;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const providerError = new Error(
      String(data?.message || data?.error || `Resend request failed with status ${response.status}.`).trim()
    );
    providerError.providerStatus = response.status;
    providerError.responseStatus = response.status;
    providerError.responseData = data;
    throw providerError;
  }

  return {
    provider: config.provider,
    messageId: String(data?.id || "").trim(),
    accepted: [recipient],
    rejected: [],
  };
}

async function sendEmail({ to, subject, html, text, attachments = [] }) {
  const recipient = String(to || "").trim().toLowerCase();
  const normalizedSubject = String(subject || "").trim();

  if (!recipient) {
    throw new AppError(400, "Recipient email is required.", {
      code: "EMAIL_RECIPIENT_REQUIRED",
    });
  }

  if (!normalizedSubject) {
    throw new AppError(400, "Email subject is required.", {
      code: "EMAIL_SUBJECT_REQUIRED",
    });
  }

  const { transport, config } = getTransport();
  if (!config.configured) {
    throw new AppError(503, "Mail transport is not configured.", {
      code: "EMAIL_TRANSPORT_NOT_CONFIGURED",
      details: {
        missing: config.missing,
        provider: config.provider,
      },
    });
  }

  try {
    if (config.provider === "resend") {
      return await sendWithResend(config, {
        recipient,
        subject: normalizedSubject,
        html,
        text,
        attachments,
      });
    }

    if (!transport) {
      throw new AppError(503, "Mail transport is not configured.", {
        code: "EMAIL_TRANSPORT_NOT_CONFIGURED",
        details: {
          missing: config.missing,
          provider: config.provider,
        },
      });
    }

    const info = await transport.sendMail({
      from: buildFromHeader(config),
      to: recipient,
      replyTo: config.replyTo || undefined,
      subject: normalizedSubject,
      html: String(html || ""),
      text: String(text || ""),
      attachments: normalizeAttachments(attachments).map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
        contentType: attachment.contentType,
      })),
    });

    return {
      provider: config.provider,
      messageId: String(info?.messageId || "").trim(),
      accepted: Array.isArray(info?.accepted) ? info.accepted : [],
      rejected: Array.isArray(info?.rejected) ? info.rejected : [],
    };
  } catch (error) {
    throw new AppError(502, buildDeliveryErrorMessage(error, config), {
      code: "EMAIL_DELIVERY_FAILED",
      details: {
        provider: config.provider,
        smtpCode: String(error?.code || "").trim(),
      },
    });
  }
}

module.exports = {
  getMailTransportStatus,
  sendEmail,
};
