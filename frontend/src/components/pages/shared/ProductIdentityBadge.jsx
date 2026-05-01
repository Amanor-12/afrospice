import { getIdentityInitials, getIdentityTone } from "./identityAvatar";

function ProductIdentityBadge({ product, className = "" }) {
  const label = String(product?.name || product?.sku || "Product");
  const tone = getIdentityTone([product?.name, product?.category, product?.supplier].filter(Boolean).join(" "), "blue");
  const classes = ["product-identity-badge", className].filter(Boolean).join(" ");

  return (
    <div className={classes} data-tone={tone} aria-hidden="true">
      <span>{getIdentityInitials(label, "PR")}</span>
    </div>
  );
}

export default ProductIdentityBadge;
