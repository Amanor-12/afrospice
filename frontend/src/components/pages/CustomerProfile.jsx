import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  FaArrowLeft as FiArrowLeft,
  FaCartShopping as FiShoppingCart,
  FaEnvelope as FiMail,
  FaPercent as FiPercent,
  FaPaperPlane as FiSend,
  FaPhone as FiPhone,
  FaReceipt as FiReceipt,
  FaTrash as FiTrash,
  FaUserPlus as FiUserPlus,
  FaWallet as FiWallet,
} from "react-icons/fa6";

import API from "../../api/api";
import AssistantActionBanner from "../AssistantActionBanner";
import ActionModal from "./shared/ActionModal";
import {
  formatDate,
  firstNumberFrom,
  formatMoney,
  formatPercent,
  getResponseData,
} from "./shared/dataHelpers";
import { getIdentityInitials, getIdentityTone } from "./shared/identityAvatar";

const emptyDraft = {
  name: "",
  email: "",
  phone: "",
  notes: "",
  loyaltyOptIn: true,
  marketingOptIn: false,
  preferredContactMethod: "Phone",
};

function resolvePreferredContactMethod(draft = {}) {
  const hasEmail = Boolean(String(draft?.email || "").trim());
  const hasPhone = Boolean(String(draft?.phone || "").trim());
  const current = String(draft?.preferredContactMethod || "").trim();

  if (current === "Email" && hasEmail) return "Email";
  if (current === "Phone" && hasPhone) return "Phone";
  if (current === "SMS" && hasPhone) return "SMS";

  if (hasPhone) return "Phone";
  if (hasEmail) return "Email";
  return "None";
}

function toCustomerDraft(customer = null) {
  return {
    name: String(customer?.name || ""),
    email: String(customer?.email || ""),
    phone: String(customer?.phone || ""),
    notes: String(customer?.notes || ""),
    loyaltyOptIn: Boolean(customer?.loyaltyOptIn),
    marketingOptIn: Boolean(customer?.marketingOptIn),
    preferredContactMethod: resolvePreferredContactMethod({
      email: customer?.email,
      phone: customer?.phone,
      preferredContactMethod: customer?.preferredContactMethod,
    }),
  };
}

function buildCustomerRecordPreview(baseRecord = null, draft = {}, settings = {}, preview = null) {
  const defaultDiscountPct = Number(settings?.defaultCustomerDiscountPct || 5);
  const vipDiscountPct = Number(settings?.vipCustomerDiscountPct || 10);
  const discountsEnabled = Boolean(settings?.enableDiscounts);
  const loyaltyOptIn = Boolean(draft?.loyaltyOptIn);
  const hasContactMethod = Boolean(String(draft?.email || "").trim() || String(draft?.phone || "").trim());
  const preferredContactMethod = resolvePreferredContactMethod(draft);
  const previewCustomerNumber = String(preview?.customerNumber || "").trim();
  const previewLoyaltyCardNumber = String(
    preview?.loyaltyCardNumber || preview?.loyaltyNumber || ""
  ).trim();
  const savedLoyaltyCardNumber = String(
    baseRecord?.loyaltyCardNumber || baseRecord?.loyaltyNumber || ""
  ).trim();
  const customerNumber = String(baseRecord?.customerNumber || previewCustomerNumber).trim();
  const lifetimeSpend = firstNumberFrom(baseRecord, ["lifetimeSpend"]);
  const orderCount = firstNumberFrom(baseRecord, ["orderCount"]);
  const qualifiesForVip = orderCount >= 6 || lifetimeSpend >= 350;
  const discountPercent = discountsEnabled
    ? qualifiesForVip
      ? vipDiscountPct
      : defaultDiscountPct
    : 0;
  const pendingLoyaltyCardNumber = loyaltyOptIn
    ? savedLoyaltyCardNumber || previewLoyaltyCardNumber || "Issued on save"
    : "";
  const hasSavedLoyaltyCard = Boolean(savedLoyaltyCardNumber);
  const profileCompletenessPct = Math.round(
    (
      [
        draft?.email,
        draft?.phone,
        loyaltyOptIn ? "enrolled" : "",
      ].filter((value) => String(value || "").trim()).length /
      3
    ) * 100
  );
  const discountEligible = discountsEnabled && loyaltyOptIn && hasContactMethod;
  const loyaltyTier = loyaltyOptIn ? (qualifiesForVip ? "VIP" : "Member") : "Guest";
  const loyaltyStatus = loyaltyOptIn
    ? hasContactMethod
      ? hasSavedLoyaltyCard
        ? "Registered profile"
        : "Ready on save"
      : "Contact details needed"
    : "Enrollment needed";
  const loyaltyProgramStatus = loyaltyOptIn
    ? hasSavedLoyaltyCard
      ? discountEligible
        ? "Card active"
        : "Card issued"
      : "Ready to issue"
    : "Not enrolled";
  const discountReason = discountEligible
    ? hasSavedLoyaltyCard
      ? `${discountPercent}% loyalty pricing is available for named customer checkouts.`
      : `${discountPercent}% loyalty pricing will activate once this member record is saved.`
    : loyaltyOptIn
      ? "Add a phone number or email to activate member pricing for future checkouts."
      : "Enroll this customer into the loyalty program to issue a card number and activate member pricing.";

  return {
    ...baseRecord,
    id: baseRecord?.id ?? null,
    name: String(draft?.name || "").trim() || "New customer",
    email: String(draft?.email || "").trim(),
    phone: String(draft?.phone || "").trim(),
    notes: String(draft?.notes || "").trim(),
    customerNumber: customerNumber || "Assigned on save",
    loyaltyNumber: pendingLoyaltyCardNumber || "Not issued",
    loyaltyCardNumber: pendingLoyaltyCardNumber,
    loyaltyTier,
    loyaltyStatus,
    discountEligible,
    discountPercent: discountEligible ? discountPercent : 0,
    discountReason,
    customerStatus: baseRecord?.customerStatus || "New",
    customerStatusTone: baseRecord?.customerStatusTone || "neutral",
    loyaltyOptIn,
    marketingOptIn: Boolean(draft?.marketingOptIn),
    preferredContactMethod,
    loyaltyEnrolledAt:
      loyaltyOptIn
        ? baseRecord?.loyaltyEnrolledAt || "Issued when saved"
        : null,
    loyaltyProgramStatus,
    orderCount,
    lifetimeSpend,
    averageOrderValue: firstNumberFrom(baseRecord, ["averageOrderValue"]),
    lastPurchaseAt: baseRecord?.lastPurchaseAt || null,
    firstPurchaseAt: baseRecord?.firstPurchaseAt || null,
    recentOrders: Array.isArray(baseRecord?.recentOrders) ? baseRecord.recentOrders : [],
    topProducts: Array.isArray(baseRecord?.topProducts) ? baseRecord.topProducts : [],
    monthlySpend: Array.isArray(baseRecord?.monthlySpend) ? baseRecord.monthlySpend : [],
    profileCompletenessPct,
    contactCoverage: {
      hasEmail: Boolean(String(draft?.email || "").trim()),
      hasPhone: Boolean(String(draft?.phone || "").trim()),
    },
    nextBestCustomerAction: loyaltyOptIn
      ? hasContactMethod
        ? hasSavedLoyaltyCard
          ? "Use the loyalty card number or customer name in checkout to apply member pricing."
          : `Save this profile to issue ${pendingLoyaltyCardNumber || "the loyalty card number"} and activate member pricing.`
        : "Capture a phone number or email before saving so the card can be used on future checkouts."
      : "Turn on loyalty enrollment to issue a reusable card number and activate automatic discount tracking.",
  };
}

function buildCustomerDraftSnapshot(draft = {}) {
  return {
    name: String(draft?.name || "").trim(),
    email: String(draft?.email || "").trim(),
    phone: String(draft?.phone || "").trim(),
    notes: String(draft?.notes || "").trim(),
    loyaltyOptIn: Boolean(draft?.loyaltyOptIn),
    marketingOptIn: Boolean(draft?.marketingOptIn),
    preferredContactMethod: resolvePreferredContactMethod(draft),
  };
}

function summarizeDispatches(dispatches = []) {
  if (!Array.isArray(dispatches) || dispatches.length === 0) {
    return "No enrollment dispatch was sent.";
  }

  const successCount = dispatches.filter((item) => item?.status === "success").length;
  const failedCount = dispatches.filter((item) => item?.status === "failed").length;
  const channels = [...new Set(dispatches.map((item) => String(item?.channel || "").trim().toUpperCase()).filter(Boolean))];
  const parts = [];

  if (successCount > 0) {
    parts.push(`${successCount} ${successCount === 1 ? "delivery" : "deliveries"} succeeded`);
  }

  if (failedCount > 0) {
    parts.push(`${failedCount} ${failedCount === 1 ? "delivery" : "deliveries"} failed`);
  }

  if (channels.length) {
    parts.push(`Channels ${channels.join(", ")}`);
  }

  return parts.join(". ") || "Dispatch activity was recorded.";
}

function describeTransportStatus(transport = {}, fallbackLabel = "transport") {
  const provider = String(transport?.provider || fallbackLabel).trim();
  const missing = Array.isArray(transport?.missing) ? transport.missing.filter(Boolean) : [];
  const health = String(transport?.health || "").trim().toLowerCase();

  if (!transport?.configured) {
    if (missing.length) {
      return `Setup needed: ${missing.join(", ")}`;
    }

    return `${provider.toUpperCase()} not configured`;
  }

  if (health === "degraded") {
    return `${provider.toUpperCase()} delivery issue`;
  }

  if (health === "warning") {
    return `${provider.toUpperCase()} needs review`;
  }

  if (health === "ready") {
    return `${provider.toUpperCase()} ready`;
  }

  return `${provider.toUpperCase()} live`;
}

function getDispatchReadiness(hasContact, transport, missingLabel) {
  if (!hasContact) return missingLabel;
  if (!transport?.configured) return "Setup needed";

  const health = String(transport?.health || "").trim().toLowerCase();
  if (health === "degraded") return "Delivery issue";
  if (health === "warning") return "Review";
  return "Ready";
}

async function dispatchWelcomeMessage(customerId) {
  const primaryRoute = `/customers/${customerId}/communications/welcome`;
  const legacyRoute = `/customers/${customerId}/send-welcome`;

  try {
    return await API.post(primaryRoute);
  } catch (error) {
    const status = Number(error?.status || 0);
    const message = String(error?.message || "").trim().toLowerCase();
    const shouldFallback = status === 404 || message.includes("route not found");

    if (!shouldFallback) {
      throw error;
    }

    return API.post(legacyRoute);
  }
}

function CustomerProfile({ settings }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { customerId } = useParams();

  const isCreateMode = customerId === "new" || location.pathname.endsWith("/customers/new");
  const currency = settings?.currency || "USD";

  const [customer, setCustomer] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [loading, setLoading] = useState(!isCreateMode);
  const [saving, setSaving] = useState(false);
  const [sendingWelcome, setSendingWelcome] = useState(false);
  const [notice, setNotice] = useState(location.state?.customerNotice || "");
  const [error, setError] = useState("");
  const [enrollmentPreview, setEnrollmentPreview] = useState(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  const assistantActionLabel = location.state?.assistantActionLabel || "";
  const assistantActionNote = location.state?.assistantActionNote || "";
  const baselineDraft = useMemo(
    () =>
      buildCustomerDraftSnapshot(
        isCreateMode
          ? {
              ...emptyDraft,
              ...location.state?.prefillCustomerDraft,
            }
          : toCustomerDraft(customer)
      ),
    [customer, isCreateMode, location.state]
  );

  useEffect(() => {
    if (isCreateMode) {
      setCustomer(null);
      setDraft({
        ...emptyDraft,
        ...location.state?.prefillCustomerDraft,
      });
      setLoading(false);
      setError("");
      return;
    }

    let cancelled = false;

    const loadCustomer = async () => {
      try {
        setLoading(true);
        const response = await API.get(`/customers/${customerId}`);
        if (cancelled) return;

        const nextCustomer = getResponseData(response);
        setCustomer(nextCustomer);
        setDraft(toCustomerDraft(nextCustomer));
        setError("");
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError?.message || "Could not load the customer record.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadCustomer();
    return () => {
      cancelled = true;
    };
  }, [customerId, isCreateMode, location.state]);

  useEffect(() => {
    if (!isCreateMode) {
      setEnrollmentPreview(null);
      return;
    }

    let cancelled = false;

    const loadEnrollmentPreview = async () => {
      try {
        const response = await API.get("/customers/preview/new");
        if (cancelled) return;
        setEnrollmentPreview(getResponseData(response) || null);
      } catch {
        if (!cancelled) {
          setEnrollmentPreview(null);
        }
      }
    };

    loadEnrollmentPreview();
    return () => {
      cancelled = true;
    };
  }, [isCreateMode]);

  useEffect(() => {
    const nextPreferredContactMethod = resolvePreferredContactMethod({
      email: draft.email,
      phone: draft.phone,
      preferredContactMethod: draft.preferredContactMethod,
    });
    const currentPreferredContactMethod = String(draft?.preferredContactMethod || "").trim() || "None";

    if (currentPreferredContactMethod !== nextPreferredContactMethod) {
      setDraft((current) => {
        const currentValue = String(current?.preferredContactMethod || "").trim() || "None";
        if (currentValue === nextPreferredContactMethod) {
          return current;
        }

        return {
          ...current,
          preferredContactMethod: nextPreferredContactMethod,
        };
      });
    }
  }, [draft.email, draft.phone, draft.preferredContactMethod]);

  const record = useMemo(
    () => buildCustomerRecordPreview(isCreateMode ? null : customer, draft, settings, enrollmentPreview),
    [customer, draft, enrollmentPreview, isCreateMode, settings]
  );
  const draftDirty = useMemo(
    () => JSON.stringify(buildCustomerDraftSnapshot(draft)) !== JSON.stringify(baselineDraft),
    [baselineDraft, draft]
  );

  const summaryCards = useMemo(
    () => [
      {
        label: "Lifetime Spend",
        value: formatMoney(currency, firstNumberFrom(record, ["lifetimeSpend"])),
        note: record?.firstPurchaseAt ? `First purchase ${formatDate(record.firstPurchaseAt)}` : "No completed purchases yet",
        icon: FiWallet,
      },
      {
        label: "Total Orders",
        value: `${firstNumberFrom(record, ["orderCount"])}`,
        note: record?.lastPurchaseAt ? `Last visit ${formatDate(record.lastPurchaseAt)}` : "Awaiting first recorded visit",
        icon: FiReceipt,
      },
      {
        label: "Average Basket",
        value: formatMoney(currency, firstNumberFrom(record, ["averageOrderValue"])),
        note: `${record?.profileCompletenessPct || 0}% profile readiness`,
        icon: FiShoppingCart,
      },
      {
        label: "Discount Eligibility",
        value: record?.discountEligible ? formatPercent(record?.discountPercent || 0, 0) : "Locked",
        note: record?.discountReason || "No pricing rule is active yet.",
        icon: FiPercent,
      },
    ],
    [currency, record]
  );

  const contactStatus = [
    { label: "Email", enabled: Boolean(record?.contactCoverage?.hasEmail), icon: FiMail },
    { label: "Phone", enabled: Boolean(record?.contactCoverage?.hasPhone), icon: FiPhone },
  ];

  const checkoutRecognition = useMemo(
    () => [
      {
        label: "Customer number",
        value: record?.customerNumber || "Assigned when saved",
        status: record?.customerNumber ? "Live" : "Pending",
        icon: FiUserPlus,
      },
      {
        label: "Loyalty card",
        value: record?.loyaltyCardNumber || (record?.loyaltyOptIn ? "Issued on save" : "Not enrolled"),
        status: record?.loyaltyOptIn ? "Member" : "Guest",
        icon: FiWallet,
      },
      {
        label: "Phone lookup",
        value: record?.phone || "Phone not captured",
        status: record?.contactCoverage?.hasPhone ? "Ready" : "Needed",
        icon: FiPhone,
      },
      {
        label: "Email lookup",
        value: record?.email || "Email not captured",
        status: record?.contactCoverage?.hasEmail ? "Ready" : "Needed",
        icon: FiMail,
      },
    ],
    [record]
  );

  const loyaltySnapshot = useMemo(
    () => [
      {
        label: "Member tier",
        value: record?.loyaltyTier || "Guest",
      },
      {
        label: "Program status",
        value: record?.loyaltyProgramStatus || "Not enrolled",
      },
      {
        label: "Preferred contact",
        value: record?.preferredContactMethod || "Not selected",
      },
      {
        label: "Pricing rule",
        value: record?.discountEligible
          ? `${record?.discountPercent || 0}% named-customer discount is live`
          : "Discount is waiting for contact capture or enrollment",
      },
    ],
    [record]
  );
  const communicationSummary = useMemo(
    () =>
      record?.communicationSummary || {
        logs: [],
        successCount: 0,
        failedCount: 0,
        emailTransport: { configured: false, provider: "email", missing: [] },
        smsTransport: { configured: false, provider: "sms", missing: [] },
      },
    [record]
  );
  const communicationRows = useMemo(
    () => (Array.isArray(record?.recentCommunications) ? record.recentCommunications.slice(0, 4) : []),
    [record?.recentCommunications]
  );
  const captureOverview = useMemo(
    () => [
      {
        label: "Customer ID",
        value: record?.customerNumber || "Assigned on save",
        note: "Named lookup at the lane and in outreach history.",
      },
      {
        label: "Loyalty card",
        value: draft?.loyaltyOptIn
          ? record?.loyaltyCardNumber || "Issued on save"
          : "Enrollment disabled",
        note: draft?.loyaltyOptIn
          ? "Reusable member number tied to checkout and rewards."
          : "Turn on loyalty enrollment to issue a reusable card.",
      },
      {
        label: "Member tier",
        value: record?.loyaltyTier || "Guest",
        note: record?.discountEligible
          ? `${record?.discountPercent || 0}% named pricing is available.`
          : "Discount path is waiting for contact coverage or enrollment.",
      },
      {
        label: "Dispatch plan",
        value:
          record?.preferredContactMethod && record.preferredContactMethod !== "None"
            ? record.preferredContactMethod
            : "No route",
        note:
          communicationSummary.emailTransport?.health === "degraded" ||
          communicationSummary.smsTransport?.health === "degraded"
            ? "A delivery channel is configured, but recent welcome attempts are failing and need owner review."
            : communicationSummary.emailTransport?.configured || communicationSummary.smsTransport?.configured
              ? "Welcome outreach can be attempted as soon as the profile is saved."
              : "Transport is not configured yet, so outreach will be logged but not delivered.",
      },
    ],
    [
      communicationSummary.emailTransport?.configured,
      communicationSummary.emailTransport?.health,
      communicationSummary.smsTransport?.configured,
      communicationSummary.smsTransport?.health,
      draft?.loyaltyOptIn,
      record,
    ]
  );
  const dispatchReadiness = useMemo(
    () => [
      {
        label: "Email",
        value: getDispatchReadiness(
          Boolean(record?.email),
          communicationSummary.emailTransport,
          "Capture email"
        ),
      },
      {
        label: "SMS",
        value: getDispatchReadiness(
          Boolean(record?.phone),
          communicationSummary.smsTransport,
          "Capture phone"
        ),
      },
      {
        label: "Marketing",
        value: draft?.marketingOptIn ? "Opted in" : "Off",
      },
    ],
    [communicationSummary.emailTransport, communicationSummary.smsTransport, draft?.marketingOptIn, record?.email, record?.phone]
  );
  const readinessCards = useMemo(
    () => [
      {
        label: "Identity block",
        value: record?.name && record?.name !== "New customer" ? "Ready" : "Name needed",
        note: record?.customerNumber || "Customer number will be assigned on save.",
        tone: record?.name && record?.name !== "New customer" ? "success" : "warning",
        icon: FiUserPlus,
      },
      {
        label: "Contact coverage",
        value:
          record?.contactCoverage?.hasEmail || record?.contactCoverage?.hasPhone
            ? "Contactable"
            : "Capture route needed",
        note:
          record?.contactCoverage?.hasEmail && record?.contactCoverage?.hasPhone
            ? "Email and phone are both ready for outreach."
            : record?.contactCoverage?.hasPhone
              ? "Phone is available for lane lookup and SMS."
              : record?.contactCoverage?.hasEmail
                ? "Email is available for receipts and dispatch."
                : "Add a phone number or email to make the profile reusable.",
        tone: record?.contactCoverage?.hasEmail || record?.contactCoverage?.hasPhone ? "success" : "warning",
        icon: record?.contactCoverage?.hasPhone ? FiPhone : FiMail,
      },
      {
        label: "Loyalty pricing",
        value: record?.discountEligible ? `${record?.discountPercent || 0}% live` : "Not live yet",
        note: record?.discountReason || "No loyalty pricing guidance is available yet.",
        tone: record?.discountEligible ? "success" : draft?.loyaltyOptIn ? "warning" : "neutral",
        icon: FiPercent,
      },
      {
        label: "Dispatch route",
        value:
          record?.preferredContactMethod && record?.preferredContactMethod !== "None"
            ? record.preferredContactMethod
            : "No route selected",
        note:
          communicationSummary.emailTransport?.configured || communicationSummary.smsTransport?.configured
            ? "Welcome dispatch can be attempted from this profile."
            : "Transport is not configured yet, so dispatch will log only.",
        tone:
          communicationSummary.emailTransport?.configured || communicationSummary.smsTransport?.configured
            ? "success"
            : "warning",
        icon: FiSend,
      },
    ],
    [
      communicationSummary.emailTransport?.configured,
      communicationSummary.smsTransport?.configured,
      draft?.loyaltyOptIn,
      record?.contactCoverage?.hasEmail,
      record?.contactCoverage?.hasPhone,
      record?.customerNumber,
      record?.discountEligible,
      record?.discountPercent,
      record?.discountReason,
      record?.name,
      record?.preferredContactMethod,
    ]
  );

  const handleSave = async (event) => {
    event.preventDefault();
    if (saving) return;

    try {
      setSaving(true);
      setError("");
      setNotice("");

      const payload = {
        name: draft.name,
        email: draft.email || "",
        phone: draft.phone || "",
        notes: draft.notes || "",
        loyaltyOptIn: Boolean(draft.loyaltyOptIn),
        marketingOptIn: Boolean(draft.marketingOptIn),
        preferredContactMethod: resolvePreferredContactMethod(draft),
      };

      const response = isCreateMode ? await API.post("/customers", payload) : await API.put(`/customers/${customerId}`, payload);
      const savedCustomer = getResponseData(response);

      if (isCreateMode) {
        const issuedCustomerNumber = String(savedCustomer?.customerNumber || "").trim();
        const issuedLoyaltyCardNumber = String(savedCustomer?.loyaltyCardNumber || "").trim();
        const latestDispatches = Array.isArray(savedCustomer?.communicationSummary?.latestDispatches)
          ? savedCustomer.communicationSummary.latestDispatches
          : [];
        const noticeParts = [`${savedCustomer.name} loyalty record created successfully.`];
        if (issuedCustomerNumber) {
          noticeParts.push(`Customer ID ${issuedCustomerNumber} is live.`);
        }
        if (issuedLoyaltyCardNumber) {
          noticeParts.push(`Loyalty card ${issuedLoyaltyCardNumber} is ready for checkout recognition.`);
        }
        if (latestDispatches.length) {
          noticeParts.push(summarizeDispatches(latestDispatches));
        }
        navigate(`/customers/${savedCustomer.id}`, {
          replace: true,
          state: {
            customerNotice: noticeParts.join(" "),
          },
        });
        return;
      }

      setCustomer(savedCustomer);
      setDraft(toCustomerDraft(savedCustomer));
      setNotice(`${savedCustomer.name} loyalty record updated successfully.`);
    } catch (requestError) {
      setError(requestError?.message || "Could not save the customer record.");
    } finally {
      setSaving(false);
    }
  };

  const handleSendWelcome = async () => {
    if (isCreateMode || !record?.id || sendingWelcome) return;

    try {
      setSendingWelcome(true);
      setError("");
      const response = await dispatchWelcomeMessage(record.id);
      const nextCustomer = getResponseData(response);
      setCustomer(nextCustomer);
      setDraft(toCustomerDraft(nextCustomer));
      setNotice(
        `Enrollment dispatch refreshed for ${nextCustomer?.name || "this member record"}. ${summarizeDispatches(
          nextCustomer?.communicationSummary?.latestDispatches
        )}`
      );
    } catch (requestError) {
      setError(requestError?.message || "Could not send the loyalty welcome dispatch.");
    } finally {
      setSendingWelcome(false);
    }
  };

  const handleDelete = () => {
    if (!customer || saving || customer?.isWalkIn) return;
    setError("");
    setDeleteModalOpen(true);
  };

  const handleResetDraft = () => {
    setDraft(
      isCreateMode
        ? {
            ...emptyDraft,
            ...location.state?.prefillCustomerDraft,
          }
        : toCustomerDraft(customer)
    );
    setNotice("");
    setError("");
  };

  const confirmDelete = async () => {
    if (!customer || saving || customer?.isWalkIn) return;

    try {
      setSaving(true);
      setError("");
      await API.delete(`/customers/${customer.id}`);
      navigate("/customers", {
        replace: true,
        state: {
          assistantActionLabel: "Customer removed",
          assistantActionNote: `${customer.name} was removed from the customer directory.`,
        },
      });
    } catch (requestError) {
      setError(requestError?.message || "Could not delete the customer record.");
      setSaving(false);
    }
  };

  const openCheckout = () => {
    const nextCustomer = String(record?.name || "").trim();
    if (!nextCustomer) return;

    navigate("/terminal", {
      state: {
        assistantActionLabel: `Checkout for ${nextCustomer}`,
        assistantActionNote: `${nextCustomer} is prefilled for the next sale so loyalty pricing can be applied in-lane.`,
        prefillCustomer: nextCustomer,
        prefillCustomerId: record?.id || null,
        openAdvancedCheckout: true,
      },
    });
  };

  return (
    <div className="page-container customer-record-page">
      <AssistantActionBanner label={assistantActionLabel} note={assistantActionNote} />
      {error ? <div className="info-banner inventory-error-banner">{error}</div> : null}
      {notice ? <div className="info-banner">{notice}</div> : null}
      {loading ? (
        <section className="soft-panel customer-record-empty">
          <strong>Loading customer record...</strong>
          <p>Pulling the named-customer profile, loyalty status, and recent order history.</p>
        </section>
      ) : null}

      <section className="reference-page-heading customer-record-heading">
        <div className="reference-page-heading-copy">
          <span className="reference-page-kicker">Customers</span>
          <h1>{isCreateMode ? "Create customer" : record?.name || "Customer record"}</h1>
          <p>
            {isCreateMode
              ? "Create a named customer record so checkout, loyalty pricing, and visit history all tie back to one profile."
              : "Use one customer record for loyalty status, discount eligibility, visit history, and named-order activity."}
          </p>
        </div>

        <div className="reference-page-heading-actions">
          <button type="button" className="btn btn-secondary" onClick={() => navigate("/customers")}>
            <FiArrowLeft />
            Back to Customers
          </button>
          {!isCreateMode ? (
            <button type="button" className="btn btn-primary" onClick={openCheckout}>
              <FiShoppingCart />
              Start Checkout
            </button>
          ) : null}
        </div>
      </section>

      <section className="soft-panel customer-record-hero">
        <div className="customer-record-hero-main">
          <span className="reference-avatar customer-record-avatar" data-tone={getIdentityTone(record?.name, "blue")}>
            {getIdentityInitials(record?.name, "CU")}
          </span>
            <div className="customer-record-hero-copy">
              <span className="reference-page-kicker">{isCreateMode ? "New loyalty profile" : "Named customer record"}</span>
              <h2>{record?.name || "Customer record"}</h2>
              <p>{record?.discountReason || "Named customer pricing and history will appear here once the record is saved."}</p>
              <div className="customer-record-pill-row">
                <span className={`status-pill ${draftDirty ? "warning" : "success"}`}>
                  {draftDirty ? "Unsaved changes" : "Profile saved"}
                </span>
                <span className={`status-pill ${record?.customerStatusTone || "neutral"}`}>{record?.customerStatus || "New"}</span>
                <span className="status-pill neutral">{record?.loyaltyTier || "Guest"}</span>
                <span className={`status-pill ${record?.discountEligible ? "success" : "warning"}`}>
                {record?.discountEligible ? `${record?.discountPercent || 0}% discount live` : "Discount locked"}
              </span>
            </div>
          </div>
        </div>

        <div className="customer-record-hero-aside customer-record-loyalty-surface">
          <span className="reference-page-kicker">Loyalty card</span>
          <strong>{record?.loyaltyCardNumber || "Not issued yet"}</strong>
          <p>
            {record?.discountEligible
              ? `${record?.discountPercent || 0}% named-customer pricing is ready at checkout.`
              : record?.discountReason || "Complete enrollment and capture contact details to activate member pricing."}
          </p>
          <div className="customer-record-loyalty-grid">
            {loyaltySnapshot.map((item) => (
              <div key={item.label} className="customer-record-loyalty-metric">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="customer-record-readiness-strip" aria-label="Customer record readiness">
        {readinessCards.map((item) => (
          <article key={item.label} className={`customer-record-readiness-card is-${item.tone}`}>
            <div className="customer-record-readiness-icon">{item.icon ? <item.icon /> : null}</div>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.note}</small>
          </article>
        ))}
      </section>

      <section className="customer-record-recognition-grid">
        {checkoutRecognition.map((item) => (
          <article key={item.label} className="soft-panel customer-record-recognition-card">
            <div className="customer-record-recognition-icon">
              {item.icon ? <item.icon /> : null}
            </div>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.status}</small>
          </article>
        ))}
      </section>

      <section className="soft-summary-grid soft-summary-grid--four">
        {summaryCards.map((card) => (
          <article key={card.label} className="soft-summary-card">
            <div className="soft-summary-icon">{card.icon ? <card.icon /> : null}</div>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.note}</small>
          </article>
        ))}
      </section>

      <section className="soft-main-grid soft-main-grid--customer-record">
        <article className="soft-panel soft-form-panel customer-record-form-card">
          <header className="soft-panel-header">
            <div>
              <span className="reference-page-kicker">Customer Profile</span>
              <h2>{isCreateMode ? "Create a usable customer record" : "Profile and contact capture"}</h2>
            </div>
            <span className={`status-pill ${record?.profileCompletenessPct >= 67 ? "success" : "warning"}`}>
              {record?.profileCompletenessPct || 0}% ready
            </span>
          </header>

          <form className="stack-form customer-record-form-stack" onSubmit={handleSave}>
            <div className={`customer-record-operator-bar${draftDirty ? " is-dirty" : ""}`}>
              <div className="customer-record-operator-copy">
                <span className="reference-page-kicker">Edit status</span>
                <strong>{draftDirty ? "Review profile edits before they go live" : "Customer record is currently in sync"}</strong>
                <small>
                  {draftDirty
                    ? "These profile changes are local to this session until you save them. Reset to restore the last saved customer record."
                    : record?.nextBestCustomerAction || "This customer record is ready for the next operator."}
                </small>
              </div>
              <div className="customer-record-operator-actions">
                <span className={`status-pill small ${draftDirty ? "warning" : "success"}`}>
                  {draftDirty ? "Unsaved" : "Saved"}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleResetDraft}
                  disabled={saving}
                >
                  Reset Changes
                </button>
              </div>
            </div>

            <div className="customer-record-form-layout">
              <div className="customer-record-form-main">
                <section className="customer-record-form-section">
                  <div className="customer-record-form-section-head">
                    <div>
                      <span className="reference-page-kicker">Identity</span>
                      <h3>Named customer profile</h3>
                    </div>
                    <small>The lane, loyalty ledger, and outreach history all resolve from this identity block.</small>
                  </div>
                  <div className="customer-record-field-grid customer-record-field-grid--two">
                    <label className="customer-record-field">
                      <span>Customer name</span>
                      <input
                        className="input"
                        value={draft.name}
                        onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                        placeholder="Customer name"
                      />
                    </label>
                    <label className="customer-record-field">
                      <span>Email</span>
                      <input
                        className="input"
                        value={draft.email}
                        onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))}
                        placeholder="Email"
                      />
                    </label>
                    <label className="customer-record-field">
                      <span>Phone number</span>
                      <input
                        className="input"
                        value={draft.phone}
                        onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))}
                        placeholder="Phone number"
                      />
                    </label>
                    <label className="customer-record-field">
                      <span>Preferred contact route</span>
                      <select
                        className="input"
                        value={draft.preferredContactMethod}
                        onChange={(event) =>
                          setDraft((current) => ({ ...current, preferredContactMethod: event.target.value }))
                        }
                      >
                        <option value="None">None</option>
                        <option value="Phone">Phone</option>
                        <option value="Email">Email</option>
                        <option value="SMS">SMS</option>
                      </select>
                    </label>
                  </div>
                </section>

                <section className="customer-record-form-section">
                  <div className="customer-record-form-section-head">
                    <div>
                      <span className="reference-page-kicker">Optional Service Notes</span>
                      <h3>Checkout context for staff</h3>
                    </div>
                    <small>Notes are optional. Use them only for useful service context that should help the next operator.</small>
                  </div>
                  <label className="customer-record-field customer-record-field--notes">
                    <span>Optional operator notes</span>
                    <textarea
                      className="input textarea"
                      rows={4}
                      value={draft.notes}
                      onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
                      placeholder="Allergy notes, service context, household preference..."
                    />
                  </label>
                </section>
              </div>

              <aside className="customer-record-capture-rail">
                <article className="customer-record-capture-card">
                  <div className="customer-record-form-section-head">
                    <div>
                      <span className="reference-page-kicker">Enrollment Posture</span>
                      <h3>What the profile issues</h3>
                    </div>
                  </div>
                  <div className="customer-record-capture-grid">
                    {captureOverview.map((item) => (
                      <div key={item.label} className="customer-record-capture-item">
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                        <small>{item.note}</small>
                      </div>
                    ))}
                  </div>
                </article>

                <div className="customer-record-option-stack customer-record-option-stack--strong">
                  <label className="customer-record-check customer-record-check--strong">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.loyaltyOptIn)}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, loyaltyOptIn: event.target.checked }))
                      }
                    />
                    <div>
                      <strong>Issue loyalty card</strong>
                      <small>Assign a reusable loyalty number, link named purchases, and unlock member pricing rules.</small>
                    </div>
                    <span className={`status-pill small ${draft.loyaltyOptIn ? "success" : "neutral"}`}>
                      {draft.loyaltyOptIn ? "Enabled" : "Off"}
                    </span>
                  </label>
                  <label className="customer-record-check customer-record-check--strong">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.marketingOptIn)}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, marketingOptIn: event.target.checked }))
                      }
                    />
                    <div>
                      <strong>Send offers and reminders</strong>
                      <small>Allow promotional follow-up, event announcements, and reminder messaging after registration.</small>
                    </div>
                    <span className={`status-pill small ${draft.marketingOptIn ? "success" : "neutral"}`}>
                      {draft.marketingOptIn ? "Opted in" : "Off"}
                    </span>
                  </label>
                </div>

                <article className="customer-record-capture-card customer-record-capture-card--soft">
                  <div className="customer-record-form-section-head">
                    <div>
                      <span className="reference-page-kicker">Dispatch Readiness</span>
                      <h3>Automatic welcome and loyalty dispatch</h3>
                    </div>
                  </div>
                  <div className="customer-record-dispatch-row">
                    {dispatchReadiness.map((item) => (
                      <div key={item.label} className="customer-record-dispatch-item">
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="customer-record-dispatch-note">
                    <strong>
                      {draft.loyaltyOptIn
                        ? "Saving this profile will automatically attempt the welcome and loyalty dispatch."
                        : "Saving this profile will create the member record without issuing a loyalty number."}
                    </strong>
                    <small>
                      {record?.preferredContactMethod && record.preferredContactMethod !== "None"
                        ? `Preferred route: ${record.preferredContactMethod}.`
                        : "Choose a preferred route so automated outreach and reminders stay predictable."}
                    </small>
                  </div>
                </article>
              </aside>
            </div>

            {isCreateMode ? (
              <div className="customer-record-preview-callout">
                <span className="reference-page-kicker">Auto-issued membership numbers</span>
                <div className="customer-record-preview-grid">
                  <div className="customer-record-preview-item">
                    <span>Customer ID</span>
                    <strong>{record?.customerNumber || "Assigned on save"}</strong>
                    <small>Used by staff to find the profile quickly.</small>
                  </div>
                  <div className="customer-record-preview-item">
                    <span>Loyalty card</span>
                    <strong>
                      {draft.loyaltyOptIn
                        ? record?.loyaltyCardNumber || "Issued when saved"
                        : "Enable loyalty to issue a reusable card"}
                    </strong>
                    <small>
                      {draft.loyaltyOptIn
                        ? "Customers can use this card number on future checkouts."
                        : "Turn on loyalty enrollment to auto-issue the card."}
                    </small>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="soft-form-actions customer-record-form-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving || (!draftDirty && !isCreateMode)}
              >
                {saving ? "Saving..." : isCreateMode ? "Create Customer" : "Save Changes"}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleResetDraft}
                disabled={saving}
              >
                Reset Changes
              </button>
              {!isCreateMode ? (
                <button type="button" className="btn btn-danger" onClick={handleDelete}>
                  <FiTrash />
                  Delete
                </button>
              ) : null}
            </div>
          </form>
        </article>

        <div className="soft-side-stack">
          <article className="soft-panel customer-record-loyalty-card">
            <header className="soft-panel-header">
              <div>
                <span className="reference-page-kicker">Loyalty & Discount</span>
                <h3>{record?.loyaltyTier || "Guest"} program profile</h3>
              </div>
              <span className={`status-pill ${record?.discountEligible ? "success" : "warning"}`}>
                {record?.discountEligible ? `${record?.discountPercent || 0}% live` : "Awaiting contact"}
              </span>
            </header>
            <div className="soft-key-value-list">
              <div>
                <span>Loyalty card number</span>
                <strong>{record?.loyaltyCardNumber || "Not issued"}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{record?.loyaltyStatus || "Contact details needed"}</strong>
              </div>
              <div>
                <span>Preferred contact</span>
                <strong>{record?.preferredContactMethod || "None selected"}</strong>
              </div>
              <div>
                <span>Checkout behavior</span>
                <strong>
                  {record?.discountEligible
                    ? "This customer can receive named-customer pricing when selected in the POS."
                    : "Capture an email or phone number to make this customer eligible for named pricing."}
                </strong>
              </div>
              <div>
                <span>VIP unlock</span>
                <strong>6 orders or CAD 350 lifetime spend unlocks the VIP discount path.</strong>
              </div>
              <div>
                <span>Next best action</span>
                <strong>{record?.nextBestCustomerAction || "No follow-up guidance is available yet."}</strong>
              </div>
            </div>
          </article>

          <article className="soft-panel customer-record-loyalty-card">
            <header className="soft-panel-header">
              <div>
                <span className="reference-page-kicker">Checkout Recognition</span>
                <h3>What staff can use at the lane</h3>
              </div>
            </header>
            <div className="customer-record-contact-grid">
              {contactStatus.map((item) => (
                <article key={item.label} className="soft-list-row customer-record-contact-row">
                  <div className="customer-record-contact-copy">
                    <strong>{item.label}</strong>
                      <small>{item.enabled ? `${item.label} is captured and usable.` : `${item.label} is still missing.`}</small>
                    </div>
                    <span className={`status-pill ${item.enabled ? "success" : "warning"}`}>{item.enabled ? "Captured" : "Needed"}</span>
                  </article>
              ))}
            </div>
            <div className="customer-record-next-step">
              <span className="reference-page-kicker">Next best step</span>
              <strong>{record?.nextBestCustomerAction || "No follow-up guidance is available yet."}</strong>
            </div>
          </article>

          {!isCreateMode ? (
            <article className="soft-panel customer-record-loyalty-card">
              <header className="soft-panel-header">
                <div>
                  <span className="reference-page-kicker">Enrollment Dispatch</span>
                  <h3>Welcome automation and delivery control</h3>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-compact"
                  onClick={handleSendWelcome}
                  disabled={sendingWelcome}
                >
                  <FiSend />
                  {sendingWelcome ? "Sending..." : "Send Welcome Pack"}
                </button>
              </header>

              <div className="soft-key-value-list">
                <div>
                  <span>Email delivery</span>
                  <strong>{describeTransportStatus(communicationSummary.emailTransport, "email")}</strong>
                </div>
                <div>
                  <span>SMS delivery</span>
                  <strong>{describeTransportStatus(communicationSummary.smsTransport, "sms")}</strong>
                </div>
                <div>
                  <span>Email channel health</span>
                  <strong>{communicationSummary.emailTransport?.message || "No recent email delivery signal."}</strong>
                </div>
                <div>
                  <span>SMS channel health</span>
                  <strong>{communicationSummary.smsTransport?.message || "No recent SMS delivery signal."}</strong>
                </div>
                <div>
                  <span>Marketing consent</span>
                  <strong>{record?.marketingOptIn ? "Promotional outreach enabled" : "Promotional outreach disabled"}</strong>
                </div>
                <div>
                  <span>Dispatch ledger</span>
                  <strong>
                    {communicationSummary.successCount || 0} success / {communicationSummary.failedCount || 0} failed
                  </strong>
                </div>
              </div>

              {communicationRows.length ? (
                <div className="soft-list customer-record-communication-list">
                  {communicationRows.map((entry) => (
                    <article key={`${entry.id}-${entry.channel}-${entry.createdAt}`} className="soft-list-row">
                      <div>
                        <strong>
                          {String(entry.channel || "email").toUpperCase()} | {entry.subject || "Membership dispatch"}
                        </strong>
                        <small>
                          {entry.recipient || "No recipient"} | {formatDate(entry.createdAt)}
                        </small>
                      </div>
                      <div className="soft-inline-value">
                        <span className={`status-pill ${entry.status === "success" ? "success" : "warning"}`}>
                          {entry.status === "success" ? "Delivered" : "Needs review"}
                        </span>
                        <small>{entry.errorMessage || entry.provider || "Dispatch recorded"}</small>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="customer-record-empty">
                  <strong>No dispatch activity has been logged yet.</strong>
                  <p>Once contact details are captured, AfroSpice will log every welcome, reminder, and announcement send here.</p>
                </div>
              )}
            </article>
          ) : null}
        </div>
      </section>

      <ActionModal
        open={deleteModalOpen}
        title={`Delete ${customer?.name || "customer"}`}
        description="This permanently removes the customer profile, loyalty enrollment state, and outreach record from the directory."
        onClose={() => {
          if (!saving) {
            setDeleteModalOpen(false);
          }
        }}
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setDeleteModalOpen(false)} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="btn btn-danger" onClick={confirmDelete} disabled={saving}>
              {saving ? "Deleting..." : "Delete Customer"}
            </button>
          </>
        }
      >
        <div className="control-modal-stack">
          <div className="control-modal-alert control-modal-alert--danger">
            <strong>{customer?.name || "Customer profile"}</strong>
            <p>
              {record?.loyaltyCardNumber
                ? `Loyalty card ${record.loyaltyCardNumber} will no longer be available at checkout.`
                : "This customer record will no longer be available at checkout."}
            </p>
          </div>
        </div>
      </ActionModal>
    </div>
  );
}

export default CustomerProfile;
