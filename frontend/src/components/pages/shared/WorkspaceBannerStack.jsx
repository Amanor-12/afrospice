function WorkspaceBannerStack({ error = "", notice = "" }) {
  const hasError = Boolean(String(error || "").trim());
  const hasNotice = Boolean(String(notice || "").trim());

  if (!hasError && !hasNotice) {
    return null;
  }

  return (
    <div className="workspace-banner-stack">
      {hasError ? <div className="info-banner inventory-error-banner">{error}</div> : null}
      {hasNotice ? <div className="info-banner">{notice}</div> : null}
    </div>
  );
}

export default WorkspaceBannerStack;
