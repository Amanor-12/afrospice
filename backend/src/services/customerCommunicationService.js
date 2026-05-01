const AppError = require("../errors/AppError");
const customerCommunicationRepository = require("../data/repositories/customerCommunicationRepository");
const customerRepository = require("../data/repositories/customerRepository");
const { getMailTransportStatus, sendEmail } = require("./emailService");

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isValidTwilioAccountSid(value) {
  return /^AC[a-fA-F0-9]{32}$/.test(String(value || "").trim());
}

function isValidTwilioAuthToken(value) {
  return /^[a-fA-F0-9]{32}$/.test(String(value || "").trim());
}

function isValidTwilioApiKeySid(value) {
  return /^SK[a-fA-F0-9]{32}$/.test(String(value || "").trim());
}

function isValidTwilioMessagingServiceSid(value) {
  return /^MG[a-fA-F0-9]{32}$/.test(String(value || "").trim());
}

function isValidE164Phone(value) {
  return /^\+[1-9]\d{6,14}$/.test(String(value || "").trim());
}

function truncateText(value, maxLength = 240) {
  const normalized = normalizeText(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function readSmsConfig() {
  const accountSid = normalizeText(process.env.TWILIO_ACCOUNT_SID);
  const authToken = normalizeText(process.env.TWILIO_AUTH_TOKEN);
  const apiKeySid = normalizeText(process.env.TWILIO_API_KEY_SID);
  const apiKeySecret = normalizeText(process.env.TWILIO_API_KEY_SECRET);
  const fromNumber = normalizeText(process.env.TWILIO_FROM_NUMBER);
  const messagingServiceSid = normalizeText(process.env.TWILIO_MESSAGING_SERVICE_SID);
  const missing = [];
  const hasApiKeyAuth = Boolean(apiKeySid && apiKeySecret);
  const hasLegacyAuth = Boolean(authToken);
  const hasValidAccountSid = isValidTwilioAccountSid(accountSid);
  const hasValidAuthToken = !hasLegacyAuth || isValidTwilioAuthToken(authToken);
  const hasValidApiKeySid = !apiKeySid || isValidTwilioApiKeySid(apiKeySid);
  const hasValidMessagingServiceSid =
    !messagingServiceSid || isValidTwilioMessagingServiceSid(messagingServiceSid);
  const hasValidFromNumber = !fromNumber || isValidE164Phone(fromNumber);
  const senderType = messagingServiceSid ? "messaging-service" : fromNumber ? "from-number" : "";
  const senderValue = messagingServiceSid || fromNumber;

  if (!accountSid) {
    missing.push("TWILIO_ACCOUNT_SID");
  } else if (!hasValidAccountSid) {
    missing.push("TWILIO_ACCOUNT_SID (must start with AC and contain 34 chars)");
  }

  if (!hasApiKeyAuth && !hasLegacyAuth) {
    missing.push("TWILIO_AUTH_TOKEN or TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET");
  } else {
    if (hasLegacyAuth && !hasValidAuthToken) {
      missing.push("TWILIO_AUTH_TOKEN (must be 32 hexadecimal chars)");
    }
    if (apiKeySid && !hasValidApiKeySid) {
      missing.push("TWILIO_API_KEY_SID (must start with SK and contain 34 chars)");
    }
  }

  if (!senderValue) {
    missing.push("TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID");
  } else {
    if (fromNumber && !hasValidFromNumber) {
      missing.push("TWILIO_FROM_NUMBER (must be E.164 format, e.g. +16626761714)");
    }
    if (messagingServiceSid && !hasValidMessagingServiceSid) {
      missing.push("TWILIO_MESSAGING_SERVICE_SID (must start with MG and contain 34 chars)");
    }
  }

  return {
    provider: "twilio",
    accountSid,
    authToken,
    apiKeySid,
    apiKeySecret,
    fromNumber,
    messagingServiceSid,
    authMode: hasApiKeyAuth ? "api-key" : hasLegacyAuth ? "auth-token" : "missing",
    senderType,
    senderValue,
    configured: missing.length === 0,
    missing,
  };
}

function getSmsTransportStatus() {
  const config = readSmsConfig();
  return {
    provider: config.provider,
    configured: config.configured,
    fromNumber: config.fromNumber,
    messagingServiceSid: config.messagingServiceSid,
    authMode: config.authMode,
    senderType: config.senderType,
    senderValue: config.senderValue,
    missing: config.missing,
  };
}

function summarizeTransportHealth(transport = {}, logs = [], channel = "") {
  const recentLogs = Array.isArray(logs)
    ? logs.filter((entry) => String(entry?.channel || "").trim().toLowerCase() === String(channel || "").trim().toLowerCase())
    : [];
  const recentSuccessCount = recentLogs.filter((entry) => entry?.status === "success").length;
  const recentFailureCount = recentLogs.filter((entry) => entry?.status === "failed").length;
  const lastAttempt = recentLogs[0] || null;
  const lastSuccess = recentLogs.find((entry) => entry?.status === "success") || null;
  const lastFailure = recentLogs.find((entry) => entry?.status === "failed") || null;
  const providerLabel = String(transport?.provider || channel || "transport").trim().toUpperCase();

  if (!transport?.configured) {
    return {
      ...transport,
      health: "unavailable",
      message: Array.isArray(transport?.missing) && transport.missing.length
        ? `Setup needed: ${transport.missing.join(", ")}`
        : `${providerLabel} is not configured.`,
      recentSuccessCount,
      recentFailureCount,
      lastAttemptAt: lastAttempt?.createdAt || null,
      lastSuccessAt: lastSuccess?.createdAt || null,
      lastFailureAt: lastFailure?.createdAt || null,
      lastError: lastFailure?.errorMessage || "",
    };
  }

  if (!recentLogs.length) {
    return {
      ...transport,
      health: "ready",
      message: `${providerLabel} is configured and ready for the first live delivery.`,
      recentSuccessCount,
      recentFailureCount,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: "",
    };
  }

  if (recentFailureCount > 0 && recentSuccessCount === 0) {
    return {
      ...transport,
      health: "degraded",
      message:
        lastFailure?.errorMessage ||
        `${providerLabel} is configured, but recent ${String(channel || "message")} deliveries are failing.`,
      recentSuccessCount,
      recentFailureCount,
      lastAttemptAt: lastAttempt?.createdAt || null,
      lastSuccessAt: null,
      lastFailureAt: lastFailure?.createdAt || null,
      lastError: lastFailure?.errorMessage || "",
    };
  }

  if (recentFailureCount > 0) {
    return {
      ...transport,
      health: "warning",
      message: `${providerLabel} is live, but ${recentFailureCount} recent ${String(channel || "message")} deliveries need review.`,
      recentSuccessCount,
      recentFailureCount,
      lastAttemptAt: lastAttempt?.createdAt || null,
      lastSuccessAt: lastSuccess?.createdAt || null,
      lastFailureAt: lastFailure?.createdAt || null,
      lastError: lastFailure?.errorMessage || "",
    };
  }

  return {
    ...transport,
    health: "healthy",
    message: `${providerLabel} is live and recent ${String(channel || "message")} deliveries are healthy.`,
    recentSuccessCount,
    recentFailureCount,
    lastAttemptAt: lastAttempt?.createdAt || null,
    lastSuccessAt: lastSuccess?.createdAt || null,
    lastFailureAt: null,
    lastError: "",
  };
}

function resolveRecipientName(customer = {}) {
  return normalizeText(customer.name || "Member");
}

function buildCheckoutIdentityLine(customer = {}) {
  const cardNumber = normalizeText(customer.loyaltyCardNumber || customer.loyaltyNumber);
  if (cardNumber) {
    return `Use card ${cardNumber}, your phone, or your email at checkout to keep rewards attached.`;
  }

  return "Use your phone, email, or name at checkout to keep rewards attached.";
}

function buildCustomerWelcomePayload(customer = {}, settings = {}) {
  const storeName = normalizeText(settings.storeName || "AfroSpice");
  const ownerName = normalizeText(settings.managerName || "Store Owner");
  const recipientName = resolveRecipientName(customer);
  const checkoutIdentityLine = buildCheckoutIdentityLine(customer);
  const loyaltyLine = customer.loyaltyOptIn
    ? `Your loyalty card number is ${customer.loyaltyCardNumber || customer.loyaltyNumber || "ready in-store"}.`
    : "Your membership record is live and ready for named checkout in store.";
  const marketingLine = customer.marketingOptIn
    ? "You are also subscribed to store updates, product drops, and announcement messages."
    : "Marketing messages stay off until you opt in.";
  const subject = `${storeName} membership activated`;
  const headline = customer.loyaltyOptIn
    ? `Welcome to ${storeName} Rewards`
    : `Welcome to ${storeName}`;
  const html = `
    <div style="font-family:Arial,sans-serif;background:#f5f7fb;padding:24px;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:24px;padding:28px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;">
          <div style="width:42px;height:42px;border-radius:14px;background:linear-gradient(135deg,#3b82f6,#60a5fa);display:inline-block;"></div>
          <div>
            <strong style="display:block;color:#172033;">${storeName}</strong>
            <span style="color:#617089;font-size:13px;">Membership activation</span>
          </div>
        </div>
        <h1 style="margin:0 0 12px;font-size:28px;color:#172033;">${headline}</h1>
        <p style="margin:0 0 10px;color:#475569;">Hello ${recipientName},</p>
        <p style="margin:0 0 10px;color:#475569;">Your membership record is now active with our store.</p>
        <p style="margin:0 0 10px;color:#172033;font-weight:600;">${loyaltyLine}</p>
        <p style="margin:0 0 10px;color:#475569;">Preferred contact method: ${normalizeText(
          customer.preferredContactMethod || "None"
        ) || "None"}.</p>
        <p style="margin:0 0 16px;color:#475569;">${marketingLine}</p>
        <div style="padding:16px 18px;border-radius:18px;background:#f8fbff;border:1px solid #dbeafe;">
          <strong style="display:block;color:#172033;margin-bottom:6px;">What happens next</strong>
          <p style="margin:0;color:#617089;">${checkoutIdentityLine}</p>
        </div>
        <p style="margin:20px 0 0;color:#94a3b8;font-size:13px;">Sent by ${ownerName} at ${storeName}.</p>
      </div>
    </div>
  `;
  const text = [
    headline,
    "",
    `Hello ${recipientName},`,
    `Your membership record is now active with ${storeName}.`,
    loyaltyLine,
    `Preferred contact method: ${normalizeText(customer.preferredContactMethod || "None") || "None"}.`,
    marketingLine,
    checkoutIdentityLine,
  ].join("\n");
  const smsBase = `${storeName}: Welcome ${recipientName}. ${loyaltyLine} ${checkoutIdentityLine}`;
  const smsCompliance = customer.marketingOptIn ? " Reply STOP to opt out of promo SMS." : "";
  const sms = truncateText(`${smsBase}${smsCompliance}`, 320);

  return {
    subject,
    html,
    text,
    sms,
    templateKey: "welcome",
  };
}

async function logCommunication(entry = {}) {
  return customerCommunicationRepository.createCustomerCommunication({
    customerId: entry.customerId,
    channel: entry.channel,
    status: entry.status,
    templateKey: entry.templateKey,
    subject: entry.subject || "",
    recipient: entry.recipient || "",
    provider: entry.provider || "",
    providerMessageId: entry.providerMessageId || "",
    contentPreview: truncateText(entry.contentPreview || ""),
    errorMessage: entry.errorMessage || "",
    triggeredByUserId: entry.triggeredByUserId ?? null,
    metadata: entry.metadata || {},
    createdAt: new Date().toISOString(),
  });
}

async function sendSmsMessage({ to, body }) {
  const recipient = normalizeText(to);
  if (!recipient) {
    throw new AppError(400, "SMS recipient is required.", {
      code: "SMS_RECIPIENT_REQUIRED",
    });
  }

  const config = readSmsConfig();
  if (!config.configured) {
    throw new AppError(503, "SMS transport is not configured.", {
      code: "SMS_TRANSPORT_NOT_CONFIGURED",
      details: {
        missing: config.missing,
      },
    });
  }

  const payload = new URLSearchParams();
  payload.set("To", recipient);
  payload.set("Body", String(body || ""));

  if (config.senderType === "messaging-service") {
    payload.set("MessagingServiceSid", config.messagingServiceSid);
  } else {
    payload.set("From", config.fromNumber);
  }

  const basicAuthIdentity =
    config.authMode === "api-key"
      ? `${config.apiKeySid}:${config.apiKeySecret}`
      : `${config.accountSid}:${config.authToken}`;

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(basicAuthIdentity).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: payload.toString(),
    }
  );

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new AppError(
      502,
      String(data?.message || `SMS delivery failed with status ${response.status}.`).trim(),
      {
        code: "SMS_DELIVERY_FAILED",
      }
    );
  }

  return {
    provider: config.provider,
    messageId: String(data?.sid || "").trim(),
  };
}

async function sendCustomerWelcomeMessage({ customer, actor, settings }) {
  const welcome = buildCustomerWelcomePayload(customer, settings);
  const attempts = [];

  if (normalizeText(customer.email)) {
    try {
      const delivery = await sendEmail({
        to: customer.email,
        subject: welcome.subject,
        html: welcome.html,
        text: welcome.text,
      });
      attempts.push(
        await logCommunication({
          customerId: customer.id,
          channel: "email",
          status: "success",
          templateKey: welcome.templateKey,
          subject: welcome.subject,
          recipient: customer.email,
          provider: delivery.provider,
          providerMessageId: delivery.messageId,
          contentPreview: welcome.text,
          triggeredByUserId: actor?.id ?? null,
        })
      );
    } catch (error) {
      attempts.push(
        await logCommunication({
          customerId: customer.id,
          channel: "email",
          status: "failed",
          templateKey: welcome.templateKey,
          subject: welcome.subject,
          recipient: customer.email,
          provider: getMailTransportStatus().provider,
          contentPreview: welcome.text,
          errorMessage: error?.message || "Email delivery failed.",
          triggeredByUserId: actor?.id ?? null,
        })
      );
    }
  }

  const shouldSendSms =
    normalizeText(customer.phone) &&
    (normalizeText(customer.preferredContactMethod).toLowerCase() === "sms" ||
      !normalizeText(customer.email));

  if (shouldSendSms) {
    try {
      const delivery = await sendSmsMessage({
        to: customer.phone,
        body: welcome.sms,
      });
      attempts.push(
        await logCommunication({
          customerId: customer.id,
          channel: "sms",
          status: "success",
          templateKey: welcome.templateKey,
          subject: welcome.subject,
          recipient: customer.phone,
          provider: delivery.provider,
          providerMessageId: delivery.messageId,
          contentPreview: welcome.sms,
          triggeredByUserId: actor?.id ?? null,
        })
      );
    } catch (error) {
      attempts.push(
        await logCommunication({
          customerId: customer.id,
          channel: "sms",
          status: "failed",
          templateKey: welcome.templateKey,
          subject: welcome.subject,
          recipient: customer.phone,
          provider: getSmsTransportStatus().provider,
          contentPreview: welcome.sms,
          errorMessage: error?.message || "SMS delivery failed.",
          triggeredByUserId: actor?.id ?? null,
        })
      );
    }
  }

  return attempts;
}

async function listCustomerCommunications(customerId, options = {}) {
  return customerCommunicationRepository.listCustomerCommunications(customerId, options);
}

async function getCustomerCommunicationSummary(customerId, options = {}) {
  const logs = await listCustomerCommunications(customerId, {
    limit: options.limit || 12,
  });
  const successCount = logs.filter((item) => item.status === "success").length;
  const failedCount = logs.filter((item) => item.status === "failed").length;
  const emailTransport = summarizeTransportHealth(getMailTransportStatus(), logs, "email");
  const smsTransport = summarizeTransportHealth(getSmsTransportStatus(), logs, "sms");

  return {
    logs,
    successCount,
    failedCount,
    emailTransport,
    smsTransport,
  };
}

async function getOwnerCommunicationWorkspace(options = {}) {
  const customers = await customerRepository.getCustomers();
  const customerMap = new Map(customers.map((customer) => [Number(customer.id), customer]));
  const recentLogs = await customerCommunicationRepository.listRecentCustomerCommunications({
    limit: options.limit || 20,
  });

  const enrolledCustomers = customers.filter((customer) => Boolean(customer?.loyaltyOptIn));
  const deliverableCustomers = enrolledCustomers.filter(
    (customer) => normalizeText(customer.email) || normalizeText(customer.phone)
  );
  const emailReachableCustomers = enrolledCustomers.filter((customer) => normalizeText(customer.email));
  const smsReachableCustomers = enrolledCustomers.filter((customer) => normalizeText(customer.phone));
  const marketingOptInCustomers = enrolledCustomers.filter((customer) => Boolean(customer?.marketingOptIn));

  const totals = recentLogs.reduce(
    (summary, log) => {
      summary.total += 1;
      if (log.status === "success") summary.success += 1;
      if (log.status === "failed") summary.failed += 1;
      if (log.channel === "email") summary.email += 1;
      if (log.channel === "sms") summary.sms += 1;
      if (log.templateKey === "welcome") summary.welcome += 1;
      return summary;
    },
    {
      total: 0,
      success: 0,
      failed: 0,
      email: 0,
      sms: 0,
      welcome: 0,
    }
  );
  const emailTransport = summarizeTransportHealth(getMailTransportStatus(), recentLogs, "email");
  const smsTransport = summarizeTransportHealth(getSmsTransportStatus(), recentLogs, "sms");

  return {
    automation: {
      loyaltyWelcomeAutomation: true,
      triggerSummary:
        "Welcome dispatch runs on new loyalty enrollment and when a loyalty record gains its first deliverable contact route.",
      emailEnabled: Boolean(emailTransport.configured),
      smsEnabled: Boolean(smsTransport.configured),
    },
    coverage: {
      enrolledCustomers: enrolledCustomers.length,
      deliverableCustomers: deliverableCustomers.length,
      emailReachableCustomers: emailReachableCustomers.length,
      smsReachableCustomers: smsReachableCustomers.length,
      marketingOptInCustomers: marketingOptInCustomers.length,
      contactGapCustomers: Math.max(0, enrolledCustomers.length - deliverableCustomers.length),
    },
    transport: {
      email: emailTransport,
      sms: smsTransport,
    },
    delivery: totals,
    recentLogs: recentLogs.map((log) => {
      const customer = customerMap.get(Number(log.customerId));
      return {
        ...log,
        customerName: customer?.name || `Customer #${log.customerId}`,
        loyaltyOptIn: Boolean(customer?.loyaltyOptIn),
        marketingOptIn: Boolean(customer?.marketingOptIn),
        preferredContactMethod: String(customer?.preferredContactMethod || "None").trim() || "None",
      };
    }),
  };
}

module.exports = {
  getCustomerCommunicationSummary,
  getOwnerCommunicationWorkspace,
  getSmsTransportStatus,
  listCustomerCommunications,
  sendCustomerWelcomeMessage,
};
