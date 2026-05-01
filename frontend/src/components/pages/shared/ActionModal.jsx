import { useEffect } from "react";
import { FaXmark as FiX } from "react-icons/fa6";

function ActionModal({
  open,
  title,
  description = "",
  children = null,
  actions = null,
  onClose,
  size = "compact",
}) {
  useEffect(() => {
    if (!open) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="control-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className={`control-modal control-modal--${size}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="control-modal-header">
          <div className="control-modal-copy">
            <span className="reference-page-kicker">Action review</span>
            <h3>{title}</h3>
            {description ? <p>{description}</p> : null}
          </div>
          <button type="button" className="control-modal-close" onClick={onClose} aria-label="Close dialog">
            <FiX />
          </button>
        </header>

        <div className="control-modal-body">{children}</div>
        {actions ? <footer className="control-modal-actions">{actions}</footer> : null}
      </div>
    </div>
  );
}

export default ActionModal;
